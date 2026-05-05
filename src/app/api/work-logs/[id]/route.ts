import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdmin, requireActiveUser } from '@/lib/admin-check'
import { calculateEw } from '@/lib/ew-calculator'
import { notifyWorkLogUpdated, notifyWorkLogDeleted } from '@/lib/notifications/teams'
import type { ChangedField } from '@/lib/notifications/types'
import { fmtTime, fmtBreak } from '@/lib/notifications/messages'

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
      .select('user_id, user_email, name, is_deleted, division, team, leave_date, start_time, end_time, work_location, break_time, work_content, ew_value, work_type_label, attendance_record_type, expected_start_date, late_or_attendance_status, previous_report_time, current_report_time, late_reason, expected_work_time, expected_work_location')
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

    const finalWorkLocation: string =
      body.workLocationType === '기타'
        ? (body.workLocationCustom ?? body.workLocation ?? '')
        : (body.workLocationType ?? body.workLocation ?? '')

    const finalExpectedWorkLocation: string | null =
      body.attendanceRecordType === '출근보고 진행 (주말출근, 휴가 포함)'
        ? body.expectedWorkLocationType === '기타'
          ? (body.expectedWorkLocation ?? null)
          : (body.expectedWorkLocationType ?? body.expectedWorkLocation ?? null)
        : null

    const calcResult = calculateEw({
      name: body.name,
      workTypeLabel: body.workTypeLabel,
      leaveDate: body.leaveDate,
      startTime: body.startTime,
      endTime: body.endTime,
      breakTime: body.breakTime || '00:00',
      workLocation: finalWorkLocation,
      workContent: body.workContent,
      breakReason: body.breakReason,
    })

    const updates = {
      name: body.name,
      work_type_label: body.workTypeLabel,
      work_type_code: calcResult.workTypeCode,
      leave_date: body.leaveDate,
      start_time: body.startTime,
      end_time: body.endTime,
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
          work_date:   body.leaveDate ?? log.leave_date ?? new Date().toISOString().slice(0, 10),
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
        if (!strEq(log.expected_start_date, body.expectedStartDate)) {
          changedFields.push({ label: '출근예정일', before: log.expected_start_date || '미입력', after: body.expectedStartDate || '미입력' })
        }
        if (!strEq(log.expected_work_time, body.expectedWorkTime)) {
          changedFields.push({ label: '출근예정시각', before: fmtTime(log.expected_work_time || ''), after: fmtTime(body.expectedWorkTime || '') })
        }
        if (!strEq(log.expected_work_location, finalExpectedWorkLocation)) {
          changedFields.push({ label: '출근예정장소', before: log.expected_work_location || '미입력', after: finalExpectedWorkLocation || '미입력' })
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
