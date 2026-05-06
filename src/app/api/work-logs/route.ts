import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { calculateEw } from '@/lib/ew-calculator'
import { requireActiveUser } from '@/lib/admin-check'
import { notifyWorkLogSubmitted, notifyCheckoutResubmitted } from '@/lib/notifications/teams'
import {
  validateTimeline,
  firstWorkLocation,
  endItemOf,
  displayLocation,
  buildLocationSummary,
} from '@/lib/work-location-timeline'
import {
  validateLeaveTimeline,
  isFullDayLeave,
  totalLeaveRoundedMinutes,
  ceilTo30Min,
} from '@/lib/leave-timeline'
import {
  snapMinutes,
  snapHHmm,
  isHalfHour,
  isHalfHourHHmm,
  hhmmToMinutes,
} from '@/lib/utils/half-hour'
import type { WorkLocationTimeline } from '@/types/work-location-timeline'
import type { LeaveTimeline } from '@/types/leave-timeline'

export async function POST(request: Request) {
  try {
    const user = await requireActiveUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized or Inactive account' }, { status: 403 })
    }

    const body = await request.json()

    // ─── 휴가 타임라인 처리 ─────────────────────────────────────────────────
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
    const leaveAllDay = isFullDayLeave(leaveTimeline ?? [])
    const leaveMinutes = totalLeaveRoundedMinutes(leaveTimeline ?? [])
    // leaveIncludesLunch 자동 처리 제거 — 사용자가 차감시간 직접 조정

    // ─── 다음 출근 예정 휴가 타임라인 처리 ─────────────────────────────────────
    let expectedLeaveTimeline: LeaveTimeline | null = null
    if (Array.isArray(body.expectedLeaveTimeline) && body.expectedLeaveTimeline.length > 0) {
      const exLeErrors = validateLeaveTimeline(body.expectedLeaveTimeline as LeaveTimeline)
      if (exLeErrors.length > 0) {
        return NextResponse.json(
          { error: '다음 출근 예정 휴가 정보가 올바르지 않습니다: ' + exLeErrors.map(e => e.message).join(', ') },
          { status: 400 }
        )
      }
      expectedLeaveTimeline = body.expectedLeaveTimeline as LeaveTimeline
    }

    // ─── 본문 근무장소 타임라인 처리 (퇴근보고용) ────────────────────────────
    // 신규: body.workLocationTimeline 우선
    // legacy: body.workLocationType / workLocationCustom / startTime / endTime
    let workLocationTimeline: WorkLocationTimeline | null = null
    let workTimelineFirst: ReturnType<typeof firstWorkLocation> = null
    let workTimelineEnd: ReturnType<typeof endItemOf> = null

    if (Array.isArray(body.workLocationTimeline) && body.workLocationTimeline.length > 0) {
      const wlErrors = validateTimeline(body.workLocationTimeline as WorkLocationTimeline)
      if (wlErrors.length > 0) {
        return NextResponse.json(
          { error: '근무장소 타임라인이 올바르지 않습니다: ' + wlErrors.map(e => e.message).join(', ') },
          { status: 400 }
        )
      }
      workLocationTimeline = body.workLocationTimeline as WorkLocationTimeline
      // 퇴근보고는 마지막 항목이 'checkout' (실제 퇴근)이어야 함 (단, 종일 휴가 예외)
      const last = workLocationTimeline[workLocationTimeline.length - 1]
      if (last.kind !== 'checkout') {
        return NextResponse.json(
          { error: '퇴근보고의 마지막 항목은 실제 퇴근 시각이어야 합니다.' },
          { status: 400 }
        )
      }
      workTimelineFirst = firstWorkLocation(workLocationTimeline)
      workTimelineEnd = endItemOf(workLocationTimeline)
    } else if (leaveAllDay) {
      // 종일 휴가는 work_location_timeline 비어도 OK
      workLocationTimeline = null
    }

    // 폼 클라이언트에서 workLocationType/Custom/Time도 timeline으로부터 도출해 보내옴.
    // timeline이 없는 (legacy) 클라이언트의 경우만 body 단일 필드를 그대로 사용.
    // 종일 휴가는 09:00~18:00 가정 + workLocation = '휴가'
    const finalWorkLocation: string = leaveAllDay
      ? '휴가'
      : (workTimelineFirst
          ? displayLocation(workTimelineFirst)
          : (body.workLocationType === '기타'
              ? (body.workLocationCustom ?? '')
              : (body.workLocationType ?? '')))
    const finalStartTime: string = leaveAllDay
      ? '09:00'
      : (workTimelineFirst?.startTime ?? body.startTime ?? '09:00')
    const finalEndTime: string = leaveAllDay
      ? '18:00'
      : (workTimelineEnd?.startTime ?? body.endTime ?? '18:00')
    const locationSummary: string = leaveAllDay
      ? '휴가'
      : (workLocationTimeline
          ? (buildLocationSummary(workLocationTimeline) || finalWorkLocation)
          : finalWorkLocation)

    // ─── 휴게 4분리 + 30분 정책 강제 (round) ────────────────────────────────
    // breakAutoActualMin은 raw(보존), 나머지 _roundedMinutes는 30분 배수여야 함.
    const breakAutoActualMin: number = Number.isFinite(body.breakAutoActualMinutes)
      ? Math.max(0, Number(body.breakAutoActualMinutes)) : 0
    const breakAutoRoundedMinRaw: number = Number.isFinite(body.breakAutoRoundedMinutes)
      ? Math.max(0, Number(body.breakAutoRoundedMinutes)) : ceilTo30Min(breakAutoActualMin)
    const breakAutoRoundedMin = snapMinutes(breakAutoRoundedMinRaw, 'round')
    const breakManualRoundedMinRaw: number | null = (
      body.breakManualRoundedMinutes !== undefined && body.breakManualRoundedMinutes !== null
    ) ? Math.max(0, Number(body.breakManualRoundedMinutes)) : null
    const breakManualRoundedMin = breakManualRoundedMinRaw === null
      ? null
      : snapMinutes(breakManualRoundedMinRaw, 'round')
    const breakFinalRoundedMinRaw: number = Number.isFinite(body.breakFinalRoundedMinutes)
      ? Math.max(0, Number(body.breakFinalRoundedMinutes))
      : (breakManualRoundedMin ?? breakAutoRoundedMin)
    const breakFinalRoundedMin = snapMinutes(breakFinalRoundedMinRaw, 'round')

    // body.breakTime("HH:MM") 도 30분 단위만 허용
    if (body.breakTime && !isHalfHourHHmm(body.breakTime)) {
      return NextResponse.json(
        { error: '휴게시간은 30분 단위(00 또는 30분)만 입력 가능합니다.' },
        { status: 400 }
      )
    }
    // start/end fallback (timeline 없는 legacy 클라이언트) 도 30분만
    if (body.startTime && !isHalfHourHHmm(body.startTime)) {
      return NextResponse.json(
        { error: '출근 시각은 30분 단위(00 또는 30분)만 입력 가능합니다.' },
        { status: 400 }
      )
    }
    if (body.endTime && !isHalfHourHHmm(body.endTime)) {
      return NextResponse.json(
        { error: '퇴근 시각은 30분 단위(00 또는 30분)만 입력 가능합니다.' },
        { status: 400 }
      )
    }

    // ─── 출근보고 (다음 출근 예정) 타임라인 처리 ──────────────────────────────
    // 신규: body.expectedTimeline (배열) — 우선 사용
    // 구버전 fallback: body.expectedWorkLocationType / expectedWorkLocation / expectedWorkTime
    //   → timeline이 없을 때만 단일 항목으로 간주
    let expectedTimeline: WorkLocationTimeline | null = null
    let mirrorExpectedWorkLocation: string | null = null
    let mirrorExpectedWorkTime: string | null = null

    if (body.attendanceRecordType === '출근보고 진행 (주말출근, 휴가 포함)') {
      if (Array.isArray(body.expectedTimeline)) {
        const timelineErrors = validateTimeline(body.expectedTimeline as WorkLocationTimeline)
        if (timelineErrors.length > 0) {
          return NextResponse.json(
            { error: '출근 예정 타임라인이 올바르지 않습니다: ' + timelineErrors.map(e => e.message).join(', ') },
            { status: 400 }
          )
        }
        expectedTimeline = body.expectedTimeline as WorkLocationTimeline
        const first = firstWorkLocation(expectedTimeline)
        mirrorExpectedWorkLocation = first ? displayLocation(first) : null
        mirrorExpectedWorkTime = first?.startTime ?? null
      } else {
        // legacy body — timeline 없이 단일 필드로 들어온 경우
        mirrorExpectedWorkLocation =
          body.expectedWorkLocationType === '기타'
            ? (body.expectedWorkLocation ?? null)
            : (body.expectedWorkLocationType ?? body.expectedWorkLocation ?? null)
        mirrorExpectedWorkTime = body.expectedWorkTime ?? null
      }
    }
    const finalExpectedWorkLocation: string | null = mirrorExpectedWorkLocation

    // EW 계산 시 휴게는 break_final_rounded_minutes를 'HH:mm'으로 환산해 사용
    const breakHHForCalc: string = (() => {
      const m = breakFinalRoundedMin
      const h = Math.floor(m / 60)
      const mm = m % 60
      return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
    })()

    // 명일 시각(24+ HH) → DB의 PG `time` 컬럼은 0~24만 받으므로 mod 24 처리.
    // EW 계산기와 timeline JSONB는 raw 24+ 값을 그대로 사용해야 정확함.
    const mod24HHmm = (hhmm: string): string => {
      if (!hhmm) return hhmm
      const [hStr, mStr] = hhmm.split(':')
      const h = parseInt(hStr, 10)
      if (!Number.isFinite(h)) return hhmm
      return `${String(h % 24).padStart(2, '0')}:${(mStr ?? '00').padStart(2, '0')}`
    }
    const dbStartTime = mod24HHmm(finalStartTime)
    const dbEndTime   = mod24HHmm(finalEndTime)

    const calcResult = calculateEw({
      name: body.name,
      workTypeLabel: body.workTypeLabel,
      leaveDate: body.leaveDate,
      startTime: finalStartTime,
      endTime: finalEndTime,
      breakTime: breakHHForCalc,
      workLocation: locationSummary,
      workContent: body.workContent,
      breakReason: body.breakReason,
      leaveMinutes,
      // leaveIncludesLunch 자동 처리 안 함 — 사용자가 차감시간 직접 조정
    })

    // ─── 30분 정책 최종 강제 — actual_work_time을 30분 단위로 스냅 ──────────
    // 입력값이 모두 30분 단위면 결과도 자연히 30분 단위가 됨. 그래도 방어적으로 round 적용.
    const snappedActualMin = snapMinutes(calcResult.actualWorkMinutes, 'round')
    if (!isHalfHour(calcResult.actualWorkMinutes)) {
      // 비30분 결과가 나오면 입력 어딘가가 비30분 → 사후 보정 + 경고 로그
      console.warn(
        '[/api/work-logs POST] non-30min actual_work_time auto-snapped',
        { raw: calcResult.actualWorkMinutes, snapped: snappedActualMin,
          start: finalStartTime, end: finalEndTime, break: breakFinalRoundedMin, leave: leaveMinutes }
      )
    }

    let userDivision: string | null = null
    let userTeam: string | null = null
    try {
      const adminClientForProfile = createAdminClient()
      const { data: profileSnap } = await adminClientForProfile
        .from('user_profiles')
        .select('division, team')
        .eq('id', user.id)
        .single()
      userDivision = profileSnap?.division ?? null
      userTeam = profileSnap?.team ?? null
    } catch {
      // 프로필 조회 실패 시 null로 진행
    }

    const insertData = {
      user_id: user.id,
      user_email: user.email,
      division: userDivision,
      team: userTeam,
      name: body.name,
      work_type_label: body.workTypeLabel,
      work_type_code: calcResult.workTypeCode,
      leave_date: body.leaveDate,
      start_time: dbStartTime,
      end_time:   dbEndTime,
      break_time: body.breakTime ? `${body.breakTime}:00` : '00:00:00',
      break_reason: body.breakReason || null,
      work_content: body.workContent || null,
      work_location: finalWorkLocation,
      work_location_type: body.workLocationType || null,
      work_location_custom: body.workLocationType === '기타' ? body.workLocationCustom : null,
      work_location_timeline: workLocationTimeline,
      late_or_attendance_status: body.lateOrAttendanceStatus || null,
      previous_report_time: body.lateOrAttendanceStatus === '예' ? body.previousReportTime : null,
      current_report_time: body.lateOrAttendanceStatus === '예' ? body.currentReportTime : null,
      late_reason: body.lateOrAttendanceStatus === '예' ? body.lateReason : null,
      attendance_record_type: body.attendanceRecordType || null,
      expected_start_date: body.attendanceRecordType === '출근보고 진행 (주말출근, 휴가 포함)' ? body.expectedStartDate : null,
      expected_work_time: mirrorExpectedWorkTime,
      expected_work_location: finalExpectedWorkLocation,
      expected_work_location_timeline: expectedTimeline,
      expected_leave_timeline: expectedLeaveTimeline,
      // 휴가/휴게 분리
      leave_timeline: leaveTimeline,
      break_auto_actual_minutes:    breakAutoActualMin,
      break_auto_rounded_minutes:   breakAutoRoundedMin,
      break_manual_rounded_minutes: breakManualRoundedMin,
      break_final_rounded_minutes:  breakFinalRoundedMin,
      thanks_macaron: body.thanksMacaron || null,
      deduction_time: `${calcResult.deductionMinutes} minutes`,
      actual_work_time: `${snappedActualMin} minutes`,
      ew_start: calcResult.ewStartText,
      ew_end: calcResult.ewEndText,
      ew_value: calcResult.ewValue,
      copy_text: calcResult.copyText,
      teams_sent: false,
      is_deleted: false,
    }

    const adminClient = createAdminClient()

    if (body.resubmitLogId) {
      await adminClient.from('work_logs').update({ is_deleted: true }).eq('id', body.resubmitLogId)
    }
    const { data, error } = await adminClient
      .from('work_logs')
      .insert([insertData])
      .select()
      .single()

    if (error) {
      console.error('DB Insert Error:', error)
      return NextResponse.json({ error: `데이터 저장 실패: ${error.message}` }, { status: 500 })
    }

    try {
      const { data: profile } = await adminClient
        .from('user_profiles')
        .select('display_name')
        .eq('id', user.id)
        .single()

      const profileUpdates: Record<string, unknown> = {
        last_submitted_at: new Date().toISOString(),
      }
      if (!profile?.display_name && body.name) {
        profileUpdates.display_name = body.name.trim()
      }

      await adminClient
        .from('user_profiles')
        .update(profileUpdates)
        .eq('id', user.id)
    } catch {
      // 비핵심 처리 — 실패 무시
    }

    const notifyPayload = {
      name: body.name ?? '',
      leaveDate: body.leaveDate ?? '',
      workTypeLabel: body.workTypeLabel ?? '',
      workLocation: finalWorkLocation,
      workLocationTimeline,
      leaveTimeline,
      breakAutoActualMinutes: breakAutoActualMin,
      breakAutoRoundedMinutes: breakAutoRoundedMin,
      breakFinalRoundedMinutes: breakFinalRoundedMin,
      breakIsManual: breakManualRoundedMin !== null,
      actualWorkMinutes: calcResult.actualWorkMinutes,
      leaveMinutes,
      startTime: finalStartTime,
      endTime: finalEndTime,
      breakTime: breakHHForCalc + ':00',
      lateOrAttendanceStatus: body.lateOrAttendanceStatus || '아니오',
      previousReportTime: body.lateOrAttendanceStatus === '예' ? (body.previousReportTime ?? null) : null,
      currentReportTime:  body.lateOrAttendanceStatus === '예' ? (body.currentReportTime ?? null) : null,
      lateReason:         body.lateOrAttendanceStatus === '예' ? (body.lateReason ?? null) : null,
      workContent: body.workContent || null,
      attendanceRecordType: body.attendanceRecordType || null,
      expectedStartDate:    body.attendanceRecordType === '출근보고 진행 (주말출근, 휴가 포함)' ? (body.expectedStartDate ?? null) : null,
      expectedWorkTime:     mirrorExpectedWorkTime,
      expectedWorkLocation: finalExpectedWorkLocation,
      expectedTimeline,
      division: userDivision,
      team: userTeam,
    }

    if (body.resubmitLogId) {
      notifyCheckoutResubmitted(notifyPayload)
    } else {
      notifyWorkLogSubmitted(notifyPayload)
    }

    return NextResponse.json(data)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('Work Log API Error:', message)
    return NextResponse.json({ error: '서버 에러가 발생했습니다.' }, { status: 500 })
  }
}

