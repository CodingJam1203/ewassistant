import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { calculateEw } from '@/lib/ew-calculator'

/**
 * POST /api/team-status/check-in
 *
 * body:
 *   date: YYYY-MM-DD
 *   work_log_id?: string          — 이미 work_log가 있으면 전달
 *   // work_log가 없을 때 새로 생성:
 *   name?: string
 *   work_location?: string
 *   work_location_type?: string
 *   start_time?: string           — HH:mm (EW 시작/출근 예정)
 *   end_time?: string             — HH:mm (EW 종료/퇴근 예정)
 *   break_time?: string           — HH:mm
 *   work_content?: string
 */
export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json()
    const date: string = body.date ?? new Date().toISOString().slice(0, 10)
    // 클라이언트에서 시각을 선택했으면 그 값 사용, 없으면 지금
    const now = body.checked_in_at ?? new Date().toISOString()
    const adminClient = createAdminClient()

    // ── 프로필 조회 ────────────────────────────────────────────────────────────
    const { data: profile } = await adminClient
      .from('user_profiles')
      .select('id, email, display_name, division, team')
      .eq('email', user.email!)
      .single()

    let workLogId: string | null = body.work_log_id ?? null

    // ── work_log가 없으면 새로 생성 ─────────────────────────────────────────────
    if (!workLogId) {
      const startTime = body.start_time ?? '09:00'
      const endTime   = body.end_time   ?? '18:00'
      const breakTime = body.break_time ?? '01:00'
      const workLocation = body.work_location ?? body.work_location_type ?? '사무실'
      const workContent  = body.work_content  ?? ''
      const name         = body.name ?? profile?.display_name ?? user.email!

      const calcResult = calculateEw({
        name,
        workTypeLabel: '기본근무 등록',
        leaveDate: date,
        startTime,
        endTime,
        breakTime,
        workLocation,
        workContent,
      })

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
          work_location_type: body.work_location_type ?? '사무실',
          late_or_attendance_status: '아니오',
          attendance_record_type: '출근보고 진행 (주말출근, 휴가 포함)',
          deduction_time: `${calcResult.deductionMinutes} minutes`,
          actual_work_time: `${calcResult.actualWorkMinutes} minutes`,
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

      // last_submitted_at 갱신
      await adminClient
        .from('user_profiles')
        .update({ last_submitted_at: now })
        .eq('email', user.email!)
    }

    // ── daily_work_status upsert ────────────────────────────────────────────────
    const currentLocation = body.work_location ?? body.work_location_type ?? '사무실'

    const { data: daily, error: dailyErr } = await adminClient
      .from('daily_work_status')
      .upsert({
        work_date:        date,
        user_email:       user.email!,
        user_profile_id:  profile?.id ?? null,
        work_log_id:      workLogId,
        status:           'working',
        current_location: currentLocation,
        checked_in_at:    now,
        checked_out_at:   null,
        is_on_break:      false,
        updated_at:       now,
      }, { onConflict: 'work_date,user_email' })
      .select()
      .single()

    if (dailyErr) throw dailyErr

    // ── 이벤트 기록 ────────────────────────────────────────────────────────────
    await adminClient.from('work_status_events').insert({
      work_date:       date,
      user_email:      user.email!,
      user_profile_id: profile?.id ?? null,
      work_log_id:     workLogId,
      event_type:      workLogId !== body.work_log_id ? 'report_created_from_check_in' : 'check_in',
      event_value:     { location: currentLocation },
      event_at:        now,
      created_by:      user.email!,
    })

    return NextResponse.json(daily)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
