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

    // ─── v2: 신규 chips 처리 ─────────────────────────────────────────────────
    // body.plannedWorkLocations 우선. 없으면 legacy timeline에서 변환.
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

    // ─── legacy timeline 결정 (호환용) ──────────────────────────────────────
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

    // v2 plannedLocations이 없으면 legacy timeline에서 도출
    if (!plannedLocations) {
      plannedLocations = legacyTimelineToLocations(timeline)
        ?? legacySingleToLocations(body.work_location ?? null)
    }

    // 종일 휴가가 아닌데 v2/legacy 모두 비었으면 에러
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

    // ── 사전 출근보고 탐지 ─────────────────────────────────────────────────
    type PriorReport = {
      id: string
      expected_work_time: string | null
      expected_work_location: string | null
      expected_work_location_timeline: WorkLocationTimeline | null
      expected_leave_timeline: LeaveTimeline | null
    }
    let existingPriorReport: PriorReport | null = null
    if (!body.work_log_id) {
      const { data: prior } = await adminClient
        .from('work_logs')
        .select('id, expected_work_time, expected_work_location, expected_work_location_timeline, expected_leave_timeline')
        .eq('user_email', user.email!)
        .eq('expected_start_date', date)
        .eq('is_deleted', false)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      existingPriorReport = (prior as unknown as PriorReport | null) ?? null
    }

    let workLogId: string | null =
      body.work_log_id ?? existingPriorReport?.id ?? null
    const willCreateNewLog = !workLogId

    // checked_in_at 결정 — body.start_time(v2) 우선, timeline first fallback
    const startTimeForIso: string | null = body.start_time
      ?? (timeline ? (firstWorkLocation(timeline)?.startTime ?? null) : null)
    const checkedInAt: string =
      body.checked_in_at
      ?? (startTimeForIso
            ? new Date(`${date}T${startTimeForIso}:00+09:00`).toISOString()
            : submissionNow)

    if (!workLogId) {
      const breakTime    = body.break_time    ?? '00:00'
      const workContent  = body.work_content  ?? ''
      const name         = body.name ?? profile?.display_name ?? user.email!

      if (breakTime && !isHalfHourHHmm(breakTime)) {
        return NextResponse.json(
          { error: '휴게시간은 30분 단위(00 또는 30분)만 입력 가능합니다.' },
          { status: 400 }
        )
      }
      if (body.start_time && !isHalfHourHHmm(body.start_time)) {
        return NextResponse.json(
          { error: '출근 시각은 30분 단위(00 또는 30분)만 입력 가능합니다.' },
          { status: 400 }
        )
      }
      if (body.end_time && !isHalfHourHHmm(body.end_time)) {
        return NextResponse.json(
          { error: '퇴근 시각은 30분 단위(00 또는 30분)만 입력 가능합니다.' },
          { status: 400 }
        )
      }

      // 시간/장소 라벨 도출 — v2 우선, legacy fallback
      const tlFirst = timeline ? firstWorkLocation(timeline) : null
      const tlEnd   = timeline ? endItemOf(timeline) : null
      const startTime    = isAllDayLeave
        ? '09:00'
        : (body.start_time ?? tlFirst?.startTime ?? '09:00')
      const endTime      = isAllDayLeave
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
        console.warn(
          '[/api/team-status/check-in] non-30min actual_work_time auto-snapped',
          { user: user.email, raw: calcResult.actualWorkMinutes, startTime, endTime, breakTime, leaveMinutes }
        )
      }

      const { data: newLog, error: logErr } = await adminClient
        .from('work_logs')
        .insert({
          user_id:        user.id,
          user_email:     user.email!,
          name,
          division:       profile?.division ?? null,
          team:           profile?.team     ?? null,
          work_type_label: '기본근무 등록',
          work_type_code:  calcResult.workTypeCode,
          leave_date:     date,
          start_time:     startTime,
          end_time:       endTime,
          break_time:     `${breakTime}:00`,
          work_content:   workContent || null,
          // legacy mirror (단일 문자열)
          work_location:  workLocation,
          work_location_type: tlFirst?.type === 'custom' ? '기타' : (tlFirst?.label ?? (isAllDayLeave ? null : '사무실')),
          work_location_custom: tlFirst?.type === 'custom' ? (tlFirst.customLabel ?? null) : null,
          work_location_timeline: timeline,
          // v2 — 출근 시점엔 planned만 저장. actual은 NULL (아직 일 안 함 → 표시 fallback으로 planned가 노출)
          planned_work_locations: plannedLocations,
          actual_work_locations: null,
          // 휴가
          leave_timeline: leaveTimeline,
          late_or_attendance_status: '아니오',
          attendance_record_type: '출근보고 진행 (주말출근, 휴가 포함)',
          // expected_* (legacy mirror)
          expected_start_date:    date,
          expected_work_time:     startTime,
          expected_work_location: workLocation,
          expected_work_location_timeline: timeline,
          expected_leave_timeline: leaveTimeline,
          deduction_time: `${calcResult.deductionMinutes} minutes`,
          actual_work_time: `${snapMinutes(calcResult.actualWorkMinutes, 'round')} minutes`,
          ew_start:  calcResult.ewStartText,
          ew_end:    calcResult.ewEndText,
          ew_value:  calcResult.ewValue,
          copy_text: calcResult.copyText,
          teams_sent: false,
          is_deleted: false,
          location_history: JSON.stringify([
            { time: new Date().toTimeString().slice(0, 5), location: workLocation, source: 'initial' }
          ]),
        })
        .select()
        .single()

      if (logErr) throw logErr
      workLogId = newLog.id

      // ─── submissions 로그 (check_in: 당일 출근보고) ─────────────────
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
        expected_start_date:    date,
        expected_work_time:     startTime,
        expected_work_location: workLocation,
        expected_work_location_timeline: timeline ?? null,
        expected_leave_timeline: leaveTimeline ?? null,
        // v2
        planned_work_locations: plannedLocations ?? null,
        work_type_label: '기본근무 등록',
        work_type_code:  calcResult.workTypeCode,
        attendance_record_type: '출근보고 진행 (주말출근, 휴가 포함)',
      })

      await adminClient
        .from('user_profiles')
        .update({ last_submitted_at: submissionNow })
        .eq('email', user.email!)
    } else if (existingPriorReport) {
      // ─── 사전 보고가 있는 경우 — work_log expected_*는 보존하되 actual은 갱신
      const tlFirstSub = timeline ? firstWorkLocation(timeline) : null
      const actualStartTime = body.start_time
        ?? tlFirstSub?.startTime
        ?? null
      const actualLocation = firstChipLabel(plannedLocations)
        || (tlFirstSub ? displayLocation(tlFirstSub) : (body.work_location ?? null))

      // 사전 보고가 있는 경우 — work_log expected_*는 보존하되 actual은 갱신하지 않음
      // (출근 시점엔 actual=NULL 정책. 표시 fallback으로 planned가 자연스럽게 노출됨)

      void recordSubmission({
        user_id: user.id,
        user_email: user.email!,
        name: profile?.display_name ?? user.email!,
        division: profile?.division ?? null,
        team:     profile?.team ?? null,
        report_type: 'check_in',
        target_date: date,
        submitted_at: submissionNow,
        work_log_id: workLogId,
        start_time:      actualStartTime,
        work_location:   actualLocation,
        work_location_timeline: timeline ?? null,
        leave_timeline:         leaveTimeline ?? null,
        actual_work_locations: plannedLocations ?? null,
        attendance_record_type: '출근보고 진행 (주말출근, 휴가 포함)',
      })

      await adminClient
        .from('user_profiles')
        .update({ last_submitted_at: submissionNow })
        .eq('email', user.email!)
    }

    // 카드 표시용 currentLocation
    const tlFirstForCurrent = timeline ? firstWorkLocation(timeline) : null
    const currentLocation = firstChipLabel(plannedLocations)
      || (tlFirstForCurrent
            ? displayLocation(tlFirstForCurrent)
            : (body.work_location ?? body.work_location_type ?? '사무실'))

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
      event_type:      willCreateNewLog ? 'report_created_from_check_in' : 'check_in',
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
