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
import { computeEffectiveActualStart } from '@/lib/work-log-state'
import type { WorkLocationTimeline } from '@/types/work-location-timeline'
import type { WorkLocations } from '@/types/work-locations-v2'
import type { LeaveTimeline } from '@/types/leave-timeline'

/**
 * POST /api/work-logs
 *
 * 새 정책 (한 일자 한 row 모델):
 * - D-day work_log row UPSERT (leave_date 매칭)
 * - 다음날(D+1) 출근예정이 함께 입력되면 D+1 row도 UPSERT (leave_date=D+1)
 * - 기존 resubmitLogId 흐름 deprecated — 단순 ignore (UPSERT가 알아서 처리)
 */
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

    // ─── legacy timeline (호환) ─────────────────────────────────────────────
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

    // 다음 출근 예정 timeline (legacy)
    let expectedTimeline: WorkLocationTimeline | null = null
    if (body.attendanceRecordType === '출근보고 진행 (주말출근, 휴가 포함)' && Array.isArray(body.expectedTimeline)) {
      const tlErrors = validateTimeline(body.expectedTimeline as WorkLocationTimeline)
      if (tlErrors.length > 0) {
        return NextResponse.json(
          { error: '출근 예정 타임라인이 올바르지 않습니다: ' + tlErrors.map(e => e.message).join(', ') },
          { status: 400 }
        )
      }
      expectedTimeline = body.expectedTimeline as WorkLocationTimeline
    }

    // ─── 시간/장소 도출 ──────────────────────────────────────────────────────
    const finalStartTime: string = leaveAllDay
      ? '09:00'
      : (body.startTime ?? workTimelineFirst?.startTime ?? '09:00')
    const finalEndTime: string = leaveAllDay
      ? '18:00'
      : (body.endTime ?? workTimelineEnd?.startTime ?? '18:00')

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
      return NextResponse.json({ error: '휴게시간은 30분 단위로 입력 가능합니다.' }, { status: 400 })
    }
    if (body.startTime && !isHalfHourHHmm(body.startTime)) {
      return NextResponse.json({ error: '출근 시각은 30분 단위로 입력 가능합니다.' }, { status: 400 })
    }
    if (body.endTime && !isHalfHourHHmm(body.endTime)) {
      return NextResponse.json({ error: '퇴근 시각은 30분 단위로 입력 가능합니다.' }, { status: 400 })
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
    // Stage 0-2: 정책서 시간 4종 분리 — 신규 actual_* SoT 컬럼 동시 채움.
    // 이 라우트의 폼 시각은 "실제 출퇴근"으로 해석한다 (line 442 정책 코멘트 참조).
    const dbActualStart = dbStartTime
    const dbActualEnd   = dbEndTime

    const calcResult = calculateEw({
      name: body.name,
      workTypeLabel: body.workTypeLabel,
      workSubType: body.workSubType,
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
      console.warn('[/api/work-logs POST] non-30min actual auto-snapped',
        { raw: calcResult.actualWorkMinutes, snapped: snappedActualMin })
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

    const adminClient = createAdminClient()

    // ─── D-day row UPSERT ───────────────────────────────────────────────────
    // leave_date=body.leaveDate 매칭. 있으면 UPDATE, 없으면 INSERT.
    let workLogId: string | null = null
    {
      const { data: existing } = await adminClient
        .from('work_logs')
        .select('id')
        .eq('user_email', user.email!)
        .eq('leave_date', body.leaveDate)
        .eq('is_deleted', false)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      workLogId = existing?.id ?? null
    }

    const dDayData: Record<string, unknown> = {
      name: body.name,
      work_type_label: body.workTypeLabel,
      work_type_code: calcResult.workTypeCode,
      work_sub_type: calcResult.workSubType,
      leave_date: body.leaveDate,
      start_time: dbStartTime,
      end_time:   dbEndTime,
      // Stage 0-2: 신규 SoT 컬럼 — 폼 시각 = 실제 출퇴근으로 해석
      actual_start_time: dbActualStart,
      actual_end_time:   dbActualEnd,
      break_time: body.breakTime ? `${body.breakTime}:00` : '00:00:00',
      break_reason: body.breakReason || null,
      work_content: body.workContent || null,
      work_location: finalWorkLocation,
      work_location_type: body.workLocationType || null,
      work_location_custom: body.workLocationType === '기타' ? body.workLocationCustom : null,
      work_location_timeline: workLocationTimeline,
      // v2
      planned_work_locations: plannedWorkLocations === undefined ? null : plannedWorkLocations,  // 퇴근보고는 D-day의 planned는 안 건드림 (별도 D+1 row)
      actual_work_locations:  actualWorkLocations,
      late_or_attendance_status: body.lateOrAttendanceStatus || null,
      previous_report_time: body.lateOrAttendanceStatus === '예' ? body.previousReportTime : null,
      current_report_time:  body.lateOrAttendanceStatus === '예' ? body.currentReportTime  : null,
      late_reason:          body.lateOrAttendanceStatus === '예' ? body.lateReason          : null,
      attendance_record_type: body.attendanceRecordType || null,
      // expected_*는 더 이상 사용 안 함 (다음날 정보는 D+1 row로 분리)
      expected_start_date:    null,
      expected_work_time:     null,
      expected_work_location: null,
      expected_work_location_timeline: null,
      expected_leave_timeline: null,
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
    }

    // 퇴근보고는 actualWorkLocations만 갱신, planned는 보존 (D-day row의 planned는 출근보고에서 정해진 값)
    // → planned_work_locations를 dDayData에서 제거 (UPDATE 시 안 건드림). INSERT 시는 NULL 허용.
    delete dDayData.planned_work_locations

    let savedLog: Record<string, unknown> | null = null
    if (workLogId) {
      // UPDATE: 폼의 출퇴근 시간은 daily_work_status(실제 출퇴근)로만 저장.
      // work_logs.start_time/end_time(=출근예정/퇴근예정)은 보존 — 사용자 의도.
      const { start_time: _st, end_time: _et, ...dDayDataForUpdate } = dDayData
      void _st; void _et
      const { data, error: updErr } = await adminClient
        .from('work_logs')
        .update({ ...dDayDataForUpdate, updated_at: new Date().toISOString(), updated_by: user.id })
        .eq('id', workLogId)
        .select()
        .single()
      if (updErr) {
        console.error('DB UPDATE Error:', updErr)
        return NextResponse.json({ error: `데이터 저장 실패: ${updErr.message}` }, { status: 500 })
      }
      savedLog = data as Record<string, unknown>
    } else {
      const { data, error: insErr } = await adminClient
        .from('work_logs')
        .insert({
          ...dDayData,
          user_id: user.id,
          user_email: user.email,
          division: userDivision,
          team: userTeam,
          // 신규 INSERT 시는 planned_work_locations도 채울 수 있음 (퇴근보고가 D-day 첫 작성인 경우)
          planned_work_locations: plannedWorkLocations,
          teams_sent: false,
          is_deleted: false,
        })
        .select()
        .single()
      if (insErr) {
        console.error('DB INSERT Error:', insErr)
        return NextResponse.json({ error: `데이터 저장 실패: ${insErr.message}` }, { status: 500 })
      }
      savedLog = data as Record<string, unknown>
      workLogId = savedLog?.id as string ?? null
    }

    // ─── D+1 row UPSERT (다음 출근 예정) ─────────────────────────────────────
    const isCheckInProgress = body.attendanceRecordType === '출근보고 진행 (주말출근, 휴가 포함)'
    if (isCheckInProgress && body.expectedStartDate) {
      // D+1 row의 본문 영역에 다음날 출근예정 정보 저장
      const nextDate: string = body.expectedStartDate
      const nextStartTime: string = (body.expectedStartTime
        ?? (expectedTimeline ? firstWorkLocation(expectedTimeline)?.startTime : null)
        ?? '09:00') as string
      const nextEndTimeSrc: string | null = (body.expectedEndTime ?? null) as string | null
      const nextEndTimeFromTl: string | null = (() => {
        if (!expectedTimeline || expectedTimeline.length === 0) return null
        const last = expectedTimeline[expectedTimeline.length - 1]
        if (last.kind === 'expected_checkout' || last.kind === 'checkout') return last.startTime
        return null
      })()
      const nextEndTime: string = nextEndTimeSrc ?? nextEndTimeFromTl ?? '18:00'

      const nextWorkLocation: string = firstChipLabel(plannedWorkLocations)
        || (expectedTimeline ? (firstWorkLocation(expectedTimeline) ? displayLocation(firstWorkLocation(expectedTimeline)!) : '') : '')
        || '사무실'

      // D+1 row 존재 확인
      const { data: existingNext } = await adminClient
        .from('work_logs')
        .select('id')
        .eq('user_email', user.email!)
        .eq('leave_date', nextDate)
        .eq('is_deleted', false)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      const dPlus1PlannedStart = mod24HHmm(nextStartTime)
      const dPlus1PlannedEnd   = mod24HHmm(nextEndTime)
      const dPlus1Data: Record<string, unknown> = {
        name: body.name,
        leave_date: nextDate,
        start_time: dPlus1PlannedStart,
        end_time:   dPlus1PlannedEnd,
        // Stage 0-2: D+1 사전등록은 예정값 — planned_* SoT 컬럼에도 동시 저장
        planned_start_time: dPlus1PlannedStart,
        planned_end_time:   dPlus1PlannedEnd,
        work_location: nextWorkLocation,
        work_location_timeline: expectedTimeline,
        planned_work_locations: plannedWorkLocations,
        actual_work_locations: null,  // 아직 미정
        leave_timeline: expectedLeaveTimeline,
        attendance_record_type: '출근보고 진행 (주말출근, 휴가 포함)',
        // 본문 영역은 비움 (실제 근무는 그날에 채움)
        // expected_*는 더 이상 사용 안 함
        expected_start_date:    null,
        expected_work_time:     null,
        expected_work_location: null,
        expected_work_location_timeline: null,
        expected_leave_timeline: null,
      }

      if (existingNext) {
        const { error: dPlus1UpdErr } = await adminClient
          .from('work_logs')
          .update({ ...dPlus1Data, updated_at: new Date().toISOString(), updated_by: user.id })
          .eq('id', existingNext.id)
        if (dPlus1UpdErr) {
          console.error('[work-logs POST] D+1 UPDATE failed:', dPlus1UpdErr)
        }
      } else {
        // INSERT 시 NOT NULL 컬럼들을 모두 채워야 한다:
        //   work_type_code, deduction_time, actual_work_time, ew_*, copy_text, work_location
        // 사전등록 row는 아직 실제 근무 안 함 → derived 값은 0/'' default.
        // 출근완료/퇴근완료 시점에 calcResult로 재계산되어 overwrite됨.
        const { error: dPlus1InsErr } = await adminClient
          .from('work_logs')
          .insert({
            ...dPlus1Data,
            user_id: user.id,
            user_email: user.email,
            division: userDivision,
            team: userTeam,
            work_type_label: body.workTypeLabel ?? '기본근무 등록',
            work_type_code: 1,  // 기본 (출근완료 시 calcResult로 재계산)
            work_sub_type: body.workSubType ?? null,
            late_or_attendance_status: '아니오',
            // NOT NULL 충족용 default — 실제값은 출근완료/퇴근완료에서 갱신
            deduction_time: '0 minutes',
            actual_work_time: '0 minutes',
            break_time: '00:00:00',
            ew_start: '',
            ew_end: '',
            ew_value: '',
            copy_text: '',
            teams_sent: false,
            is_deleted: false,
          })
        if (dPlus1InsErr) {
          console.error('[work-logs POST] D+1 INSERT failed:', dPlus1InsErr)
          // D-day 저장은 성공이라 전체 실패 X — 에러는 응답 body에 경고로 포함
          return NextResponse.json({
            ...(savedLog ?? {}),
            __warning: `다음 출근 예정(${nextDate}) row 생성 실패: ${dPlus1InsErr.message}`,
          })
        }
      }
    }

    // ─── daily_work_status: 폼의 출퇴근 시간 = 실제 출퇴근으로 저장 ─────────────
    // (정책: 사용자가 폼에 입력한 startTime/endTime은 "예정"이 아닌 "실제"로 반영)
    {
      const checkedInAtIso  = new Date(`${body.leaveDate}T${(finalStartTime || '09:00').padStart(5, '0')}:00+09:00`).toISOString()
      const checkedOutAtIso = new Date(`${body.leaveDate}T${(finalEndTime   || '18:00').padStart(5, '0')}:00+09:00`).toISOString()
      await adminClient
        .from('daily_work_status')
        .upsert({
          work_date:        body.leaveDate,
          user_email:       user.email!,
          user_profile_id:  null,  // 모를 수 있음
          work_log_id:      workLogId,
          status:           'checked_out',
          checked_in_at:    checkedInAtIso,
          checked_out_at:   checkedOutAtIso,
          updated_at:       new Date().toISOString(),
        }, { onConflict: 'work_date,user_email' })
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
      expectedStartDate:    body.expectedStartDate ?? null,
      expectedWorkTime:     body.expectedStartTime ?? null,
      expectedWorkLocation: firstChipLabel(plannedWorkLocations) || null,
      expectedTimeline,
      division: userDivision,
      team: userTeam,
    }

    // resubmitLogId 흐름은 deprecated — 항상 worklog_submitted로 발송 (재제출 알림 X)
    notifyWorkLogSubmitted(notifyPayload)

    // ─── submissions 로그 ─────────────────────────────────────────
    const submittedNow = new Date().toISOString()
    await recordSubmission({
      user_id: user.id,
      user_email: user.email!,
      name: body.name ?? null,
      division: userDivision,
      team: userTeam,
      report_type: 'check_out',
      target_date: body.leaveDate ?? '',
      submitted_at: submittedNow,
      work_log_id: workLogId,
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
      work_sub_type: calcResult.workSubType,
      attendance_record_type: body.attendanceRecordType || null,
    })

    if (isCheckInProgress && body.expectedStartDate) {
      await recordSubmission({
        user_id: user.id,
        user_email: user.email!,
        name: body.name ?? null,
        division: userDivision,
        team: userTeam,
        report_type: 'check_in',
        target_date: body.expectedStartDate,
        submitted_at: submittedNow,
        work_log_id: workLogId,
        start_time: body.expectedStartTime ?? null,
        end_time: body.expectedEndTime ?? null,
        work_location: firstChipLabel(plannedWorkLocations) || null,
        work_location_timeline: expectedTimeline ?? null,
        leave_timeline: expectedLeaveTimeline ?? null,
        planned_work_locations: plannedWorkLocations ?? null,
        work_type_label: body.workTypeLabel,
        work_sub_type: body.workSubType ?? null,
        attendance_record_type: body.attendanceRecordType,
      })
    }

    return NextResponse.json(savedLog)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('Work Log API Error:', message)
    // 사용자 입력 검증 실패는 400으로 노출 (calcEw 음수 등)
    const isUserError =
      message.includes('실근무시간이 음수') ||
      message.includes('지원하지 않는 근무유형') ||
      message.includes('잘못된 시간 형식') ||
      message.includes('잘못된 날짜 형식')
    if (isUserError) {
      return NextResponse.json({ error: message }, { status: 400 })
    }
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
    // Stage 0-4c: 캘린더 / 일자별 최종 화면용 leave_date 범위 필터
    const isoRe = /^\d{4}-\d{2}-\d{2}$/
    const fromParam = searchParams.get('from') ?? ''
    const toParam   = searchParams.get('to')   ?? ''

    let query = adminClient
      .from('work_logs')
      .select('*')
      .eq('is_deleted', false)
      .order('leave_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(limit)

    if (isoRe.test(fromParam)) query = query.gte('leave_date', fromParam)
    if (isoRe.test(toParam))   query = query.lte('leave_date', toParam)

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

    // Stage 4: 각 row에 effective_actual_start_time 추가.
    // 팀별 use_check_in_complete 매핑이 필요 — org_divisions + org_teams 조회.
    const [{ data: divs }, { data: teams }] = await Promise.all([
      adminClient.from('org_divisions').select('id, name'),
      adminClient.from('org_teams').select('division_id, name, use_check_in_complete'),
    ])
    const divIdToName = new Map<string, string>()
    for (const d of (divs ?? []) as Array<{ id: string; name: string }>) {
      divIdToName.set(d.id, d.name)
    }
    const teamSettings = new Map<string, boolean>()
    for (const t of (teams ?? []) as Array<{ division_id: string; name: string; use_check_in_complete: boolean | null }>) {
      const divName = divIdToName.get(t.division_id)
      if (!divName) continue
      teamSettings.set(`${divName}::${t.name}`, t.use_check_in_complete ?? true)
    }
    const now = new Date()
    const enriched = (data ?? []).map(row => {
      const useCheckInComplete = teamSettings.get(`${row.division ?? ''}::${row.team ?? ''}`) ?? true
      return {
        ...row,
        effective_actual_start_time: computeEffectiveActualStart(
          {
            leave_date: row.leave_date ?? null,
            planned_start_time: row.planned_start_time ?? null,
            actual_start_time: row.actual_start_time ?? null,
          },
          { use_check_in_complete: useCheckInComplete },
          now,
        ),
      }
    })

    return NextResponse.json(enriched)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('Work Log GET Error:', message)
    return NextResponse.json({ error: '서버 에러가 발생했습니다.' }, { status: 500 })
  }
}
