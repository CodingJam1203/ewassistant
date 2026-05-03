import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * PATCH /api/team-status/update-daily-status
 * 체크인/아웃 실제 시각 수정 (EditLogModal에서 호출)
 *
 * body:
 *   date: YYYY-MM-DD
 *   checked_in_at?: string  — HH:mm (빈 문자열이면 null로)
 *   checked_out_at?: string — HH:mm (빈 문자열이면 null로)
 */
export async function PATCH(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json()
    const date: string = body.date
    if (!date) return NextResponse.json({ error: 'date is required' }, { status: 400 })

    const adminClient = createAdminClient()

    /** HH:mm → 해당 날 ISO timestamp 변환 */
    const toISO = (hhmm: string | undefined | null): string | null => {
      if (!hhmm || hhmm.trim() === '') return null
      const [hh, mm] = hhmm.split(':').map(Number)
      const d = new Date(date)
      d.setHours(hh, mm, 0, 0)
      return d.toISOString()
    }

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }

    if ('checked_in_at' in body) {
      updates.checked_in_at = toISO(body.checked_in_at)
    }
    if ('checked_out_at' in body) {
      updates.checked_out_at = toISO(body.checked_out_at)
    }

    // status 재계산
    const inAt  = updates.checked_in_at  as string | null ?? undefined
    const outAt = updates.checked_out_at as string | null ?? undefined

    if (outAt !== undefined) {
      updates.status = outAt ? 'checked_out' : (inAt ? 'working' : 'reported')
    } else if (inAt !== undefined) {
      updates.status = inAt ? 'working' : 'reported'
    }

    const { data, error } = await adminClient
      .from('daily_work_status')
      .update(updates)
      .eq('work_date', date)
      .eq('user_email', user.email!)
      .select()
      .single()

    if (error) throw error

    return NextResponse.json(data)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
