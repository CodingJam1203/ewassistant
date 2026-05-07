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
import { recordSubmission } from '@/lib/submission-log'
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

    // ── 사전 출근보고 탐지 ─────────────────────────────────────────────────
    // 룰:
    //   - work_logs 중 expected_start_date = today 인 row가 이미 있으면 = 사전 보고
    //   - 사전 보고가 있으면 expected_*는 절대 손대지 않음 (사용자가 모달에서 만져도 무시)
    //   - 사전 보고가 없으면 body값으로 새 work_log 생성 (지금 로직)
    //   - 사용자 명시적 expected 변경은 카드 [수정] 버튼 → PATCH /api/work-logs/{id} 에서만
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

    // event_type 분기를 위해 "이번 호출에서 새 보고를 만들 예정인지" 미리 캡처
    const willCreateNewLog = !workLogId

    // timeline 기준 출근 시각 ISO 계산 (KST → UTC 변환).
    //   "실제 출근 제출값" — 사용자가 모달에서 입력한 시각이 곧 actual.
    //   사전 보고 있는 경우에도 이 값은 user input 그대로 사용 (실제 출근에만 반영, expected는 보존).
    // 1) body.checked_in_at이 명시적으로 들어왔으면 그대로 사용
    // 2) 그렇지 않고 timeline 첫 항목이 있으면 그 시각을 KST 기준 ISO로 변환
    // 3) 둘 다 없으면 제출 시각으로 fallback
    const firstForTime = timeline ? firstWorkLocation(timeline) : null
    const checkedInAt: string =
      body.checked_in_at
      ?? (firstForTime
            ? new Date(`${date}T${firstForTime.startTime}:00+09:00`).toISOString()
            : submissionNow)

    // 사전 보고가 있거나 body.work_log_id가 명시되면 INSERT 건너뜀 (expected_* 보존)
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
          // 정책: 카드 [출근]과 우측 [출근보고 작성] 모두 '출근보고' 개념으로 통일.
          // - 차이는 단지 대상일(오늘 vs 다른 날) 뿐, my-logs/history에서 동일 배지로 노출.
          // - 카드 [출근]은 expected_start_date를 오늘로 세팅 (= leave_date와 동일)
          //   → my-logs 배지는 '출근만 작성됨' (timeline.last가 expected_checkout이라)
          //   → "+ 사전 출근보고" 배지는 expected_start_date != leave_date 인 경우에만 뜸 (자연 분기).
          attendance_record_type: '출근보고 진행 (주말출근, 휴가 포함)',
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
      // 카드 [출근] = 당일 출근보고. 출근 시점 정보 = 그 날의 출근예정과 동일 의미.
      // → expected_* 영역을 같은 정보로 채워서 SubmissionsRawTable의 출근보고 행에서 정상 표시.
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
        // 출근보고 영역 (실제 출근 정보 = 당일 출근예정과 동일)
        expected_start_date:    date,
        expected_work_time:     startTime,
        expected_work_location: workLocation,
        expected_work_location_timeline: timeline ?? null,
        expected_leave_timeline: leaveTimeline ?? null,
        work_type_label: '기본근무 등록',
        work_type_code:  calcResult.workTypeCode,
        attendance_record_type: '출근보고 진행 (주말출근, 휴가 포함)',
      })

      await adminClient
        .from('user_profiles')
        .update({ last_submitted_at: submissionNow })
        .eq('email', user.email!)
    } else if (existingPriorReport) {
      // ─── 사전 보고가 있는 경우 — work_log expected_*는 보존했지만,
      //     "출근(체크인)" 이벤트 자체는 제출 내역에 남겨야 사용자가 my-logs에서 확인 가능.
      //     - expected_*는 비움 → 사전 보고 작성 row와 시각적으로 구분
      //     - start_time / work_location 에 actual 값을 기록
      //     - SubmissionsRawTable의 시작/장소 컬럼은 start_time/work_location 먼저 fallback expected_*
      const firstForSub = timeline ? firstWorkLocation(timeline) : null
      const actualStartTime = firstForSub?.startTime ?? body.start_time ?? null
      const actualLocation = firstForSub
        ? displayLocation(firstForSub)
        : (body.work_location ?? null)

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
        // 실제 출근 시각/장소 (체크인 이벤트)
        start_time:      actualStartTime,
        work_location:   actualLocation,
        work_location_timeline: timeline ?? null,
        leave_timeline:         leaveTimeline ?? null,
        // expected_*는 보존되었으므로 submission에는 비움
        attendance_record_type: '출근보고 진행 (주말출근, 휴가 포함)',
      })

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
      event_type:      willCreateNewLog ? 'report_created_from_check_in' : 'check_in',
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
