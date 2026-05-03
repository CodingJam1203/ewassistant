import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * POST /api/team-status/location
 * body: { date: YYYY-MM-DD, location: string }
 */
export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json()
    const date: string     = body.date ?? new Date().toISOString().slice(0, 10)
    const location: string = body.location ?? ''
    if (!location.trim()) {
      return NextResponse.json({ error: '근무지를 입력해주세요.' }, { status: 400 })
    }

    const now = new Date().toISOString()
    const timeStr = new Date().toTimeString().slice(0, 5)
    const adminClient = createAdminClient()

    const { data: profile } = await adminClient
      .from('user_profiles')
      .select('id')
      .eq('email', user.email!)
      .single()

    // daily_work_status 업데이트 (없으면 upsert)
    const { data: daily, error: dailyErr } = await adminClient
      .from('daily_work_status')
      .upsert({
        work_date:        date,
        user_email:       user.email!,
        user_profile_id:  profile?.id ?? null,
        current_location: location,
        updated_at:       now,
      }, { onConflict: 'work_date,user_email' })
      .select()
      .single()

    if (dailyErr) throw dailyErr

    // work_log의 location_history 업데이트
    if (daily?.work_log_id) {
      const { data: wLog } = await adminClient
        .from('work_logs')
        .select('location_history')
        .eq('id', daily.work_log_id)
        .single()

      const history: unknown[] = Array.isArray(wLog?.location_history) ? wLog.location_history : []
      history.push({ time: timeStr, location, source: 'status_change' })

      await adminClient
        .from('work_logs')
        .update({ location_history: history, work_location: location })
        .eq('id', daily.work_log_id)
    }

    // 이벤트 기록
    await adminClient.from('work_status_events').insert({
      work_date:       date,
      user_email:      user.email!,
      user_profile_id: profile?.id ?? null,
      work_log_id:     daily?.work_log_id ?? null,
      event_type:      'location_change',
      event_value:     { location, time: timeStr },
      event_at:        now,
      created_by:      user.email!,
    })

    return NextResponse.json(daily)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
