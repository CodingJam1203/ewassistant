import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { notifyBreakEnded } from '@/lib/notifications/teams'
import { getKstTodayDateString } from '@/lib/utils/date'

// 2026-05-19 v1.21: notify await 대응 — sendToMake retry 최악 31.5s + DB 처리 여유.
export const maxDuration = 60
import {
  calculateBreakAutoMinutesFromIso,
  accumulateBreakAuto,
} from '@/lib/leave-timeline'

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

    // ─── 휴게 자동값 누적 (break_auto_actual_minutes / break_auto_rounded_minutes) ─
    let breakSessionMinutes = 0
    if (existing.break_started_at) {
      breakSessionMinutes = calculateBreakAutoMinutesFromIso(
        existing.break_started_at as string,
        now
      )
    }

    if (existing.work_log_id && breakSessionMinutes > 0) {
      try {
        const { data: wLog } = await adminClient
          .from('work_logs')
          .select('break_auto_actual_minutes')
          .eq('id', existing.work_log_id)
          .single()

        const accumulated = accumulateBreakAuto(
          (wLog?.break_auto_actual_minutes as number | null) ?? 0,
          breakSessionMinutes
        )

        await adminClient
          .from('work_logs')
          .update({
            break_auto_actual_minutes:  accumulated.actual,
            break_auto_rounded_minutes: accumulated.rounded,
          })
          .eq('id', existing.work_log_id)
      } catch (e) {
        // 누적 실패는 알림 흐름을 방해하지 않음
        console.warn('[break-end] auto break accumulation failed:', e)
      }
    }

    await adminClient.from('work_status_events').insert({
      work_date:       date,
      user_email:      user.email!,
      user_profile_id: profile?.id ?? null,
      work_log_id:     existing.work_log_id ?? null,
      event_type:      'break_end',
      event_value:     { session_minutes: breakSessionMinutes },
      event_at:        now,
      created_by:      user.email!,
    })

    // Teams 휴게 종료 알림 — 2026-05-19 v1.21: await + maxDuration=60
    await notifyBreakEnded({
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
