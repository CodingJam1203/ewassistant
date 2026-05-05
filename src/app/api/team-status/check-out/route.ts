import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getKstTodayDateString } from '@/lib/utils/date'
import { createAdminClient } from '@/lib/supabase/admin'

// POST /api/team-status/check-out
// body: { date: YYYY-MM-DD, checked_out_at?: ISO }
export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json()
    const date: string = body.date ?? getKstTodayDateString()
    const now = body.checked_out_at ?? new Date().toISOString()
    const adminClient = createAdminClient()

    const { data: profile } = await adminClient
      .from('user_profiles')
      .select('id')
      .eq('email', user.email!)
      .single()

    // 기존 상태 조회 (없으면 null)
    const { data: existing } = await adminClient
      .from('daily_work_status')
      .select('*')
      .eq('work_date', date)
      .eq('user_email', user.email!)
      .maybeSingle()

    // daily_work_status upsert — 출근 기록이 없어도 퇴근 처리
    const { data: daily, error } = await adminClient
      .from('daily_work_status')
      .upsert({
        work_date:       date,
        user_email:      user.email!,
        user_profile_id: profile?.id ?? null,
        work_log_id:     existing?.work_log_id ?? null,
        status:          'checked_out',
        current_location: existing?.current_location ?? null,
        checked_in_at:   existing?.checked_in_at ?? null,
        checked_out_at:  now,
        is_on_break:     false,
        updated_at:      now,
      }, { onConflict: 'work_date,user_email' })
      .select()
      .single()

    if (error) throw error

    await adminClient.from('work_status_events').insert({
      work_date:       date,
      user_email:      user.email!,
      user_profile_id: profile?.id ?? null,
      work_log_id:     existing?.work_log_id ?? null,
      event_type:      'check_out',
      event_value:     { location: existing?.current_location ?? null },
      event_at:        now,
      created_by:      user.email!,
    })

    return NextResponse.json(daily)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
