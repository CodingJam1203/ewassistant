import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { notifyLocationChanged } from '@/lib/notifications/teams'

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

    const now     = new Date().toISOString()
    const timeStr = new Date().toTimeString().slice(0, 5)
    const adminClient = createAdminClient()

    const { data: profile } = await adminClient
      .from('user_profiles')
      .select('id, display_name')
      .eq('email', user.email!)
      .single()

    // 이전 근무지 조회 (알림용)
    const { data: existingStatus } = await adminClient
      .from('daily_work_status')
      .select('current_location')
      .eq('work_date', date)
      .eq('user_email', user.email!)
      .maybeSingle()
    const previousLocation = existingStatus?.current_location ?? ''

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

    // ─── Teams 근무지 변경 알림 ──────────────────────────────────────────────
    notifyLocationChanged({
      name: profile?.display_name || user.email!,
      date,
      previousLocation,
      newLocation: location,
      changedAt: now,
    })

    return NextResponse.json(daily)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
