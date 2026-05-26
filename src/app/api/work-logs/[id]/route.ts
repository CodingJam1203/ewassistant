import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getKstTodayDateString } from '@/lib/utils/date'
import { kstHHmmToIso } from '@/lib/utils/kst-datetime'
import { requireAdmin, requireActiveUser } from '@/lib/admin-check'
import { calculateEw } from '@/lib/ew-calculator'

// 2026-05-19 v1.21: notify await 대응 — sendToMake retry 최악 31.5s + DB 처리 여유.
export const maxDuration = 60
import { notifyWorkLogUpdatedSplit, notifyWorkLogDeleted } from '@/lib/notifications/teams'
import { resolveRoutingTeam } from '@/lib/org'
import { recordSubmission } from '@/lib/submission-log'

/**
 * work_log row의 알림 라우팅용 effective team 결정.
 * row의 team이 있으면 그대로, 본부 직속(team 없음)이면 작성자의 notify_team으로 fallback.
 * (work_log row의 team 컬럼 자체는 건드리지 않음 — 알림 라우팅에만 사용)
 */
async function resolveRoutingTeamForLog(
  adminClient: ReturnType<typeof createAdminClient>,
  log: { team?: string | null; user_id?: string | null; user_email?: string | null },
): Promise<string> {
  const raw = (log.team ?? '').trim()
  if (raw) return raw
  try {
    let q = adminClient.from('user_profiles').select('notify_team')
    if (log.user_id) q = q.eq('id', log.user_id)
    else if (log.user_email) q = q.eq('email', log.user_email)
    else return ''
    const { data } = await q.maybeSingle()
    return resolveRoutingTeam(null, data?.notify_team)
  } catch {
    return ''
  }
}
import { recordAudit, extractRequestMeta } from '@/lib/audit-log'
import type { ChangedField } from '@/lib/notifications/types'
import { fmtTime, fmtBreak } from '@/lib/notifications/messages'
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
  locationsEqual,
} from '@/lib/work-locations-v2'
import type { WorkLocationTimeline } from '@/types/work-location-timeline'
import type { WorkLocations } from '@/types/work-locations-v2'
import type { LeaveTimeline } from '@/types/leave-timeline'

// ─── GET /api/work-logs/[id] ─────────────────────────────────────────────────
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const user = await requireActiveUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const adminClient = createAdminClient()
    const { data: log, error } = await adminClient
      .from('work_logs')
      .select('*')
      .eq('id', id)
      .single()

    if (error || !log) {
      return NextResponse.json({ error: '기록을 찾을 수 없습니다.' }, { status: 404 })
    }

    let activeLog = log
    if (log.is_deleted) {
      const targetDate = (log.leave_date as string | null)
        ?? (log.expected_start_date as string | null)
      if (targetDate && log.user_email) {
        const { data: replacement } = await adminClient
          .from('work_logs')
          .select('*')
          .eq('user_email', log.user_email)
          .eq('is_deleted', false)
          .or(`leave_date.eq.${targetDate},expected_start_date.eq.${targetDate}`)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        if (replacement) {
          activeLog = replacement
        } else {
          return NextResponse.json({ error: '삭제된 기록입니다.' }, { status: 410 })
        }
      } else {
        return NextResponse.json({ error: '삭제된 기록입니다.' }, { status: 410 })
      }
    }

    const isOwner = activeLog.user_id === user.id
    const adminUser = await requireAdmin()
    if (!isOwner && !adminUser) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    return NextResponse.json(activeLog)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[GET /api/work-logs/[id]]', message)
    return NextResponse.json({ error: '서버 에러가 발생했습니다.' }, { status: 500 })
  }
}

