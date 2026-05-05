import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getKstTodayDateString } from '@/lib/utils/date'

// POST /api/team-status/check-in-cancel
// body: { date: YYYY-MM-DD }
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
      .select('id')
      .eq('email', user.email!)
      .single()

    // daily_work_status 조회
    const { data: existing } = await adminClient
      .from('daily_work_status')
      .select('*')
      .eq('work_date', date)
      .eq('user_email', user.email!)
      .single()

    if (!existing) {
      return NextResponse.json({ error: '출근 기록이 없습니다.' }, { status: 404 })
    }

    // work_log 유무로 status 재계산
    const hasWorkLog = !!existing.work_log_id
    const newStatus  = hasWorkLog ? 'reported' : 'not_reported'

    const { data: daily, error } = await adminClient
      .from('daily_work_status')
      .update({
        status:        newStatus,
        checked_in_at:  null,
        checked_out_at: null,
        is_on_break:    false,
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
      event_type:      'check_in_cancel',
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
