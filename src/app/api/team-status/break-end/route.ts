import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { notifyBreakEnded } from '@/lib/notifications/teams'

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
      .select('id, display_name')
      .eq('email', user.email!)
      .single()

    const { data: existing } = await adminClient
      .from('daily_work_status')
      .select('*')
      .eq('work_date', date)
      .eq('user_email', user.email!)
      .single()

    if (!existing?.is_on_break) {
      return NextResponse.json({ error: '휴게 상태가 아닙니다.' }, { status: 400 })
    }

    const newStatus = (existing.checked_in_at && !existing.checked_out_at) ? 'working' : 'reported'

    const { data: daily, error } = await adminClient
      .from('daily_work_status')
      .update({
        status:         newStatus,
        is_on_break:    false,
        break_ended_at: now,
        updated_at:     now,
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
      event_type:      'break_end',
      event_value:     {},
      event_at:        now,
      created_by:      user.email!,
    })

    // ─── Teams 휴게 종료 알림 ────────────────────────────────────────────────
    notifyBreakEnded({
      name: profile?.display_name || user.email!,
      date,
      breakAt: now,
      workLocation: existing.current_location ?? '',
    })

    return NextResponse.json(daily)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
