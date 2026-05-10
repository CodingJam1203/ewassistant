import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { calculateEw } from '@/lib/ew-calculator'
import { requireActiveUser } from '@/lib/admin-check'
import { notifyWorkLogSubmitted, notifyCheckoutResubmitted } from '@/lib/notifications/teams'
import { recordSubmission } from '@/lib/submission-log'
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
import type { WorkLocationTimeline } from '@/types/work-location-timeline'
import type { WorkLocations } from '@/types/work-locations-v2'
import type { LeaveTimeline } from '@/types/leave-timeline'

export async function POST(request: Request) {
  try {
    const user = await requireActiveUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized or Inactive account' }, { status: 403 })
    }

    const body = await request.json()

    // ─── 휴가 ────────────────────────────────────────────────────────────────
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

    // 다음 출근 예정 휴가
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

    // ─── v2: 본문 actual chips ──────────────────────────────────────────────
    let actualWorkLocations: WorkLocations | null = null
    if (body.actualWorkLocations !== undefined && body.actualWorkLocations !== null) {
      const norm = normalizeWorkLocations(body.actualWorkLocations)
      if (norm) {
        const errs = validateWorkLocations(norm)
        if (errs.length > 0 && !leaveAllDay) {
          return NextResponse.json(
            { error: '실제 근무장소가 올바르지 않습니다: ' + errs.map(e => e.message).join(', ') },
            { status: 400 }
          )
        }
        actualWorkLocations = norm
      }
    }

    // ─── v2: 다음 출근 예정 planned chips ──────────────────────────────────
    let plannedWorkLocations: WorkLocations | null = null
    if (body.attendanceRecordType === '출근보고 진행 (주말출근, 휴가 포함)' && body.plannedWorkLocations !== undefined && body.plannedWorkLocations !== null) {
      const norm = normalizeWorkLocations(body.plannedWorkLocations)
      if (norm) {
        const errs = validateWorkLocations(norm)
        if (errs.length > 0) {
          return NextResponse.json(
            { error: '다음 출근 예정 근무장소가 올바르지 않습니다: ' + errs.map(e => e.message).join(', ') },
            { status: 400 }
          )
        }
        plannedWorkLocations = norm
      }
    }

    // ─── legacy timeline 처리 (호환용) ──────────────────────────────────────
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
      const last = workLocationTimeline[workLocationTimeline.length - 1]
      if (last.kind !== 'checkout') {
        return NextResponse.json(
          { error: '퇴근보고의 마지막 항목은 실제 퇴근 시각이어야 합니다.' },
          { status: 400 }
        )
      }
      workTimelineFirst = firstWorkLocation(workLocationTimeline)
      workTimelineEnd = endItemOf(workLocationTimeline)
    }

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
        mirrorExpectedWorkLocation =
          body.expectedWorkLocationType === '기타'
            ? (body.expectedWorkLocation ?? null)
            : (body.expectedWorkLocationType ?? body.expectedWorkLocation ?? null)
        mirrorExpectedWorkTime = body.expectedWorkTime ?? null
      }
      // v2 expectedStartTime이 있으면 mirror에 반영 (HH:mm)
      if (typeof body.expectedStartTime === 'string' && /^(\d{1,2}):(\d{2})$/.test(body.expectedStartTime)) {
        mirrorExpectedWorkTime = body.expectedStartTime
      }
      // planned chip의 첫 라벨이 있으면 location mirror 보강
      if (plannedWorkLocations && plannedWorkLocations.length > 0) {
        mirrorExpectedWorkLocation = firstChipLabel(plannedWorkLocations) || mirrorExpectedWorkLocation
      }
    }

    // ─── 시간/장소 도출 — v2 우선, legacy fallback ─────────────────────────
    // 시간: body.startTime/endTime (HH:mm) 우선 → workTimeline → 기본
    const finalStartTime: string = leaveAllDay
      ? '09:00'
      : (body.startTime ?? workTimelineFirst?.startTime ?? '09:00')
    const finalEndTime: string = leaveAllDay
      ? '18:00'
      : (body.endTime ?? workTimelineEnd?.startTime ?? '18:00')

    // 장소 요약 — actual chips 우선, 없으면 planned, 없으면 legacy timeline, 없으면 단일
    const displayLocs: WorkLocations | null =
      actualWorkLocations
      ?? plannedWorkLocations
      ?? legacyTimelineToLocations(workLocationTimeline)
      ?? legacySingleToLocations(body.workLocation ?? null)

    const finalWorkLocation: string = leaveAllDay
      ? '휴가'
      : (firstChipLabel(displayLocs)
          || (workTimelineFirst ? displayLocation(workTimelineFirst) : '')
          || (body.workLocationType === '기타'
                ? (body.workLocationCustom ?? '')
                : (body.workLocationType ?? ''))
          || '사무실')
    const locationSummary: string = leaveAllDay
      ? '휴가'
      : (formatChipsArrow(displayLocs)
          || (workLocationTimeline ? buildLocationSummary(workLocationTimeline) : '')
          || finalWorkLocation)

    // ─── 휴게 4분리 + 30분 정책 ─────────────────────────────────────────────
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

    if (body.breakTime && !isHalfHourHHmm(body.breakTime)) {
      return NextResponse.json(
        { error: '휴게시간은 30분 단위(00 또는 30분)만 입력 가능합니다.' },
        { status: 400 }
      )
    }
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

    const breakHHForCalc: string = (() => {
      const m = breakFinalRoundedMin
      const h = Math.floor(m / 60)
      const mm = m % 60
      return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
    })()

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
      isFullDayLeave: leaveAllDay,
    })

    const snappedActualMin = snapMinutes(calcResult.actualWorkMinutes, 'round')
    if (!isHalfHour(calcResult.actualWorkMinutes)) {
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
      // 무시
    }

    // 다음 출근 예정 시간 mirror — v2 expectedStartTime 우선
    const finalExpectedStartDate = body.attendanceRecordType === '출근보고 진행 (주말출근, 휴가 포함)'
      ? body.expectedStartDate ?? null
      : null
    const finalExpectedWorkTime = mirrorExpectedWorkTime
    const finalExpectedWorkLocation = mirrorExpectedWorkLocation

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
      // legacy 단일 mirror
      work_location: finalWorkLocation,
      work_location_type: body.workLocationType || null,
      work_location_custom: body.workLocationType === '기타' ? body.workLocationCustom : null,
      work_location_timeline: workLocationTimeline,
      // v2 chips
      planned_work_locations: plannedWorkLocations,
      actual_work_locations: actualWorkLocations,
      late_or_attendance_status: body.lateOrAttendanceStatus || null,
      previous_report_time: body.lateOrAttendanceStatus === '예' ? body.previousReportTime : null,
      current_report_time: body.lateOrAttendanceStatus === '예' ? body.currentReportTime : null,
      late_reason: body.lateOrAttendanceStatus === '예' ? body.lateReason : null,
      attendance_record_type: body.attendanceRecordType || null,
      expected_start_date: finalExpectedStartDate,
      expected_work_time: finalExpectedWorkTime,
      expected_work_location: finalExpectedWorkLocation,
      expected_work_location_timeline: expectedTimeline,
      expected_leave_timeline: expectedLeaveTimeline,
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
      // 무시
    }

    const notifyPayload = {
      name: body.name ?? '',
      leaveDate: body.leaveDate ?? '',
      workTypeLabel: body.workTypeLabel ?? '',
      workLocation: finalWorkLocation,
      workLocationTimeline,
      // v2 — 알림 빌더가 chips 우선 사용 (Phase 4에서 messages.ts 처리)
      actualWorkLocations,
      plannedWorkLocations,
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
      expectedStartDate:    finalExpectedStartDate,
      expectedWorkTime:     finalExpectedWorkTime,
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

    // ─── submissions 로그 ─────────────────────────────────────────
    const submittedNow = new Date().toISOString()
    void recordSubmission({
      user_id: user.id,
      user_email: user.email!,
      name: body.name ?? null,
      division: userDivision,
      team: userTeam,
      report_type: 'check_out',
      target_date: body.leaveDate ?? '',
      submitted_at: submittedNow,
      work_log_id: data?.id ?? null,
      start_time: dbStartTime,
      end_time: dbEndTime,
      break_time: body.breakTime ? `${body.breakTime}:00` : '00:00:00',
      actual_work_time: `${snappedActualMin} minutes`,
      work_location: finalWorkLocation,
      work_location_timeline: workLocationTimeline ?? null,
      actual_work_locations: actualWorkLocations ?? null,
      leave_timeline: leaveTimeline ?? null,
      work_content: body.workContent || null,
      ew_value: calcResult.ewValue,
      ew_start: calcResult.ewStartText,
      ew_end:   calcResult.ewEndText,
      copy_text: calcResult.copyText,
      late_or_attendance_status: body.lateOrAttendanceStatus || null,
      previous_report_time: body.lateOrAttendanceStatus === '예' ? body.previousReportTime : null,
      current_report_time:  body.lateOrAttendanceStatus === '예' ? body.currentReportTime  : null,
      late_reason:          body.lateOrAttendanceStatus === '예' ? body.lateReason          : null,
      break_reason: body.breakReason || null,
      break_auto_actual_minutes:    breakAutoActualMin,
      break_auto_rounded_minutes:   breakAutoRoundedMin,
      break_manual_rounded_minutes: breakManualRoundedMin,
      break_final_rounded_minutes:  breakFinalRoundedMin,
      thanks_macaron: body.thanksMacaron || null,
      work_type_label: body.workTypeLabel,
      work_type_code: calcResult.workTypeCode,
      attendance_record_type: body.attendanceRecordType || null,
    })

    if (
      body.attendanceRecordType === '출근보고 진행 (주말출근, 휴가 포함)'
      && body.expectedStartDate
    ) {
      void recordSubmission({
        user_id: user.id,
        user_email: user.email!,
        name: body.name ?? null,
        division: userDivision,
        team: userTeam,
        report_type: 'check_in',
        target_date: body.expectedStartDate,
        submitted_at: submittedNow,
        work_log_id: data?.id ?? null,
        expected_start_date:    body.expectedStartDate,
        expected_work_time:     finalExpectedWorkTime,
        expected_work_location: finalExpectedWorkLocation,
        expected_work_location_timeline: expectedTimeline ?? null,
        expected_leave_timeline: expectedLeaveTimeline ?? null,
        planned_work_locations: plannedWorkLocations ?? null,
        work_type_label: body.workTypeLabel,
        attendance_record_type: body.attendanceRecordType,
      })
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

    const adminClient = createAdminClient()
    const { searchParams } = new URL(request.url)
    const mine = searchParams.get('mine') === 'true'
    const filterDivision = searchParams.get('division') ?? ''
    const filterTeam = searchParams.get('team') ?? ''
    const limitParam = searchParams.get('limit')
    const limit = limitParam ? Math.min(Math.max(Number(limitParam) || 0, 1), 500) : 200

    let query = adminClient
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
        // 무시
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
