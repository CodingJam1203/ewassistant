import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getKstTodayDateString } from '@/lib/utils/date'
import { calculateEw } from '@/lib/ew-calculator'
import { notifyCheckinSubmitted } from '@/lib/notifications/teams'
import {
  validateTimeline,
  firstWorkLocation,
  endItemOf,
  displayLocation,
  buildLocationSummary,
  legacyToTimeline,
} from '@/lib/work-location-timeline'
import {
  validateLeaveTimeline,
  isFullDayLeave,
  totalLeaveRoundedMinutes,
} from '@/lib/leave-timeline'
import {
  snapMinutes,
  isHalfHour,
  isHalfHourHHmm,
} from '@/lib/utils/half-hour'
import {
  normalizeWorkLocations,
  legacyTimelineToLocations,
  legacySingleToLocations,
  validateWorkLocations,
  firstChipLabel,
  formatChipsArrow,
} from '@/lib/work-locations-v2'
import { recordSubmission } from '@/lib/submission-log'
import type { WorkLocationTimeline } from '@/types/work-location-timeline'
import type { WorkLocations } from '@/types/work-locations-v2'
import type { LeaveTimeline } from '@/types/leave-timeline'

/**
 * POST /api/team-status/check-in
 *
 * 정책 (v2):
 * - D-1 퇴근보고 시 다음날 출근예정 = D-1 row의 expected_*에 저장 (사전 보고)
 * - D-day 출근보고 = D-day의 본문 row를 INSERT/UPDATE (start_time, end_time, planned)
 *   * 사전 보고 row(leave_date=D-1)는 그대로 보존
 *   * D-day 본문 row가 이미 있으면 갱신 (출근보고 재작성 케이스)
 *   * actual_work_locations는 NULL (출근만 했고 아직 일하지 않음 — 표시 시 planned로 fallback)
 *   * expected_*는 NULL (다음 출근 예정은 퇴근보고에서 입력)
 */
