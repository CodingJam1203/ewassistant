import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { calculateEw } from '@/lib/ew-calculator'
import { requireActiveUser } from '@/lib/admin-check'
import { notifyWorkLogSubmitted, notifyCheckoutResubmitted } from '@/lib/notifications/teams'

export async function POST(request: Request) {
  try {
    const user = await requireActiveUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized or Inactive account' }, { status: 403 })
    }

    const body = await request.json()

    const finalWorkLocation: string =
      body.workLocationType === '기타'
        ? (body.workLocationCustom ?? '')
        : (body.workLocationType ?? '')

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
      start_time: body.startTime,
      end_time: body.endTime,
      break_time: body.breakTime ? `${body.breakTime}:00` : '00:00:00',
      break_reason: body.breakReason || null,
      work_content: body.workContent || null,
      work_location: finalWorkLocation,
      work_location_type: body.workLocationType || null,
      work_location_custom: body.workLocationType === '기타' ? body.workLocationCustom : null,
      late_or_attendance_status: body.lateOrAttendanceStatus || null,
      previous_report_time: body.lateOrAttendanceStatus === '예' ? body.previousReportTime : null,
      current_report_time: body.lateOrAttendanceStatus === '예' ? body.currentReportTime : null,
      late_reason: body.lateOrAttendanceStatus === '예' ? body.lateReason : null,
      attendance_record_type: body.attendanceRecordType || null,
      expected_start_date: body.attendanceRecordType === '출근보고 진행 (주말출근, 휴가 포함)' ? body.expectedStartDate : null,
      expected_work_time: body.attendanceRecordType === '출근보고 진행 (주말출근, 휴가 포함)' ? body.expectedWorkTime : null,
      expected_work_location: finalExpectedWorkLocation,
      thanks_macaron: body.thanksMacaron || null,
      deduction_time: `${calcResult.deductionMinutes} minutes`,
      actual_work_time: `${calcResult.actualWorkMinutes} minutes`,
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
      expectedWorkLocation: finalExpectedWorkLocation,
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
    const limitParam = searchParams.get('limit')
    const limit = limitParam ? Math.min(Number(limitParam), 1000) : 500

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