// ─── PATCH /api/work-logs/[id] ───────────────────────────────────────────────
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const user = await requireActiveUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized or Inactive account' }, { status: 403 })

    const adminClient = createAdminClient()
    const { data: log, error: fetchError } = await adminClient
      .from('work_logs')
      .select('user_id, user_email, name, is_deleted, division, team, leave_date, start_time, end_time, work_location, break_time, work_content, ew_value, work_type_label, attendance_record_type, expected_start_date, late_or_attendance_status, previous_report_time, current_report_time, late_reason, expected_work_time, expected_work_location, work_location_timeline, expected_work_location_timeline, expected_leave_timeline, leave_timeline, break_reason, thanks_macaron, work_type_code, planned_work_locations, actual_work_locations')
      .eq('id', id)
      .single()

    if (fetchError || !log) {
      return NextResponse.json({ error: '기록을 찾을 수 없습니다.' }, { status: 404 })
    }
    if (log.is_deleted) {
      return NextResponse.json({ error: '삭제된 기록입니다.' }, { status: 410 })
    }

    const isOwner = log.user_id === user.id
    const adminUser = await requireAdmin()
    if (!isOwner && !adminUser) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json()

    // ─── 휴가 ────────────────────────────────────────────────────────────────
    let leaveTimelinePatch: LeaveTimeline | null | undefined = undefined
    if (body.leaveTimeline !== undefined) {
      if (Array.isArray(body.leaveTimeline) && body.leaveTimeline.length > 0) {
        const leErrors = validateLeaveTimeline(body.leaveTimeline as LeaveTimeline)
        if (leErrors.length > 0) {
          return NextResponse.json(
            { error: '휴가/반차 정보가 올바르지 않습니다: ' + leErrors.map(e => e.message).join(', ') },
            { status: 400 }
          )
        }
        leaveTimelinePatch = body.leaveTimeline as LeaveTimeline
      } else {
        leaveTimelinePatch = null
      }
    }

    let expectedLeaveTimelinePatch: LeaveTimeline | null | undefined = undefined
    if (body.expectedLeaveTimeline !== undefined) {
      if (Array.isArray(body.expectedLeaveTimeline) && body.expectedLeaveTimeline.length > 0) {
        const exLeErrors = validateLeaveTimeline(body.expectedLeaveTimeline as LeaveTimeline)
        if (exLeErrors.length > 0) {
          return NextResponse.json(
            { error: '다음 출근 예정 휴가 정보가 올바르지 않습니다: ' + exLeErrors.map(e => e.message).join(', ') },
            { status: 400 }
          )
        }
        expectedLeaveTimelinePatch = body.expectedLeaveTimeline as LeaveTimeline
      } else {
        expectedLeaveTimelinePatch = null
      }
    }

    const effectiveLeaveTimeline: LeaveTimeline =
      (leaveTimelinePatch ?? null) as LeaveTimeline | null
      ?? []
    const leaveAllDay = isFullDayLeave(effectiveLeaveTimeline)
    const leaveMinutesEff = totalLeaveRoundedMinutes(effectiveLeaveTimeline)

    // ─── v2 chips PATCH ─────────────────────────────────────────────────────
    let actualWorkLocationsPatch: WorkLocations | null | undefined = undefined
    if (body.actualWorkLocations !== undefined) {
      if (body.actualWorkLocations === null) {
        actualWorkLocationsPatch = null
      } else {
        const norm = normalizeWorkLocations(body.actualWorkLocations)
        if (norm) {
          const errs = validateWorkLocations(norm)
          if (errs.length > 0 && !leaveAllDay) {
            return NextResponse.json(
              { error: '실제 근무장소가 올바르지 않습니다: ' + errs.map(e => e.message).join(', ') },
              { status: 400 }
            )
          }
          actualWorkLocationsPatch = norm
        } else {
          actualWorkLocationsPatch = null
        }
      }
    }

    let plannedWorkLocationsPatch: WorkLocations | null | undefined = undefined
    if (body.plannedWorkLocations !== undefined && body.attendanceRecordType === '출근보고 진행 (주말출근, 휴가 포함)') {
      if (body.plannedWorkLocations === null) {
        plannedWorkLocationsPatch = null
      } else {
        const norm = normalizeWorkLocations(body.plannedWorkLocations)
        if (norm) {
          const errs = validateWorkLocations(norm)
          if (errs.length > 0) {
            return NextResponse.json(
              { error: '다음 출근 예정 근무장소가 올바르지 않습니다: ' + errs.map(e => e.message).join(', ') },
              { status: 400 }
            )
          }
          plannedWorkLocationsPatch = norm
        }
      }
    }

    // ─── legacy timeline PATCH (호환) ───────────────────────────────────────
    let workLocationTimelinePatch: WorkLocationTimeline | null | undefined = undefined
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
      workLocationTimelinePatch = body.workLocationTimeline as WorkLocationTimeline
      const last = workLocationTimelinePatch[workLocationTimelinePatch.length - 1]
      if (last.kind !== 'checkout') {
        return NextResponse.json(
          { error: '퇴근보고의 마지막 항목은 실제 퇴근 시각이어야 합니다.' },
          { status: 400 }
        )
      }
      workTimelineFirst = firstWorkLocation(workLocationTimelinePatch)
      workTimelineEnd = endItemOf(workLocationTimelinePatch)
    }

    // ─── 시간/장소 도출 ──────────────────────────────────────────────────────
    const finalStartTime: string = body.startTime ?? workTimelineFirst?.startTime ?? log.start_time ?? '09:00'
    const finalEndTime: string   = body.endTime   ?? workTimelineEnd?.startTime   ?? log.end_time   ?? '18:00'

    // 표시용 장소 — actual patch → planned patch → existing actual → existing planned → legacy
    const effActual = actualWorkLocationsPatch !== undefined
      ? actualWorkLocationsPatch
      : normalizeWorkLocations(log.actual_work_locations)
    const effPlanned = plannedWorkLocationsPatch !== undefined
      ? plannedWorkLocationsPatch
      : normalizeWorkLocations(log.planned_work_locations)
    const displayLocs: WorkLocations | null =
      effActual
      ?? effPlanned
      ?? legacyTimelineToLocations(workLocationTimelinePatch ?? log.work_location_timeline ?? null)
      ?? legacySingleToLocations(body.workLocation ?? log.work_location ?? null)

    const finalWorkLocation: string = firstChipLabel(displayLocs)
      || (workTimelineFirst ? displayLocation(workTimelineFirst) : '')
      || (body.workLocationType === '기타'
            ? (body.workLocationCustom ?? body.workLocation ?? '')
            : (body.workLocationType ?? body.workLocation ?? log.work_location ?? ''))
      || ''
    const locationSummary: string = formatChipsArrow(displayLocs)
      || (workLocationTimelinePatch ? buildLocationSummary(workLocationTimelinePatch) : '')
      || finalWorkLocation

    // ─── expected timeline PATCH ────────────────────────────────────────────
    let expectedTimelinePatch: WorkLocationTimeline | null | undefined = undefined
    let mirrorExpectedWorkLocation: string | null | undefined = undefined
    let mirrorExpectedWorkTime: string | null | undefined = undefined

    if (body.attendanceRecordType === '출근보고 진행 (주말출근, 휴가 포함)') {
      if (Array.isArray(body.expectedTimeline)) {
        const tlErrors = validateTimeline(body.expectedTimeline as WorkLocationTimeline)
        if (tlErrors.length > 0) {
          return NextResponse.json(
            { error: '출근 예정 타임라인이 올바르지 않습니다: ' + tlErrors.map(e => e.message).join(', ') },
            { status: 400 }
          )
        }
        expectedTimelinePatch = body.expectedTimeline as WorkLocationTimeline
        const first = firstWorkLocation(expectedTimelinePatch)
        mirrorExpectedWorkLocation = first ? displayLocation(first) : null
        mirrorExpectedWorkTime = first?.startTime ?? null
      } else if (body.expectedWorkLocationType !== undefined || body.expectedWorkLocation !== undefined || body.expectedWorkTime !== undefined) {
        mirrorExpectedWorkLocation =
          body.expectedWorkLocationType === '기타'
            ? (body.expectedWorkLocation ?? null)
            : (body.expectedWorkLocationType ?? body.expectedWorkLocation ?? null)
        mirrorExpectedWorkTime = body.expectedWorkTime ?? null
      }
      if (typeof body.expectedStartTime === 'string' && /^(\d{1,2}):(\d{2})$/.test(body.expectedStartTime)) {
        mirrorExpectedWorkTime = body.expectedStartTime
      }
      if (plannedWorkLocationsPatch && plannedWorkLocationsPatch.length > 0) {
        mirrorExpectedWorkLocation = firstChipLabel(plannedWorkLocationsPatch) || mirrorExpectedWorkLocation
      }
    }

    // 휴게 4분리 + 30분 정책
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

    const calcResult = calculateEw({
      name: body.name,
      workTypeLabel: body.workTypeLabel,
      leaveDate: body.leaveDate,
      startTime: finalStartTime,
      endTime: finalEndTime,
      breakTime: body.breakTime ? body.breakTime : breakHHForCalc,
      workLocation: locationSummary,
      workContent: body.workContent,
      breakReason: body.breakReason,
      leaveMinutes: leaveMinutesEff,
      isFullDayLeave: leaveAllDay,
    })

    const snappedActualMin = snapMinutes(calcResult.actualWorkMinutes, 'round')
    if (!isHalfHour(calcResult.actualWorkMinutes)) {
      console.warn(
        '[/api/work-logs PATCH] non-30min actual_work_time auto-snapped',
        { id, raw: calcResult.actualWorkMinutes, snapped: snappedActualMin }
      )
    }

    // ─── 영역별 update 분기 ──────────────────────────────────────────────────
    // _editScope 메타로 사용자가 어느 영역만 수정했는지 구분.
    //   'check_in'  → 출근보고(D+1 expected_*) 영역만 수정. 본문(퇴근보고) 영역은 그대로 유지.
    //   'check_out' → 본문(퇴근보고) 영역만 수정. 출근보고 영역은 그대로 유지.
    //   undefined   → 양쪽 모두 (전체 수정 / 신규).
    // 이 분기 없이 무지성 update면 출근보고만 수정해도 본문 default값(09:00, 18:00,
    // 사무실 등)이 함께 set돼서 사용자가 작성하지 않은 퇴근보고가 강제 생성됨.
    const editScope = body._editScope as 'check_in' | 'check_out' | undefined
    const isCheckInOnly  = editScope === 'check_in'
    const isCheckOutOnly = editScope === 'check_out'

    // ─── Stage 7: 필드 수준 가드 ────────────────────────────────────────────
    // editScope를 명시한 경우, 영역 밖 필드를 변경하려는 요청이면 400 reject.
    // body가 단순히 현재값을 echo하는 건 OK — 실제로 값이 다를 때만 거부.
    {
      const trim5 = (s: string | null | undefined): string => (s ?? '').slice(0, 5)
      const norm  = (s: string | null | undefined): string => (s ?? '').toString().trim()
      const jsonEq = (a: unknown, b: unknown): boolean =>
        JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
      const forbidden: string[] = []

      if (isCheckInOnly) {
        // 출근보고 수정 모드 — 본문(퇴근보고) 영역 수정 금지
        if (body.startTime !== undefined && trim5(body.startTime) !== trim5(log.start_time as string)) {
          forbidden.push('startTime(실제출근)')
        }
        if (body.endTime !== undefined && trim5(body.endTime) !== trim5(log.end_time as string)) {
          forbidden.push('endTime(실제퇴근)')
        }
        if (body.breakTime !== undefined) {
          // log.break_time은 'HH:MM:SS', body.breakTime은 'HH:MM' — 5글자 비교
          if (trim5(body.breakTime) !== trim5(log.break_time as string)) {
            forbidden.push('breakTime(휴게)')
          }
        }
        if (body.workContent !== undefined && norm(body.workContent) !== norm(log.work_content as string)) {
          forbidden.push('workContent(근무내용)')
        }
        if (body.actualWorkLocations !== undefined && !jsonEq(body.actualWorkLocations, log.actual_work_locations)) {
          forbidden.push('actualWorkLocations(실제 근무장소)')
        }
        // 지각/당일수정 — 본문 영역으로 분류
        if (body.lateOrAttendanceStatus !== undefined && norm(body.lateOrAttendanceStatus) !== norm(log.late_or_attendance_status as string)) {
          forbidden.push('lateOrAttendanceStatus(지각/당일수정)')
        }
      }

      if (isCheckOutOnly) {
        // 퇴근보고 수정 모드 — 출근보고 영역 + D+1 사전등록 수정 금지
        // (Stage 1 client guard가 모든 expected_*/plannedWorkLocations를 null로 보내므로
        //  현재값과 같으면 통과, 다른 값이 들어오면 reject)
        if (body.plannedWorkLocations !== undefined && !jsonEq(body.plannedWorkLocations, log.planned_work_locations)) {
          forbidden.push('plannedWorkLocations(출근 예정 장소)')
        }
        if (body.expectedStartDate !== undefined && norm(body.expectedStartDate) !== norm(log.expected_start_date as string)) {
          forbidden.push('expectedStartDate(다음 출근 일자)')
        }
        if (body.expectedStartTime !== undefined && norm(body.expectedStartTime) !== norm(log.expected_work_time as string)) {
          forbidden.push('expectedStartTime(다음 출근 시각)')
        }
        if (body.expectedLeaveTimeline !== undefined && !jsonEq(body.expectedLeaveTimeline, log.expected_leave_timeline)) {
          forbidden.push('expectedLeaveTimeline(다음 출근일 휴가)')
        }
        // attendanceRecordType는 Stage 1에서 '스킵'으로 강제 override되므로 변경 자체가 명시적 행위.
        if (body.attendanceRecordType !== undefined
            && body.attendanceRecordType !== '스킵(누락퇴근보고, 퇴근보고 수정)'
            && norm(body.attendanceRecordType) !== norm(log.attendance_record_type as string)) {
          forbidden.push('attendanceRecordType(출근보고 진행 여부)')
        }
      }

      if (forbidden.length > 0) {
        const scopeLabel = isCheckInOnly ? '출근보고 수정' : '퇴근보고 수정'
        return NextResponse.json(
          { error: `${scopeLabel} 모드에서는 다음 필드를 변경할 수 없습니다: ${forbidden.join(', ')}` },
          { status: 400 }
        )
      }
    }

    const updates: Record<string, unknown> = {
      name: body.name,
      work_type_label: body.workTypeLabel,
      leave_date: body.leaveDate,
      updated_at: new Date().toISOString(),
      updated_by: user.id,
    }

    // 본문(퇴근보고) 영역 — check_in 전용 수정이 아닐 때만 update
    if (!isCheckInOnly) {
      // 정책: 폼의 출퇴근 시간은 daily_work_status(실제 출퇴근)로만 저장.
      // work_logs.start_time/end_time(=출근예정/퇴근예정)은 보존.
      Object.assign(updates, {
        work_type_code: calcResult.workTypeCode,
        break_time: body.breakTime ? `${body.breakTime}:00` : '00:00:00',
        break_reason: body.breakReason || null,
        work_content: body.workContent || null,
        work_location: finalWorkLocation,
        work_location_type: body.workLocationType || null,
        deduction_time: `${calcResult.deductionMinutes} minutes`,
        actual_work_time: `${snappedActualMin} minutes`,
        ew_start: calcResult.ewStartText,
        ew_end: calcResult.ewEndText,
        ew_value: calcResult.ewValue,
        copy_text: calcResult.copyText,
      })
      if (workLocationTimelinePatch !== undefined) {
        updates.work_location_timeline = workLocationTimelinePatch
      }
      if (actualWorkLocationsPatch !== undefined) {
        updates.actual_work_locations = actualWorkLocationsPatch
      }
      if (leaveTimelinePatch !== undefined) {
        updates.leave_timeline = leaveTimelinePatch
      }
      if (body.breakAutoActualMinutes !== undefined) {
        updates.break_auto_actual_minutes = breakAutoActualMin
      }
      if (body.breakAutoRoundedMinutes !== undefined) {
        updates.break_auto_rounded_minutes = breakAutoRoundedMin
      }
      if (body.breakManualRoundedMinutes !== undefined) {
        updates.break_manual_rounded_minutes = breakManualRoundedMin
      }
      if (body.breakFinalRoundedMinutes !== undefined) {
        updates.break_final_rounded_minutes = breakFinalRoundedMin
      }
      // 지각/당일수정 — 본문(퇴근보고) 영역 일부. 근무지와 동일 정책으로 update.
      // body.lateOrAttendanceStatus가 명시적으로 들어왔을 때만 갱신.
      if (body.lateOrAttendanceStatus !== undefined) {
        const isLate = body.lateOrAttendanceStatus === '예'
        updates.late_or_attendance_status = body.lateOrAttendanceStatus || null
        updates.previous_report_time = isLate ? (body.previousReportTime || null) : null
        updates.current_report_time  = isLate ? (body.currentReportTime  || null) : null
        updates.late_reason          = isLate ? (body.lateReason          || null) : null
      }
      // Stage 0-2: 신규 SoT 컬럼 — 본문 시각 = 실제 출퇴근으로 해석.
      // 기존 start_time/end_time(=planned)은 이 라우트에서 보존하므로
      // 실제 시각 변경분만 actual_*에 반영. body에 명시적으로 들어왔을 때만 갱신.
      if (typeof body.startTime === 'string' && body.startTime) {
        updates.actual_start_time = mod24HHmm(body.startTime)
      }
      if (typeof body.endTime === 'string' && body.endTime) {
        updates.actual_end_time = mod24HHmm(body.endTime)
      }
    }

    // 출근보고(D+1 expected_*) 영역 — check_out 전용 수정이 아닐 때만 update
    if (!isCheckOutOnly) {
      if (plannedWorkLocationsPatch !== undefined) {
        updates.planned_work_locations = plannedWorkLocationsPatch
      }
      if (expectedLeaveTimelinePatch !== undefined) {
        updates.expected_leave_timeline = expectedLeaveTimelinePatch
      }
      if (expectedTimelinePatch !== undefined) {
        updates.expected_work_location_timeline = expectedTimelinePatch
      }
      if (mirrorExpectedWorkLocation !== undefined) {
        updates.expected_work_location = mirrorExpectedWorkLocation
      }
      if (mirrorExpectedWorkTime !== undefined) {
        updates.expected_work_time = mirrorExpectedWorkTime
      }
      if (body.attendanceRecordType !== undefined && body.expectedStartDate !== undefined) {
        updates.expected_start_date = body.attendanceRecordType === '출근보고 진행 (주말출근, 휴가 포함)'
          ? body.expectedStartDate
          : null
      }
    }

    // 마카롱 — scope 무관 (모든 scope에서 노출되므로 모든 scope에서 update 가능).
    // 근무지와 동일하게 명시적 전달 시만 갱신.
    if (body.thanksMacaron !== undefined) {
      updates.thanks_macaron = body.thanksMacaron || null
    }

    const { data, error } = await adminClient
      .from('work_logs')
      .update(updates)
      .eq('id', id)
      .select()
      .single()

    if (error) {
      console.error('[work-logs PATCH] update error:', error)
      return NextResponse.json({ error: '저장 중 오류가 발생했습니다.' }, { status: 500 })
    }

    // daily_work_status 동기화
    try {
      const dailySyncUpdates: Record<string, unknown> = { updated_at: new Date().toISOString() }
      if (body.workLocationType || body.workLocation || actualWorkLocationsPatch !== undefined) {
        dailySyncUpdates.current_location = finalWorkLocation
      }
      // 정책 A: 폼의 출퇴근 시간 = 실제 출퇴근 → daily에 저장.
      // check_in 전용 수정(=출근보고만 수정)이면 본문 시간 안 받았으므로 skip.
      if (!isCheckInOnly) {
        const targetDate = body.leaveDate ?? log.leave_date ?? getKstTodayDateString()
        if (body.startTime) {
          dailySyncUpdates.checked_in_at = kstHHmmToIso(targetDate, body.startTime as string)
        }
        if (body.endTime) {
          // 야간 근무(예 27:00) 자정 넘김 안전 변환 — new Date(`...T27:00...`)는 Invalid Date.
          dailySyncUpdates.checked_out_at = kstHHmmToIso(targetDate, body.endTime as string)
        }
      }
      if (Object.keys(dailySyncUpdates).length > 1) {
        await adminClient
          .from('daily_work_status')
          .update(dailySyncUpdates)
          .eq('work_log_id', id)

        await adminClient.from('work_status_events').insert({
          work_date:   body.leaveDate ?? log.leave_date ?? getKstTodayDateString(),
          user_email:  log.user_email ?? '',
          work_log_id: id,
          event_type:  'report_updated',
          event_value: {
            work_location: finalWorkLocation,
            start_time:    body.startTime,
            end_time:      body.endTime,
          },
          event_at:   new Date().toISOString(),
          created_by: user.email ?? '',
        })
      }
    } catch { /* 무시 */ }

    // ─── Teams 수정 알림 ─────────────────────────────────────────────────────
    try {
      const changedFields: ChangedField[] = []

      const strEq = (a: string | null | undefined, b: string | null | undefined) =>
        (a ?? '') === (b ?? '')
      // 시간 정규화 — DB의 TIME("10:00:00")과 body의 HH:mm("10:00")이 같은 의미인데
      // 문자열로 다르게 보여 변경 없는데 changedFields가 push되던 버그를 막는다.
      const timeEq = (a: string | null | undefined, b: string | null | undefined) =>
        fmtTime(a || '') === fmtTime(b || '')

      // 공통 메타 — 항상 비교
      if (!strEq(log.work_type_label, body.workTypeLabel)) {
        changedFields.push({ kind: 'check_out', label: '근무유형', before: log.work_type_label || '미입력', after: body.workTypeLabel || '미입력' })
      }

      // 본문(퇴근보고) 영역 — isCheckInOnly면 UI에 노출 안 됐으므로 비교 자체 skip
      if (!isCheckInOnly) {
        if (!strEq(log.work_location, finalWorkLocation)) {
          changedFields.push({ kind: 'check_out', label: '근무장소', before: log.work_location || '미입력', after: finalWorkLocation || '미입력' })
        }
        if (actualWorkLocationsPatch !== undefined) {
          const prev = normalizeWorkLocations(log.actual_work_locations)
          if (!locationsEqual(prev, actualWorkLocationsPatch)) {
            changedFields.push({
              kind: 'check_out',
              label: '근무장소(실제)',
              before: prev ? formatChipsArrow(prev) : '미입력',
              after: actualWorkLocationsPatch ? formatChipsArrow(actualWorkLocationsPatch) : '미입력',
            })
          }
        }
        if (!timeEq(log.start_time as string | null, body.startTime)) {
          changedFields.push({ kind: 'check_out', label: '출근시각', before: fmtTime(log.start_time || ''), after: fmtTime(body.startTime || '') })
        }
        if (!timeEq(log.end_time as string | null, body.endTime)) {
          changedFields.push({ kind: 'check_out', label: '퇴근시각', before: fmtTime(log.end_time || ''), after: fmtTime(body.endTime || '') })
        }

        const oldBreak = fmtBreak(log.break_time || '00:00:00')
        const newBreak = fmtBreak(body.breakTime ? `${body.breakTime}:00` : '00:00:00')
        if (oldBreak !== newBreak) {
          changedFields.push({ kind: 'check_out', label: '휴게시간', before: oldBreak, after: newBreak })
        }
        if (!strEq(log.work_content, body.workContent)) {
          changedFields.push({ kind: 'check_out', label: '근무내용', before: log.work_content || '미입력', after: body.workContent || '미입력' })
        }
        if (!strEq(log.late_or_attendance_status, body.lateOrAttendanceStatus)) {
          changedFields.push({ kind: 'check_out', label: '지각/당일수정', before: log.late_or_attendance_status || '아니오', after: body.lateOrAttendanceStatus || '아니오' })
        }
        if (body.lateOrAttendanceStatus === '예') {
          if (!strEq(log.previous_report_time, body.previousReportTime)) {
            changedFields.push({ kind: 'check_out', label: '이전보고시각', before: fmtTime(log.previous_report_time || ''), after: fmtTime(body.previousReportTime || '') })
          }
          if (!strEq(log.current_report_time, body.currentReportTime)) {
            changedFields.push({ kind: 'check_out', label: '변경보고시각', before: fmtTime(log.current_report_time || ''), after: fmtTime(body.currentReportTime || '') })
          }
          if (!strEq(log.late_reason, body.lateReason)) {
            changedFields.push({ kind: 'check_out', label: '지각사유', before: log.late_reason || '미입력', after: body.lateReason || '미입력' })
          }
        }
      }

      // 출근보고(D+1 expected_*) 영역 — isCheckOutOnly면 UI에 노출 안 됐으므로 skip
      if (!isCheckOutOnly) {
        if (body.expectedStartDate !== undefined && !strEq(log.expected_start_date, body.expectedStartDate)) {
          changedFields.push({ kind: 'check_in', label: '출근예정일', before: log.expected_start_date || '미입력', after: body.expectedStartDate || '미입력' })
        }
        if (mirrorExpectedWorkTime !== undefined && !timeEq(log.expected_work_time as string | null, mirrorExpectedWorkTime)) {
          changedFields.push({ kind: 'check_in', label: '출근예정시각', before: fmtTime(log.expected_work_time || ''), after: fmtTime(mirrorExpectedWorkTime || '') })
        }
        if (mirrorExpectedWorkLocation !== undefined && !strEq(log.expected_work_location, mirrorExpectedWorkLocation)) {
          changedFields.push({ kind: 'check_in', label: '출근예정장소', before: log.expected_work_location || '미입력', after: mirrorExpectedWorkLocation || '미입력' })
        }
        if (plannedWorkLocationsPatch !== undefined) {
          const prev = normalizeWorkLocations(log.planned_work_locations)
          if (!locationsEqual(prev, plannedWorkLocationsPatch)) {
            changedFields.push({
              kind: 'check_in',
              label: '근무장소(예정)',
              before: prev ? formatChipsArrow(prev) : '미입력',
              after: plannedWorkLocationsPatch ? formatChipsArrow(plannedWorkLocationsPatch) : '미입력',
            })
          }
        }
      }

      // 알림 라벨은 변경된 영역 기반으로 결정 — row.attendance_record_type 신뢰하지 않음.
      // (row가 D-day 본문 + D+1 출근예정 둘 다 가질 수 있어 고정 라벨이 부정확함.)
      const hasCheckIn  = changedFields.some(f => f.kind === 'check_in')
      const hasCheckOut = changedFields.some(f => f.kind === 'check_out')
      const originalReportType: '출근보고' | '퇴근보고' = hasCheckIn && !hasCheckOut
        ? '출근보고'
        : '퇴근보고'
      const scheduledWorkDate = hasCheckIn ? (body.expectedStartDate ?? log.expected_start_date ?? null) : null

      // 변경 사항 없으면 알림 + submission 기록 모두 skip — "10:00→10:00" 같은
      // 빈 알림과 의미 없는 로그 row 방지. audit log는 아래에서 계속 남김.
      if (changedFields.length > 0) {
        let updatedByName = ''
        try {
          const { data: actorProfile } = await adminClient
            .from('user_profiles')
            .select('display_name')
            .eq('id', user.id)
            .maybeSingle()
          updatedByName = actorProfile?.display_name?.trim() || ''
        } catch { /* 무시 */ }
        if (!updatedByName) {
          updatedByName = isOwner ? (log.name ?? '본인') : '관리자'
        }

        // 본부 직속(team 없음)이면 작성자의 notify_team으로 라우팅 치환 (work_log row의 team은 NULL 유지)
        const updateRoutingTeam = await resolveRoutingTeamForLog(adminClient, log)

        // 2026-05-19 v1.21: await — fire-and-forget 시 Vercel function 종료로 promise 끊김.
        await notifyWorkLogUpdatedSplit({
          name: body.name ?? log.name ?? '',
          leaveDate: body.leaveDate ?? log.leave_date ?? '',
          division: log.division ?? null,
          team: updateRoutingTeam || null,
          updatedByName,
          originalReportType,
          scheduledWorkDate,
          changedFields,
        })
      }

      const checkInChanges  = changedFields.filter(f => f.kind === 'check_in')
      const checkOutChanges = changedFields.filter(f => f.kind === 'check_out')
      const submittedNow2 = new Date().toISOString()

      if (checkInChanges.length > 0) {
        await recordSubmission({
          user_id: log.user_id ?? null,
          user_email: log.user_email ?? user.email ?? '',
          name: body.name ?? log.name ?? null,
          division: log.division ?? null,
          team: log.team ?? null,
          report_type: 'check_in_update',
          target_date: body.expectedStartDate ?? log.expected_start_date ?? log.leave_date,
          submitted_at: submittedNow2,
          work_log_id: id,
          expected_start_date:    body.expectedStartDate ?? log.expected_start_date,
          expected_work_time:     mirrorExpectedWorkTime ?? log.expected_work_time,
          expected_work_location: mirrorExpectedWorkLocation ?? log.expected_work_location,
          expected_work_location_timeline: expectedTimelinePatch ?? log.expected_work_location_timeline,
          expected_leave_timeline: expectedLeaveTimelinePatch ?? log.expected_leave_timeline,
          planned_work_locations: plannedWorkLocationsPatch !== undefined
            ? plannedWorkLocationsPatch
            : log.planned_work_locations,
          changed_fields: checkInChanges,
          work_type_label: body.workTypeLabel ?? log.work_type_label,
          attendance_record_type: body.attendanceRecordType ?? log.attendance_record_type,
        })
      }

      if (checkOutChanges.length > 0) {
        await recordSubmission({
          user_id: log.user_id ?? null,
          user_email: log.user_email ?? user.email ?? '',
          name: body.name ?? log.name ?? null,
          division: log.division ?? null,
          team: log.team ?? null,
          report_type: 'check_out_update',
          target_date: body.leaveDate ?? log.leave_date,
          submitted_at: submittedNow2,
          work_log_id: id,
          start_time: body.startTime ?? log.start_time,
          end_time:   body.endTime   ?? log.end_time,
          break_time: body.breakTime ? `${body.breakTime}:00` : log.break_time,
          actual_work_time: `${snappedActualMin} minutes`,
          work_location: finalWorkLocation,
          work_location_timeline: workLocationTimelinePatch ?? log.work_location_timeline,
          actual_work_locations: actualWorkLocationsPatch !== undefined
            ? actualWorkLocationsPatch
            : log.actual_work_locations,
          leave_timeline: leaveTimelinePatch ?? log.leave_timeline,
          work_content: body.workContent ?? log.work_content,
          ew_value: calcResult.ewValue,
          ew_start: calcResult.ewStartText,
          ew_end:   calcResult.ewEndText,
          copy_text: calcResult.copyText,
          late_or_attendance_status: body.lateOrAttendanceStatus ?? log.late_or_attendance_status,
          previous_report_time:      body.previousReportTime ?? log.previous_report_time,
          current_report_time:       body.currentReportTime  ?? log.current_report_time,
          late_reason:               body.lateReason         ?? log.late_reason,
          break_reason: body.breakReason ?? log.break_reason,
          break_auto_actual_minutes:    breakAutoActualMin,
          break_auto_rounded_minutes:   breakAutoRoundedMin,
          break_manual_rounded_minutes: breakManualRoundedMin,
          break_final_rounded_minutes:  breakFinalRoundedMin,
          thanks_macaron: body.thanksMacaron ?? log.thanks_macaron,
          changed_fields: checkOutChanges,
          work_type_label: body.workTypeLabel ?? log.work_type_label,
          work_type_code: calcResult.workTypeCode,
          attendance_record_type: body.attendanceRecordType ?? log.attendance_record_type,
        })
      }

      const auditMeta = extractRequestMeta(request)
      recordAudit({
        actorId: user.id,
        actorEmail: user.email ?? null,
        action: isOwner ? 'work_log_self_update' : 'work_log_admin_update',
        targetTable: 'work_logs',
        targetId: id,
        details: {
          leaveDate: log.leave_date,
          editScope: editScope ?? null,
          reportType: originalReportType,
          changedLabels: changedFields.map(f => f.label),
        },
        ipAddress: auditMeta.ipAddress,
        userAgent: auditMeta.userAgent,
      })
    } catch { /* 무시 */ }

    return NextResponse.json(data)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('Work Log PATCH Error:', message)
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

