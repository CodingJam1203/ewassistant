/**
 * /api/admin/calendars
 *   GET: 등록된 캘린더 목록 + 각 캘린더의 마지막 sync 시각·이벤트 수 통계
 *
 * 권한: admin only
 */
import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-check'
import { createAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const client = createAdminClient()

  // 캘린더 목록 + division/team 이름 join
  const { data: calendars, error: calErr } = await client
    .from('org_calendars')
    .select(`
      id, google_calendar_id, calendar_type, label, is_active,
      created_at, updated_at,
      division:org_divisions(id, name, sort_order),
      team:org_teams(id, name, sort_order)
    `)
    .order('created_at', { ascending: true })

  if (calErr) {
    return NextResponse.json({ error: calErr.message }, { status: 500 })
  }

  // 각 캘린더의 이벤트 수 + 마지막 sync 시각
  const calendarIds = (calendars ?? []).map(c => c.id)
  let statsByCal = new Map<string, { eventCount: number; lastSyncedAt: string | null }>()
  if (calendarIds.length > 0) {
    const { data: stats } = await client
      .from('org_calendar_events')
      .select('org_calendar_id, synced_at')
      .in('org_calendar_id', calendarIds)
    if (Array.isArray(stats)) {
      statsByCal = stats.reduce((acc, row) => {
        const id = row.org_calendar_id as string
        const cur = acc.get(id) ?? { eventCount: 0, lastSyncedAt: null }
        cur.eventCount++
        const ts = row.synced_at as string
        if (!cur.lastSyncedAt || ts > cur.lastSyncedAt) cur.lastSyncedAt = ts
        acc.set(id, cur)
        return acc
      }, new Map<string, { eventCount: number; lastSyncedAt: string | null }>())
    }
  }

  const rows = (calendars ?? []).map(c => {
    const stat = statsByCal.get(c.id) ?? { eventCount: 0, lastSyncedAt: null }
    return {
      id: c.id,
      googleCalendarId: c.google_calendar_id,
      calendarType: c.calendar_type,
      label: c.label,
      isActive: c.is_active,
      createdAt: c.created_at,
      updatedAt: c.updated_at,
      division: c.division,
      team: c.team,
      eventCount: stat.eventCount,
      lastSyncedAt: stat.lastSyncedAt,
    }
  })

  return NextResponse.json({ rows })
}
