import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

// POST /api/team-status/break-start
// body: { date: YYYY-MM-DD }
export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json()
    const date: string = body.date ?? new Date().toISOString().slice(0, 10)
    const now = new Date().toISOString()
    const adminClient = createAdminClient()

    const { data: profile } = await adminClient
      .from('user_profiles')
      .select('id')
      .eq('email', user.email!)
      .single()

    const { data: existing } = await adminClient
      .from('daily_work_status')
      .select('*')
      .eq('work_date', date)
      .eq('user_email', user.email!)
      .single()

    if (!existing?.checked_in_at) {
      return NextResponse.json({ error: '출근 상태가 아닙니다.' }, { status: 400 })
    }
    if (existing.checked_out_at) {
      return NextResponse.json({ error: '이미 퇴근한 상태입니다.' }, { status: 400 })
    }

    const { data: daily, error } = await adminClient
      .from('daily_work_status')
      .update({
        status:           'on_break',
        is_on_break:      true,
        break_started_at: now,
        break_ended_at:   null,
        updated_at:       now,
      })
      .eq('work_date', date)
      .eq('user_email', user.email!)
      .select()
      .single()

    if (error) throw error

    await adminClient.from('work_status_events').insert({
      work_date:       date,
      user_email:      user.email!,
      user_profile_id: profile?.id ?? null,
      work_log_id:     existing.work_log_id ?? null,
      event_type:      'break_start',
      event_value:     {},
      event_at:        now,
      created_by:      user.email!,
    })

    return NextResponse.json(daily)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