// ─── DELETE ──────────────────────────────────────────────────────────────────
// 쿼리:
//   (없음)            → 기존 동작: row 전체 soft-delete (backward compat)
//   ?scope=check_in   → 출근보고 영역만 NULL out (퇴근보고 보존)
//   ?scope=check_out  → 퇴근보고 영역만 NULL out (출근보고 보존)
//
// partial 후 양쪽 다 비면(planned_*_time AND actual_*_time 모두 NULL) 자동으로
// row 전체 soft-delete (auto-cleanup). 그 판정 기준은 SubmissionsRawTable의
// workLogToFinalRows 표시 기준과 일치(planned_start/end_time + actual_end_time).
//
// 안전 가드:
//   · Stage 0-2 SoT 컴럼만 건드림 — start_time/end_time(legacy planned fallback) 보존
//   · attendance_record_type은 check_in scope에서만 변경
//   · soft-delete only (deleted_at + deleted_by 박제)
//   · 권한: isOwner OR isAdmin (기존 정책)
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const user = await requireActiveUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized or Inactive account' }, { status: 403 })

    const url = new URL(request.url)
    const scopeParam = url.searchParams.get('scope')
    const scope: 'check_in' | 'check_out' | null =
      scopeParam === 'check_in' || scopeParam === 'check_out' ? scopeParam : null

    const adminClient = createAdminClient()

    const { data: log, error: fetchError } = await adminClient
      .from('work_logs')
      .select('user_id, user_email, is_deleted, name, leave_date, division, team, work_type_label, work_location, start_time, end_time, break_time, work_content, planned_start_time, planned_end_time, actual_start_time, actual_end_time, leave_timeline, expected_leave_timeline, attendance_record_type')
      .eq('id', id)
      .single()

    if (fetchError || !log) {
      return NextResponse.json({ error: '기록을 찾을 수 없습니다.' }, { status: 404 })
    }
    if (log.is_deleted) {
      return NextResponse.json({ error: '이미 삭제된 기록입니다.' }, { status: 410 })
    }

    const isOwner = log.user_id === user.id
    const adminUser = await requireAdmin()
    if (!isOwner && !adminUser) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const nowIso = new Date().toISOString()

    // ─── partial delete: scope별 NULL out 필드 매핑 ────────────────────────────
    // 분류는 PATCH의 editScope 가드(line 410~477)와 데칼코마니.
    let updates: Record<string, unknown> = {}
    let wholeRowDelete = false  // true면 row 전체 soft-delete (scope 없거나 양쪽 다 빈 경우)

    if (scope === 'check_in') {
      // 출근보고 영역만 NULL out — 퇴근보고(본문) 영역은 보존.
      updates = {
        planned_start_time: null,
        planned_end_time: null,
        planned_work_locations: null,
        expected_start_date: null,
        expected_work_time: null,
        expected_work_location: null,
        expected_work_location_timeline: null,
        expected_leave_timeline: null,
        // attendance_record_type은 "이 row가 출근보고 영역 가지고 있음" flag → 출근 삭제 시 끔.
        attendance_record_type: null,
        updated_at: nowIso,
        updated_by: user.id,
      }
      // 양쪽 다 빈 상태가 되는지 사전 판정 (auto-cleanup).
      // 본문(퇴근보고) 비었음 = actual_end_time NULL (= check_out_done 진입 기준과 동일)
      const checkOutEmpty = !log.actual_end_time
      if (checkOutEmpty) {
        wholeRowDelete = true
      }
    } else if (scope === 'check_out') {
      // 퇴근보고(본문) 영역만 NULL out — 출근보고 영역은 보존.
      // legacy start_time/end_time은 절대 안 건드림 (workLogToFinalRows fallback에서
      // planned 표시용으로 쓰이기 때문 — 함정 1 대응).
      //
      // NOT NULL 컬럼은 NULL 대신 의미상 "비어있음" 값으로 reset:
      //   work_location (text NOT NULL)       → ''
      //   copy_text     (text NOT NULL)       → ''
      //   ew_start/end/value (text NOT NULL)  → ''
      //   actual_work_time (interval NOT NULL) → '0 minutes'
      //   deduction_time   (interval NOT NULL) → '0 minutes'
      //   break_time       (interval NOT NULL, default '00:00:00') → '00:00:00'
      updates = {
        actual_start_time: null,
        actual_end_time: null,
        break_time: '00:00:00',
        break_reason: null,
        break_auto_actual_minutes: null,
        break_auto_rounded_minutes: null,
        break_manual_rounded_minutes: null,
        break_final_rounded_minutes: null,
        work_content: null,
        work_location: '',  // NOT NULL
        work_location_type: null,
        work_location_custom: null,
        actual_work_locations: null,
        work_location_timeline: null,
        leave_timeline: null,
        late_or_attendance_status: null,
        previous_report_time: null,
        current_report_time: null,
        late_reason: null,
        thanks_macaron: null,
        // EW 파생값 묶음 reset — 함정 7 대응 (복사문구만 남고 시간 0 모순 방지).
        // NOT NULL 제약상 NULL 불가, 의미상 "비어있음" 값으로:
        deduction_time: '0 minutes',  // NOT NULL
        actual_work_time: '0 minutes',  // NOT NULL
        ew_start: '',  // NOT NULL
        ew_end: '',  // NOT NULL
        ew_value: '',  // NOT NULL
        copy_text: '',  // NOT NULL
        updated_at: nowIso,
        updated_by: user.id,
      }
      // 출근보고 비었음 = planned_*_time 둘 다 NULL (= workLogToFinalRows 표시 기준)
      const checkInEmpty = !log.planned_start_time && !log.planned_end_time
      if (checkInEmpty) {
        wholeRowDelete = true
      }
    } else {
      // scope 없음 — row 전체 soft-delete (기존 동작 그대로)
      wholeRowDelete = true
    }

    // 양쪽 다 비면 row 전체 soft-delete로 격상 (auto-cleanup).
    if (wholeRowDelete) {
      updates = {
        is_deleted: true,
        deleted_at: nowIso,
        deleted_by: user.id,
      }
    }

    const { error } = await adminClient
      .from('work_logs')
      .update(updates)
      .eq('id', id)

    if (error) throw error

    // ─── daily_work_status 동기화 (함정 5/9 대응) ────────────────────────────────
    // 시나리오별:
    //   1) scope='check_out' + partial (본문 영역만 삭제, 출근보고는 살아있음)
    //      → "출근완료, 퇴근 전" 상태로 되돌림: status='checked_in', checked_out_at=null
    //   2) scope='check_in' + partial (출근보고만 삭제, 본문 살아있음)
    //      → daily 그대로 유지 (본문이 의미 가짐)
    //   3) wholeRowDelete=true (양쪽 다 비어 row 전체 삭제 OR ?scope 없이 호출)
    //      → daily도 "미보고" 상태로 reset (check-in-cancel 패턴과 동일):
    //        status='not_reported', checked_in_at/out_at=null, is_on_break=false.
    //      안 그러면 둘러보기 카드가 "근무중"으로 stale 표시되고 "출근보고 수정" 버튼도 잔존.
    try {
      if (wholeRowDelete) {
        await adminClient
          .from('daily_work_status')
          .update({
            status: 'not_reported',
            checked_in_at: null,
            checked_out_at: null,
            break_started_at: null,
            break_ended_at: null,
            is_on_break: false,
            current_location: null,
            current_location_index: null,
            updated_at: nowIso,
          })
          .eq('work_log_id', id)
      } else if (scope === 'check_out') {
        await adminClient
          .from('daily_work_status')
          .update({
            status: 'checked_in',
            checked_out_at: null,
            updated_at: nowIso,
          })
          .eq('work_log_id', id)
      }
      // scope === 'check_in' && !wholeRowDelete: daily 그대로 (본문 보존됨)
    } catch { /* 무시 — best-effort */ }

    // ─── Google 캘린더 휴가 sync (함정 4/8 대응) ─────────────────────────────────
    // partial delete가 leave_timeline 또는 expected_leave_timeline에 영향 줄 때만.
    // prev에 기존 google_event_id 포함 → 명시적 delete 트리거.
    if (!wholeRowDelete) {
      try {
        const { syncLeaveTimelineWithGoogle } = await import('@/lib/google-calendar/vacation-sync')
        if (scope === 'check_out' && Array.isArray(log.leave_timeline) && log.leave_timeline.length > 0 && log.leave_date && log.user_email) {
          await syncLeaveTimelineWithGoogle({
            adminClient,
            userEmail: log.user_email,
            userDisplayName: log.name ?? log.user_email,
            leaveDate: log.leave_date,
            prev: log.leave_timeline,
            next: [],
          })
        }
        if (scope === 'check_in' && Array.isArray(log.expected_leave_timeline) && log.expected_leave_timeline.length > 0 && log.leave_date && log.user_email) {
          await syncLeaveTimelineWithGoogle({
            adminClient,
            userEmail: log.user_email,
            userDisplayName: log.name ?? log.user_email,
            leaveDate: log.leave_date,
            prev: log.expected_leave_timeline,
            next: [],
          })
        }
      } catch (vacSyncErr) {
        console.warn('[work-logs DELETE] vacation sync failed (non-fatal):', vacSyncErr)
      }
    }

    let deletedByName = ''
    try {
      const { data: actorProfile } = await adminClient
        .from('user_profiles')
        .select('display_name')
        .eq('id', user.id)
        .maybeSingle()
      deletedByName = actorProfile?.display_name?.trim() || ''
    } catch { /* 무시 */ }
    if (!deletedByName) {
      deletedByName = isOwner ? (log.name ?? '본인') : '관리자'
    }

    // ─── Teams 알림 (함정 — scope-aware 메시지) ─────────────────────────────────
    // partial delete는 scope에 맞춰 라우팅(출근보고/퇴근보고 채널 분기).
    // 양쪽 다 비어 row 전체 delete된 경우엔 scope=undefined로 발송 → 기존 메시지.
    await notifyWorkLogDeleted({
      name: log.name ?? '',
      leaveDate: log.leave_date ?? '',
      deletedByName,
      workTypeLabel: log.work_type_label ?? '',
      workLocation: log.work_location ?? '',
      startTime: log.start_time ?? '',
      endTime: log.end_time ?? '',
      breakTime: log.break_time ?? '00:00:00',
      workContent: log.work_content ?? null,
      division: log.division ?? null,
      // 본부 직속(team 없음)이면 작성자의 notify_team으로 라우팅 치환
      team: (await resolveRoutingTeamForLog(adminClient, log)) || null,
      scope: wholeRowDelete ? null : scope,
    })

    // ─── work_log_submissions append (함정 3 대응) ─────────────────────────────
    // 사용자가 history에서 "이 보고 삭제됨" history를 추적할 수 있도록.
    // 라벨은 사용자 의도(누른 버튼) 기준 — wholeRowDelete 격상 여부와 무관.
    // 예: 출근만 있던 row의 [출근보고 삭제] → wholeRowDelete=true로 격상되지만 라벨은 'check_in_delete'.
    //     ?scope 없이 호출되는 진짜 전체 삭제(API 직접 호출 등)만 'work_log_delete'.
    try {
      const submissionReportType:
        | 'check_in_delete' | 'check_out_delete' | 'work_log_delete' =
        scope === 'check_in' ? 'check_in_delete'
          : scope === 'check_out' ? 'check_out_delete'
          : 'work_log_delete'
      await recordSubmission({
        user_id: log.user_id ?? null,
        user_email: log.user_email ?? user.email ?? '',
        name: log.name ?? null,
        division: log.division ?? null,
        team: log.team ?? null,
        report_type: submissionReportType,
        target_date: log.leave_date,
        submitted_at: nowIso,
        work_log_id: id,
      })
    } catch { /* 무시 */ }

    try {
      const meta = extractRequestMeta(request)
      recordAudit({
        actorId: user.id,
        actorEmail: user.email ?? null,
        action: isOwner ? 'work_log_self_delete' : 'work_log_admin_delete',
        targetTable: 'work_logs',
        targetId: id,
        details: {
          leaveDate: log.leave_date,
          name: log.name,
          scope: wholeRowDelete ? null : scope,
          wholeRowDelete,
        },
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      })
    } catch { /* 무시 */ }

    return NextResponse.json({ success: true, scope: wholeRowDelete ? null : scope, wholeRowDelete })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('Work Log DELETE Error:', message)
    return NextResponse.json({ error: '서버 에러가 발생했습니다.' }, { status: 500 })
  }
}
