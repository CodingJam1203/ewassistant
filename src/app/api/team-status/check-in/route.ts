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
import type { WorkLocationTimeline } from '@/types/work-location-timeline'
import type { LeaveTimeline } from '@/types/leave-timeline'

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json()
    const date: string = body.date ?? getKstTodayDateString()
    // 실제 제출 시각 (감사/이벤트 로그용)
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

    // ─── 근무장소 타임라인 결정 ──────────────────────────────────────────────
    // 신규: body.workLocationTimeline (배열) — 우선
    // 구버전 fallback: body.work_location/work_location_type/start_time/end_time
    // 종일 휴가일 때는 빈 배열 허용 (일하지 않으므로)
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
      // legacy body 자동 합성 (종일 휴가 케이스 제외)
      timeline = legacyToTimeline({
        expectedWorkLocation: body.work_location ?? null,
        expectedWorkLocationType: body.work_location_type ?? null,
        expectedWorkTime: body.start_time ?? null,
        fallbackCheckoutTime: body.end_time ?? null,
        asExpected: true,
      })
    }
    // 종일 휴가가 아닌데 timeline이 비었으면 에러
    if (!isAllDayLeave && (!timeline || timeline.length === 0)) {
      return NextResponse.json(
        { error: '근무장소 타임라인이 필요합니다 (종일 휴가가 아닌 경우).' },
        { status: 400 }
      )
    }

    let workLogId: string | null = body.work_log_id ?? null

    // timeline 기준 출근 시각 ISO 계산 (KST → UTC 변환).
    // 1) body.checked_in_at이 명시적으로 들어왔으면 그대로 사용 (출근 버튼 흐름)
    // 2) 그렇지 않고 timeline 첫 항목이 있으면 그 시각을 KST 기준 ISO로 변환
    // 3) 둘 다 없으면 제출 시각으로 fallback
    const firstForTime = timeline ? firstWorkLocation(timeline) : null
    const checkedInAt: string =
      body.checked_in_at
      ?? (firstForTime
            ? new Date(`${date}T${firstForTime.startTime}:00+09:00`).toISOString()
            : submissionNow)

    if (!workLogId) {
      const breakTime    = body.break_time    ?? '00:00'
      const workContent  = body.work_content  ?? ''
      const name         = body.name ?? profile?.display_name ?? user.email!

      // 30분 정책 — break_time / start_time / end_time 비30분 입력은 reject
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

      // timeline에서 start/end/work_location 도출 (종일 휴가는 09:00~18:00 가정)
      const first  = timeline ? firstWorkLocation(timeline) : null
      const endIt  = timeline ? endItemOf(timeline) : null
      const startTime    = isAllDayLeave ? '09:00' : (first?.startTime ?? body.start_time ?? '09:00')
      const endTime      = isAllDayLeave ? '18:00' : (endIt?.startTime ?? body.end_time ?? '18:00')
      const workLocation = isAllDayLeave
        ? '휴가'
        : (first ? displayLocation(first) : (body.work_location ?? '사무실'))
      const locationSummary = isAllDayLeave
        ? '휴가'
        : (timeline ? (buildLocationSummary(timeline) || workLocation) : workLocation)

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
        // leaveIncludesLunch 자동 처리 안 함 — 사용자가 차감시간 직접 조정
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
          work_location:  workLocation,
          work_location_type: first?.type === 'custom' ? '기타' : (first?.label ?? (isAllDayLeave ? null : '사무실')),
          work_location_custom: first?.type === 'custom' ? (first.customLabel ?? null) : null,
          work_location_timeline: timeline,
          // 휴가
          leave_timeline: leaveTimeline,
          late_or_attendance_status: '아니오',
          // 출근 경로(CheckInModal)에서 만든 record는 다음 출근 사전 보고를 포함하지 않음.
          // → '스킵'으로 저장해야 my-logs 등에서 일관되게 표시되고,
          //   수정 시 WorkLogModal에서도 '스킵' default로 prefill됨.
          attendance_record_type: '스킵(누락퇴근보고, 퇴근보고 수정)',
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

      await adminClient
        .from('user_profiles')
        .update({ last_submitted_at: submissionNow })
        .eq('email', user.email!)
    }

    // 카드 표시용 currentLocation: timeline 첫 항목 라벨 또는 기존 fallback
    const firstWLForCurrent = timeline ? firstWorkLocation(timeline) : null
    const currentLocation = firstWLForCurrent
      ? displayLocation(firstWLForCurrent)
      : (body.work_location ?? body.work_location_type ?? '사무실')

    const { data: daily, error: dailyErr } = await adminClient
      .from('daily_work_status')
      .upsert({
        work_date:        date,
        user_email:       user.email!,
        user_profile_id:  profile?.id ?? null,
        work_log_id:      workLogId,
        status:           'working',
        current_location: currentLocation,
        checked_in_at:    checkedInAt,    // 타임라인 첫 항목 시각 (KST 기준)
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
      event_type:      workLogId !== body.work_log_id ? 'report_created_from_check_in' : 'check_in',
      event_value:     { location: currentLocation, declared_check_in_at: checkedInAt },
      event_at:        submissionNow,
      created_by:      user.email!,
    })

    // Teams 출근 알림 — 사용자 의도 출근 시각(타임라인 첫 항목)으로 표시
    notifyCheckinSubmitted({
      name: profile?.display_name || body.name || user.email!,
      date,
      checkedInAt,
      workLocation: currentLocation,
      timeline: timeline ?? undefined,
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
