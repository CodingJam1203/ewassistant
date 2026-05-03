import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { calculateEw } from '@/lib/ew-calculator'
import { requireActiveUser } from '@/lib/admin-check'
// TODO: Teams 연동 권한 확보 후 주석 해제
// import { sendExternalWebhook, ExternalWebhookPayload } from '@/lib/make-webhook'

export async function POST(request: Request) {
  try {
    const user = await requireActiveUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized or Inactive account' }, { status: 403 })
    }

    const body = await request.json()

    // 근무장소 최종 결정
    const finalWorkLocation: string =
      body.workLocationType === '기타'
        ? (body.workLocationCustom ?? '')
        : (body.workLocationType ?? '')

    // 출퇴근 예정장소 최종 결정 (새 드롭다운 필드 지원)
    const finalExpectedWorkLocation: string | null =
      body.attendanceRecordType === '출근보고 진행 (주말출근, 휴가 포함)'
        ? body.expectedWorkLocationType === '기타'
          ? (body.expectedWorkLocation ?? null)
          : (body.expectedWorkLocationType ?? body.expectedWorkLocation ?? null)
        : null

    // Server-side recalculation to prevent manipulation
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

    // ─── 제출자 본부/팀 스냅샷 조회 ─────────────────────────────────────────────
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

    // Prepare data for insertion
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

    // Insert into DB
    const adminClient = createAdminClient()
    const { data, error } = await adminClient
      .from('work_logs')
      .insert([insertData])
      .select()
      .single()

    if (error) {
      console.error('DB Insert Error:', error)
      return NextResponse.json({ error: `데이터 저장 실패: ${error.message}` }, { status: 500 })
    }

    // ─── 사후 처리: display_name 자동저장 + last_submitted_at 업데이트 ──────
    try {

      // display_name이 비어있으면 이번 제출의 name으로 채움
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
      // user_profiles 미생성 시 무시 (비핵심 처리)
    }

    /* ─── Teams 웹훅 전송 (TODO: 권한 확보 후 주석 해제) ───────────────────────
    if (body.sendTeams !== false) {
      const morningReportReason =
        body.attendanceRecordType === '출근보고 진행 (주말출근, 휴가 포함)'
          ? [body.expectedStartDate, body.expectedWorkTime, finalExpectedWorkLocation]
              .filter(Boolean).join(' / ')
          : ''

      const noteParts: string[] = []
      if (body.workContent) noteParts.push(body.workContent)
      if (body.thanksMacaron) noteParts.push(`💌 감사 마카롱: ${body.thanksMacaron}`)

      const webhookPayload: ExternalWebhookPayload = {
        name: body.name ?? '',
        email: user.email ?? '',
        workDate: body.leaveDate ?? '',
        workPlace: finalWorkLocation,
        startTime: body.startTime ?? '',
        endTime: body.endTime ?? '',
        breakTime: body.breakTime ?? '00:00',
        ewStartTime: calcResult.ewStartText,
        ewEndTime: calcResult.ewEndText,
        lateType: body.lateOrAttendanceStatus ?? '아니오',
        lateReason: body.lateOrAttendanceStatus === '예' ? (body.lateReason ?? '') : '',
        morningReportType: body.attendanceRecordType ?? '',
        morningReportReason,
        note: noteParts.join('\n'),
      }

      try {
        await sendExternalWebhook(webhookPayload)
        await supabase.from('work_logs').update({ teams_sent: true }).eq('id', data.id)
        console.log(`[Webhook] Make 전송 성공 — work_log id: ${data.id}`)
      } catch (webhookErr: any) {
        console.error(`[Webhook] Make 전송 실패 — work_log id: ${data.id}`, webhookErr?.message ?? webhookErr)
      }
    }
    ─────────────────────────────────────────────────────────────────────────── */

    return NextResponse.json(data)
  } catch (err: any) {
    console.error('Work Log API Error:', err)
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

    let query = supabase
      .from('work_logs')
      .select('*')
      .eq('is_deleted', false)           // 소프트 삭제된 레코드 제외
      .order('leave_date', { ascending: false })
      .order('created_at', { ascending: false })

    if (mine) {
      query = query.eq('user_id', user.id)
    } else if (filterDivision || filterTeam) {
      // 본부/팀 필터: user_profiles에서 해당 조직의 email 목록 조회
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
          // 해당 조건의 사용자 없음 → 빈 결과
          return NextResponse.json([])
        }
        query = query.in('user_email', matchedEmails)
      } catch {
        // 필터 조회 실패 시 필터 없이 전체 반환
      }
    }

    const { data, error } = await query

    if (error) {
      throw error
    }

    return NextResponse.json(data)
  } catch (err: any) {
    console.error('Work Log GET Error:', err)
    return NextResponse.json({ error: '서버 에러가 발생했습니다.' }, { status: 500 })
  }
}
