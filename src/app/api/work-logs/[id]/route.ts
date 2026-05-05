import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdmin, requireActiveUser } from '@/lib/admin-check'
import { calculateEw } from '@/lib/ew-calculator'
import { notifyWorkLogUpdated, notifyWorkLogDeleted } from '@/lib/notifications/teams'

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
      .select('user_id, user_email, name, is_deleted, leave_date, start_time, end_time, work_location, break_time, work_content, ew_value, work_type_label')
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
    notifyWorkLogUpdated({
      name: body.name ?? log.name ?? '',
      leaveDate: body.leaveDate ?? log.leave_date ?? '',
      workTypeLabel: body.workTypeLabel ?? log.work_type_label ?? '',
      workLocation: finalWorkLocation,
      startTime: body.startTime ?? '',
      endTime: body.endTime ?? '',
      breakTime: body.breakTime ? `${body.breakTime}:00` : '00:00:00',
      lateOrAttendanceStatus: body.lateOrAttendanceStatus || '아니오',
      previousReportTime: body.lateOrAttendanceStatus === '예' ? (body.previousReportTime ?? null) : null,
      currentReportTime:  body.lateOrAttendanceStatus === '예' ? (body.currentReportTime ?? null) : null,
      lateReason:         body.lateOrAttendanceStatus === '예' ? (body.lateReason ?? null) : null,
      workContent: body.workContent || null,
      attendanceRecordType: body.attendanceRecordType || null,
      expectedStartDate:    body.attendanceRecordType === '출근보고 진행 (주말출근, 휴가 포함)' ? (body.expectedStartDate ?? null) : null,
      expectedWorkTime:     body.attendanceRecordType === '출근보고 진행 (주말출근, 휴가 포함)' ? (body.expectedWorkTime ?? null) : null,
      expectedWorkLocation: body.attendanceRecordType === '출근보고 진행 (주말출근, 휴가 포함)'
        ? (body.expectedWorkLocationType === '기타' ? body.expectedWorkLocation : body.expectedWorkLocationType) ?? null
        : null,
    })

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

    // 알림용으로 더 많은 필드 조회
    const { data: log, error: fetchError } = await adminClient
      .from('work_logs')
      .select('user_id, is_deleted, name, leave_date, work_type_label, work_location, start_time, end_time, break_time, work_content')
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
    })

    return NextResponse.json({ success: true })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('Work Log DELETE Error:', message)
    return NextResponse.json({ error: '서버 에러가 발생했습니다.' }, { status: 500 })
  }
}
