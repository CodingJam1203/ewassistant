import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getKstTodayDateString } from '@/lib/utils/date'
import { requireAdmin, requireActiveUser } from '@/lib/admin-check'
import { calculateEw } from '@/lib/ew-calculator'
import { notifyWorkLogUpdated, notifyWorkLogDeleted } from '@/lib/notifications/teams'
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
import type { WorkLocationTimeline } from '@/types/work-location-timeline'
import type { LeaveTimeline } from '@/types/leave-timeline'

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
      .select('user_id, user_email, name, is_deleted, division, team, leave_date, start_time, end_time, work_location, break_time, work_content, ew_value, work_type_label, attendance_record_type, expected_start_date, late_or_attendance_status, previous_report_time, current_report_time, late_reason, expected_work_time, expected_work_location, work_location_timeline')
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

    // ─── 휴가 타임라인 처리 (PATCH) ────────────────────────────────────────
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

    // 다음 출근 예정 휴가
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
    // leaveIncludesLunch 자동 처리 제거 — 사용자가 차감시간 직접 조정

    // ─── 본문 근무장소 타임라인 처리 (PATCH) ────────────────────────────────
    // body.workLocationTimeline이 명시적으로 전달된 경우에만 업데이트.
    // 미전달 시(EditLogModal 등 기존 호출) 기존 work_* 컬럼만 변경됨.
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

    // 최종 work_location/start/end: timeline 우선, 없으면 body의 단일 필드
    const finalWorkLocation: string = workTimelineFirst
      ? displayLocation(workTimelineFirst)
      : (body.workLocationType === '기타'
          ? (body.workLocationCustom ?? body.workLocation ?? '')
          : (body.workLocationType ?? body.workLocation ?? ''))
    const finalStartTime: string = workTimelineFirst?.startTime ?? body.startTime
    const finalEndTime: string = workTimelineEnd?.startTime ?? body.endTime
    const locationSummary: string = workLocationTimelinePatch
      ? (buildLocationSummary(workLocationTimelinePatch) || finalWorkLocation)
      : finalWorkLocation

    // ─── 출근보고 (다음 출근 예정) 타임라인 처리 (PATCH) ──────────────────────
    // body.expectedTimeline이 명시적으로 전달된 경우에만 timeline 업데이트.
    // 미전달 시(EditLogModal 등 기존 호출) 기존 expected_* 컬럼만 변경되도록 유지.
    let expectedTimelinePatch: WorkLocationTimeline | null | undefined = undefined  // undefined = 미변경
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
        // legacy 단일 필드 변경
        mirrorExpectedWorkLocation =
          body.expectedWorkLocationType === '기타'
            ? (body.expectedWorkLocation ?? null)
            : (body.expectedWorkLocationType ?? body.expectedWorkLocation ?? null)
        mirrorExpectedWorkTime = body.expectedWorkTime ?? null
      }
    }

    // 휴게 4분리 (PATCH도 동일 규칙)
    const breakAutoActualMin: number = Number.isFinite(body.breakAutoActualMinutes)
      ? Math.max(0, Number(body.breakAutoActualMinutes)) : 0
    const breakAutoRoundedMin: number = Number.isFinite(body.breakAutoRoundedMinutes)
      ? Math.max(0, Number(body.breakAutoRoundedMinutes)) : ceilTo30Min(breakAutoActualMin)
    const breakManualRoundedMin: number | null = (
      body.breakManualRoundedMinutes !== undefined && body.breakManualRoundedMinutes !== null
    ) ? Math.max(0, Number(body.breakManualRoundedMinutes)) : null
    const breakFinalRoundedMin: number = Number.isFinite(body.breakFinalRoundedMinutes)
      ? Math.max(0, Number(body.breakFinalRoundedMinutes))
      : (breakManualRoundedMin ?? breakAutoRoundedMin)

    const breakHHForCalc: string = (() => {
      const m = breakFinalRoundedMin
      const h = Math.floor(m / 60)
      const mm = m % 60
      return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
    })()

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
      // leaveIncludesLunch 자동 처리 안 함 — 사용자가 차감시간 직접 조정
    })

    const updates: Record<string, unknown> = {
      name: body.name,
      work_type_label: body.workTypeLabel,
      work_type_code: calcResult.workTypeCode,
      leave_date: body.leaveDate,
      start_time: finalStartTime,
      end_time: finalEndTime,
      break_time: body.breakTime ? `${body.breakTime}:00` : '00:00:00',
      break_reason: body.breakReason || null,
      work_content: body.workContent || null,
      work_location: finalWorkLocation,
      work_location_type: body.workLocationType || null,
      deduction_time: `${calcResult.deductionMinutes} minutes`,
      actual_work_time: `${calcResult.actualWorkMinutes} minutes`,
      ew_start: calcResult.ewStartText,
      ew_end: calcResult.ewEndText,
      ew_value: calcResult.ewValue,
      copy_text: calcResult.copyText,
      updated_at: new Date().toISOString(),
      updated_by: user.id,
    }

    // 본문 work_location_timeline은 body가 명시적으로 보낸 경우에만 업데이트
    if (workLocationTimelinePatch !== undefined) {
      updates.work_location_timeline = workLocationTimelinePatch
    }

    // leave_timeline / expected_leave_timeline은 body가 명시적으로 보낸 경우에만 업데이트
    if (leaveTimelinePatch !== undefined) {
      updates.leave_timeline = leaveTimelinePatch
    }
    if (expectedLeaveTimelinePatch !== undefined) {
      updates.expected_leave_timeline = expectedLeaveTimelinePatch
    }

    // 휴게 4분리 — body가 명시적으로 보낸 경우에만 업데이트
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

    // 출근보고 timeline / mirror 값은 body가 명시적으로 보낸 경우에만 업데이트
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

    const { data, error } = await adminClient
      .from('work_logs')
      .update(updates)
      .eq('id', id)
      .select()
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // ─── daily_work_status 동기화 (비동기, 실패 무관) ─────────────────────────
    try {
      const dailySyncUpdates: Record<string, unknown> = { updated_at: new Date().toISOString() }
      if (body.workLocationType || body.workLocation) {
        dailySyncUpdates.current_location = finalWorkLocation
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
    } catch { /* 동기화 실패 무시 */ }

    // ─── Teams 수정 알림 ─────────────────────────────────────────────────────
    try {
      // 변경된 필드 계산 (before → after)
      const isCheckin = log.attendance_record_type === '출근보고 진행 (주말출근, 휴가 포함)'
      const changedFields: ChangedField[] = []

      const strEq = (a: string | null | undefined, b: string | null | undefined) =>
        (a ?? '') === (b ?? '')

      if (!strEq(log.work_type_label, body.workTypeLabel)) {
        changedFields.push({ label: '근무유형', before: log.work_type_label || '미입력', after: body.workTypeLabel || '미입력' })
      }
      if (!strEq(log.work_location, finalWorkLocation)) {
        changedFields.push({ label: '근무장소', before: log.work_location || '미입력', after: finalWorkLocation || '미입력' })
      }
      if (!strEq(log.start_time, body.startTime)) {
        changedFields.push({ label: '출근시각', before: fmtTime(log.start_time || ''), after: fmtTime(body.startTime || '') })
      }
      if (!strEq(log.end_time, body.endTime)) {
        changedFields.push({ label: '퇴근시각', before: fmtTime(log.end_time || ''), after: fmtTime(body.endTime || '') })
      }

      const oldBreak = fmtBreak(log.break_time || '00:00:00')
      const newBreak = fmtBreak(body.breakTime ? `${body.breakTime}:00` : '00:00:00')
      if (oldBreak !== newBreak) {
        changedFields.push({ label: '휴게시간', before: oldBreak, after: newBreak })
      }
      if (!strEq(log.work_content, body.workContent)) {
        changedFields.push({ label: '근무내용', before: log.work_content || '미입력', after: body.workContent || '미입력' })
      }
      if (!strEq(log.late_or_attendance_status, body.lateOrAttendanceStatus)) {
        changedFields.push({ label: '지각/당일수정', before: log.late_or_attendance_status || '아니오', after: body.lateOrAttendanceStatus || '아니오' })
      }
      if (body.lateOrAttendanceStatus === '예') {
        if (!strEq(log.previous_report_time, body.previousReportTime)) {
          changedFields.push({ label: '이전보고시각', before: fmtTime(log.previous_report_time || ''), after: fmtTime(body.previousReportTime || '') })
        }
        if (!strEq(log.current_report_time, body.currentReportTime)) {
          changedFields.push({ label: '변경보고시각', before: fmtTime(log.current_report_time || ''), after: fmtTime(body.currentReportTime || '') })
        }
        if (!strEq(log.late_reason, body.lateReason)) {
          changedFields.push({ label: '지각사유', before: log.late_reason || '미입력', after: body.lateReason || '미입력' })
        }
      }
      if (isCheckin) {
        // body가 명시적으로 보낸 필드만 변경 감지 (보내지 않은 필드는 미변경으로 간주)
        if (body.expectedStartDate !== undefined && !strEq(log.expected_start_date, body.expectedStartDate)) {
          changedFields.push({ label: '출근예정일', before: log.expected_start_date || '미입력', after: body.expectedStartDate || '미입력' })
        }
        if (mirrorExpectedWorkTime !== undefined && !strEq(log.expected_work_time, mirrorExpectedWorkTime)) {
          changedFields.push({ label: '출근예정시각', before: fmtTime(log.expected_work_time || ''), after: fmtTime(mirrorExpectedWorkTime || '') })
        }
        if (mirrorExpectedWorkLocation !== undefined && !strEq(log.expected_work_location, mirrorExpectedWorkLocation)) {
          changedFields.push({ label: '출근예정장소', before: log.expected_work_location || '미입력', after: mirrorExpectedWorkLocation || '미입력' })
        }
      }

      const originalReportType = isCheckin ? '출근보고' : '퇴근보고'
      const scheduledWorkDate  = isCheckin ? (log.expected_start_date ?? null) : null

      notifyWorkLogUpdated({
        name: body.name ?? log.name ?? '',
        leaveDate: body.leaveDate ?? log.leave_date ?? '',
        division: log.division ?? null,
        team: log.team ?? null,
        updatedByEmail: user.email ?? user.id,
        originalReportType,
        scheduledWorkDate,
        changedFields,
      })
    } catch { /* 알림 실패 무시 */ }

    return NextResponse.json(data)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('Work Log PATCH Error:', message)
    return NextResponse.json({ error: '서버 에러가 발생했습니다.' }, { status: 500 })
  }
}

// ─── DELETE /api/work-logs/[id] ──────────────────────────────────────────────
export async function DELETE(
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
      .select('user_id, is_deleted, name, leave_date, division, team, work_type_label, work_location, start_time, end_time, break_time, work_content')
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

    const { error } = await adminClient
      .from('work_logs')
      .update({
        is_deleted: true,
        deleted_at: new Date().toISOString(),
        deleted_by: user.id,
      })
      .eq('id', id)

    if (error) throw error

    // ─── Teams 삭제 알림 ─────────────────────────────────────────────────────
    notifyWorkLogDeleted({
      name: log.name ?? '',
      leaveDate: log.leave_date ?? '',
      deletedByEmail: user.email ?? user.id,
      workTypeLabel: log.work_type_label ?? '',
      workLocation: log.work_location ?? '',
      startTime: log.start_time ?? '',
      endTime: log.end_time ?? '',
      breakTime: log.break_time ?? '00:00:00',
      workContent: log.work_content ?? null,
      division: log.division ?? null,
      team: log.team ?? null,
    })

    return NextResponse.json({ success: true })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('Work Log DELETE Error:', message)
    return NextResponse.json({ error: '서버 에러가 발생했습니다.' }, { status: 500 })
  }
}