export async function GET(request: Request) {
  try {
    const user = await requireActiveUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized or Inactive account' }, { status: 403 })
    }

    const supabase = await createClient()

    const { searchParams } = new URL(request.url)
    const mine = searchParams.get('mine') === 'true'
    const filterDivision = searchParams.get('division') ?? ''
    const filterTeam = searchParams.get('team') ?? ''
    // 기본 200건. 명시적 limit 요청 시 최대 500까지 (이전 1000은 페이로드 과대).
    // UI는 my-logs(100), history는 별도 limit 안 줘도 200이면 충분.
    const limitParam = searchParams.get('limit')
    const limit = limitParam ? Math.min(Math.max(Number(limitParam) || 0, 1), 500) : 200

    let query = supabase
      .from('work_logs')
      .select('*')
      .eq('is_deleted', false)
      .order('leave_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(limit)

    if (mine) {
      query = query.eq('user_id', user.id)
    } else if (filterDivision || filterTeam) {
      try {
        const adminClientForFilter = createAdminClient()
        let profileQuery = adminClientForFilter
          .from('user_profiles')
          .select('email')

        if (filterDivision) profileQuery = profileQuery.eq('division', filterDivision)
        if (filterTeam) profileQuery = profileQuery.eq('team', filterTeam)

        const { data: matchedProfiles } = await profileQuery
        const matchedEmails = (matchedProfiles ?? []).map((p: { email: string }) => p.email)

        if (matchedEmails.length === 0) {
          return NextResponse.json([])
        }
        query = query.in('user_email', matchedEmails)
      } catch {
        // 필터 조회 실패 시 필터 없이 전체 반환
      }
    }

    const { data, error } = await query

    if (error) throw error

    return NextResponse.json(data)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('Work Log GET Error:', message)
    return NextResponse.json({ error: '서버 에러가 발생했습니다.' }, { status: 500 })
  }
}
