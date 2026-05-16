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

    // 퇴근 시각 결정 — 30분 단위 보장:
    //   1) body.checked_out_at 명시 → 그대로 사용
    //   2) 퇴근보고가 직전에 작성됐으면 (work_logs.actual_end_time) → 그 시각을 KST 기준 ISO로 변환
    //      Stage 0-2: end_time은 "예정 퇴근"이므로 실제 퇴근은 actual_end_time에서 읽는다.
    //      legacy row(actual_end_time 미채움) 호환을 위해 end_time fallback 유지.
    //   3) 둘 다 없으면 현재 시각 (legacy fallback)
    let now: string = body.checked_out_at ?? ''
    if (!now) {
      // 가장 최근 퇴근보고 work_log 조회 (오늘 leave_date)
      const { data: log } = await adminClient
        .from('work_logs')
        .select('actual_end_time, end_time')
        .eq('user_email', user.email!)
        .eq('leave_date', date)
        .eq('is_deleted', false)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      const endHHmm = ((log?.actual_end_time as string | null)
                    ?? (log?.end_time as string | null))?.slice(0, 5)
      if (endHHmm) {
        // "HH:mm" → ISO (KST 기준). 24시 이상(예: "26:00")이면 다음 날로 환산.
        const [hStr, mStr] = endHHmm.split(':')
        const h = parseInt(hStr, 10)
        const m = parseInt(mStr, 10) || 0
        const baseDate = new Date(`${date}T00:00:00+09:00`)
        baseDate.setUTCHours(baseDate.getUTCHours() + h)
        baseDate.setUTCMinutes(baseDate.getUTCMinutes() + m)
        now = baseDate.toISOString()
      } else {
        now = new Date().toISOString()
      }
    }

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

    // Stage 0-2: work_logs.actual_end_time를 daily.checked_out_at과 symmetric하게 갱신.
    // KST HH:mm 추출 — time without time zone 컬럼에 저장.
    const actualEndHHmm = new Date(now).toLocaleTimeString('en-GB', {
      timeZone: 'Asia/Seoul',
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
    })
    let targetWorkLogId: string | null = existing?.work_log_id ?? null
    if (!targetWorkLogId) {
      const { data: latest } = await adminClient
        .from('work_logs')
        .select('id')
        .eq('user_email', user.email!)
        .eq('leave_date', date)
        .eq('is_deleted', false)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      targetWorkLogId = latest?.id ?? null
    }
    if (targetWorkLogId) {
      await adminClient
        .from('work_logs')
        .update({ actual_end_time: actualEndHHmm })
        .eq('id', targetWorkLogId)
    }

    await adminClient.from('work_status_events').insert({
      work_date:       date,
      user_email:      user.email!,
      user_profile_id: profile?.id ?? null,
      work_log_id:     targetWorkLogId,
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