export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json()
    const date: string = body.date ?? getKstTodayDateString()
    const submissionNow = new Date().toISOString()
    const adminClient = createAdminClient()

    const { data: profile } = await adminClient
      .from('user_profiles')
      .select('id, email, display_name, division, team')
      .eq('email', user.email!)
      .single()

    // ─── 휴가 타임라인 ─────────────────────────────────────────────────────────
    let leaveTimeline: LeaveTimeline | null = null
    if (Array.isArray(body.leaveTimeline) && body.leaveTimeline.length > 0) {
      const leErrors = validateLeaveTimeline(body.leaveTimeline as LeaveTimeline)
      if (leErrors.length > 0) {
        return NextResponse.json(
          { error: '휴가/반차 정보가 올바르지 않습니다: ' + leErrors.map(e => e.message).join(', ') },
          { status: 400 }
        )
      }
      leaveTimeline = body.leaveTimeline as LeaveTimeline
    }
    const isAllDayLeave = isFullDayLeave(leaveTimeline ?? [])

    // ─── v2 plannedWorkLocations ────────────────────────────────────────────
    let plannedLocations: WorkLocations | null = null
    if (Array.isArray(body.plannedWorkLocations) && body.plannedWorkLocations.length > 0) {
      const norm = normalizeWorkLocations(body.plannedWorkLocations)
      if (norm) {
        const errs = validateWorkLocations(norm)
        if (errs.length > 0 && !isAllDayLeave) {
          return NextResponse.json(
            { error: '근무장소가 올바르지 않습니다: ' + errs.map(e => e.message).join(', ') },
            { status: 400 }
          )
        }
        plannedLocations = norm
      }
    }

    // ─── legacy timeline (호환) ──────────────────────────────────────────────
    let timeline: WorkLocationTimeline | null = null
    if (Array.isArray(body.workLocationTimeline) && body.workLocationTimeline.length > 0) {
      const tlErrors = validateTimeline(body.workLocationTimeline as WorkLocationTimeline)
      if (tlErrors.length > 0) {
        return NextResponse.json(
          { error: '근무장소 타임라인이 올바르지 않습니다: ' + tlErrors.map(e => e.message).join(', ') },
          { status: 400 }
        )
      }
      timeline = body.workLocationTimeline as WorkLocationTimeline
    } else if (!isAllDayLeave && (body.work_location || body.work_location_type || body.start_time)) {
      timeline = legacyToTimeline({
        expectedWorkLocation: body.work_location ?? null,
        expectedWorkLocationType: body.work_location_type ?? null,
        expectedWorkTime: body.start_time ?? null,
        fallbackCheckoutTime: body.end_time ?? null,
        asExpected: true,
      })
    }

    if (!plannedLocations) {
      plannedLocations = legacyTimelineToLocations(timeline)
        ?? legacySingleToLocations(body.work_location ?? null)
    }

    if (!isAllDayLeave) {
      const hasV2 = !!(plannedLocations && plannedLocations.length > 0)
      const hasLegacy = !!(timeline && timeline.length > 0)
      if (!hasV2 && !hasLegacy) {
        return NextResponse.json(
          { error: '근무장소가 필요합니다 (종일 휴가가 아닌 경우).' },
          { status: 400 }
        )
      }
    }

    // ─── 30분 단위 검증 ─────────────────────────────────────────────────────
    const breakTime    = body.break_time    ?? '00:00'
    const workContent  = body.work_content  ?? ''
    const name         = body.name ?? profile?.display_name ?? user.email!

    if (breakTime && !isHalfHourHHmm(breakTime)) {
      return NextResponse.json({ error: '휴게시간은 30분 단위로 입력해주세요.' }, { status: 400 })
    }
    if (body.start_time && !isHalfHourHHmm(body.start_time)) {
      return NextResponse.json({ error: '출근 시각은 30분 단위로 입력해주세요.' }, { status: 400 })
    }
    if (body.end_time && !isHalfHourHHmm(body.end_time)) {
      return NextResponse.json({ error: '퇴근 시각은 30분 단위로 입력해주세요.' }, { status: 400 })
    }

    // ─── 시간/장소 도출 ──────────────────────────────────────────────────────
    const tlFirst = timeline ? firstWorkLocation(timeline) : null
    const tlEnd   = timeline ? endItemOf(timeline) : null
    const startTime = isAllDayLeave
      ? '09:00'
      : (body.start_time ?? tlFirst?.startTime ?? '09:00')
    const endTime   = isAllDayLeave
      ? '18:00'
      : (body.end_time ?? tlEnd?.startTime ?? '18:00')
    const workLocation = isAllDayLeave
      ? '휴가'
      : (firstChipLabel(plannedLocations)
          || (tlFirst ? displayLocation(tlFirst) : (body.work_location ?? '사무실')))
    const locationSummary = isAllDayLeave
      ? '휴가'
      : (formatChipsArrow(plannedLocations)
          || (timeline ? buildLocationSummary(timeline) : workLocation)
          || workLocation)

    const leaveMinutes = totalLeaveRoundedMinutes(leaveTimeline ?? [])

    const calcResult = calculateEw({
      name,
      workTypeLabel: '기본근무 등록',
      leaveDate: date,
      startTime,
      endTime,
      breakTime,
      workLocation: locationSummary,
      workContent,
      leaveMinutes,
      isFullDayLeave: isAllDayLeave,
    })

    if (!isHalfHour(calcResult.actualWorkMinutes)) {
      console.warn('[/check-in] non-30min actual auto-snapped',
        { user: user.email, raw: calcResult.actualWorkMinutes, startTime, endTime, breakTime })
    }

    // ─── D-day 본문 row 찾기 (leave_date 매칭) ───────────────────────────────
    // 사전 보고(leave_date=D-1, expected_start_date=D-day)는 안 건드림.
    let workLogId: string | null = body.work_log_id ?? null
    if (!workLogId) {
      const { data: todayLog } = await adminClient
        .from('work_logs')
        .select('id')
        .eq('user_email', user.email!)
        .eq('leave_date', date)
        .eq('is_deleted', false)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      workLogId = todayLog?.id ?? null
    }

    const willCreateNewLog = !workLogId

    const checkedInAt: string =
      body.checked_in_at
      ?? new Date(`${date}T${startTime}:00+09:00`).toISOString()

    // ─── D-day work_log: INSERT 또는 UPDATE ─────────────────────────────────
    // 본문 영역만 처리 — expected_*는 NULL (다음 출근 예정은 퇴근보고 단계에서)
    const bodyArea = {
      name,
      work_type_label: '기본근무 등록',
      work_type_code:  calcResult.workTypeCode,
      leave_date:      date,
      start_time:      startTime,
      end_time:        endTime,
      break_time:      `${breakTime}:00`,
      work_content:    workContent || null,
      // legacy mirror
      work_location:        workLocation,
      work_location_type:   tlFirst?.type === 'custom' ? '기타' : (tlFirst?.label ?? (isAllDayLeave ? null : '사무실')),
      work_location_custom: tlFirst?.type === 'custom' ? (tlFirst.customLabel ?? null) : null,
      work_location_timeline: timeline,
      // v2 — actual은 NULL (정책: 출근만 했고 아직 일 안함, 표시는 planned fallback)
      planned_work_locations: plannedLocations,
      actual_work_locations:  null,
      leave_timeline:         leaveTimeline,
      late_or_attendance_status: '아니오',
      attendance_record_type: '출근보고 진행 (주말출근, 휴가 포함)',
      // expected_* — D-day 본문에서는 비움 (다음 출근 예정은 퇴근보고에서)
      expected_start_date:    null,
      expected_work_time:     null,
      expected_work_location: null,
      expected_work_location_timeline: null,
      expected_leave_timeline: null,
      deduction_time: `${calcResult.deductionMinutes} minutes`,
      actual_work_time: `${snapMinutes(calcResult.actualWorkMinutes, 'round')} minutes`,
      ew_start:  calcResult.ewStartText,
      ew_end:    calcResult.ewEndText,
      ew_value:  calcResult.ewValue,
      copy_text: calcResult.copyText,
    }

    if (workLogId) {
      // UPDATE — 기존 D-day row 갱신 (재작성 케이스)
      const { error: updErr } = await adminClient
        .from('work_logs')
        .update({ ...bodyArea, updated_at: submissionNow, updated_by: user.id })
        .eq('id', workLogId)
      if (updErr) throw updErr
    } else {
      // INSERT — D-day 신규 row
      const { data: newLog, error: insErr } = await adminClient
        .from('work_logs')
        .insert({
          ...bodyArea,
          user_id:    user.id,
          user_email: user.email!,
          division:   profile?.division ?? null,
          team:       profile?.team     ?? null,
          teams_sent: false,
          is_deleted: false,
          location_history: JSON.stringify([
            { time: new Date().toTimeString().slice(0, 5), location: workLocation, source: 'initial' }
          ]),
        })
        .select()
        .single()
      if (insErr) throw insErr
      workLogId = newLog.id
    }

    // ─── submissions 로그 ─────────────────────────────────────────────────
    void recordSubmission({
      user_id: user.id,
      user_email: user.email!,
      name,
      division: profile?.division ?? null,
      team:     profile?.team ?? null,
      report_type: 'check_in',
      target_date: date,
      submitted_at: submissionNow,
      work_log_id: workLogId,
      // 출근보고 영역 (당일 출근정보)
      start_time:      startTime,
      end_time:        endTime,
      work_location:   workLocation,
      work_location_timeline: timeline ?? null,
      leave_timeline:         leaveTimeline ?? null,
      planned_work_locations: plannedLocations ?? null,
      // expected_* 비움
      work_type_label: '기본근무 등록',
      work_type_code:  calcResult.workTypeCode,
      attendance_record_type: '출근보고 진행 (주말출근, 휴가 포함)',
    })

    await adminClient
      .from('user_profiles')
      .update({ last_submitted_at: submissionNow })
      .eq('email', user.email!)

    // ─── daily_work_status ────────────────────────────────────────────────
    const currentLocation = firstChipLabel(plannedLocations)
      || (tlFirst ? displayLocation(tlFirst) : (body.work_location ?? body.work_location_type ?? '사무실'))

    const { data: daily, error: dailyErr } = await adminClient
      .from('daily_work_status')
      .upsert({
        work_date:        date,
        user_email:       user.email!,
        user_profile_id:  profile?.id ?? null,
        work_log_id:      workLogId,
        status:           'working',
        current_location: currentLocation,
        checked_in_at:    checkedInAt,
        checked_out_at:   null,
        is_on_break:      false,
        updated_at:       submissionNow,
      }, { onConflict: 'work_date,user_email' })
      .select()
      .single()

    if (dailyErr) throw dailyErr

    await adminClient.from('work_status_events').insert({
      work_date:       date,
      user_email:      user.email!,
      user_profile_id: profile?.id ?? null,
      work_log_id:     workLogId,
      event_type:      willCreateNewLog ? 'report_created_from_check_in' : 'check_in_re_submitted',
      event_value:     { location: currentLocation, declared_check_in_at: checkedInAt },
      event_at:        submissionNow,
      created_by:      user.email!,
    })

    notifyCheckinSubmitted({
      name: profile?.display_name || body.name || user.email!,
      date,
      checkedInAt,
      workLocation: currentLocation,
      timeline: timeline ?? undefined,
      plannedWorkLocations: plannedLocations ?? undefined,
      leaveTimeline: leaveTimeline ?? undefined,
      division: profile?.division ?? null,
      team: profile?.team ?? null,
    })

    return NextResponse.json(daily)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[/api/team-status/check-in]', message)
    return NextResponse.json({ error: '서버 에러가 발생했습니다.' }, { status: 500 })
  }
}
