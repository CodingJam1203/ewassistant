import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getKstTodayDateString } from '@/lib/utils/date'
import { notifyBreakStarted } from '@/lib/notifications/teams'

// 2026-05-19 v1.21: notify await 대응 — sendToMake retry 최악 31.5s + DB 처리 여유.
export const maxDuration = 60

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json()
    const date: string = body.date ?? getKstTodayDateString()
    const now = new Date().toISOString()
    const adminClient = createAdminClient()

    const { data: profile } = await adminClient
      .from('user_profiles')
      .select('id, display_name, division, team')
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

    // Teams 휴게 시작 알림 — 2026-05-19 v1.21: await + maxDuration=60
    await notifyBreakStarted({
      name: profile?.display_name || user.email!,
      date,
      breakAt: now,
      workLocation: existing.current_location ?? '',
      division: profile?.division ?? null,
      team: profile?.team ?? null,
    })

    return NextResponse.json(daily)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
