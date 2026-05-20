/**
 * /api/admin/calendars
 *   GET: 등록된 캘린더 목록 + 각 캘린더의 마지막 sync 시각·이벤트 수 통계
 *        + 등록 form 용 divisions/teams 목록 (단일 fetch로 form 채우기)
 *   POST: 신규 캘린더 등록 (단계 B — admin UI 캘린더 CRUD)
 *
 * 권한: admin only
 */
import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-check'
import { createAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const VALID_CALENDAR_TYPES = ['meeting', 'vacation', 'birthday', 'other'] as const
type CalendarType = typeof VALID_CALENDAR_TYPES[number]

export async function GET() {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const client = createAdminClient()

  // 캘린더 목록 + division/team 이름 join + 등록 form 용 divisions/teams 한 번에 fetch
  const [calRes, divRes, teamRes] = await Promise.all([
    client
      .from('org_calendars')
      .select(`
        id, google_calendar_id, calendar_type, label, is_active,
        created_at, updated_at,
        division:org_divisions(id, name, sort_order),
        team:org_teams(id, name, sort_order)
      `)
      .order('created_at', { ascending: true }),
    client
      .from('org_divisions')
      .select('id, name, sort_order')
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true }),
    client
      .from('org_teams')
      .select('id, name, sort_order, division_id')
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true }),
  ])
  const { data: calendars, error: calErr } = calRes
  const { data: divisions } = divRes
  const { data: teams } = teamRes

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

  return NextResponse.json({
    rows,
    divisions: divisions ?? [],
    teams: teams ?? [],
  })
}

/**
 * POST — 신규 캘린더 등록.
 * body: { google_calendar_id, calendar_type, label, division_id, team_id?, is_active? }
 *   - team_id 가 null/undefined 이면 본부 공용 캘린더
 *   - google_calendar_id 는 plain raw id (xxx@group.calendar.google.com) 또는 iCal URL 모두 허용 (sync 시 extractCalendarRawId가 처리)
 */
export async function POST(request: Request) {
  const adminUser = await requireAdmin()
  if (!adminUser) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json().catch(() => ({}))
  const google_calendar_id = typeof body.google_calendar_id === 'string' ? body.google_calendar_id.trim() : ''
  const calendar_type = typeof body.calendar_type === 'string' ? body.calendar_type.trim() : ''
  const label = typeof body.label === 'string' ? body.label.trim() : ''
  const division_id = typeof body.division_id === 'string' ? body.division_id.trim() : ''
  const team_id = typeof body.team_id === 'string' && body.team_id.trim() ? body.team_id.trim() : null
  const is_active = body.is_active === false ? false : true

  if (!google_calendar_id) return NextResponse.json({ error: 'Google Calendar ID를 입력해주세요.' }, { status: 400 })
  if (!label)              return NextResponse.json({ error: '라벨을 입력해주세요.' }, { status: 400 })
  if (!division_id)        return NextResponse.json({ error: '본부를 선택해주세요.' }, { status: 400 })
  if (!VALID_CALENDAR_TYPES.includes(calendar_type as CalendarType)) {
    return NextResponse.json({ error: `유효하지 않은 캘린더 유형입니다 (${VALID_CALENDAR_TYPES.join('/')})` }, { status: 400 })
  }

  const client = createAdminClient()
  const { data, error } = await client
    .from('org_calendars')
    .insert({ google_calendar_id, calendar_type, label, division_id, team_id, is_active })
    .select()
    .single()

  if (error) {
    if (error.code === '23503') return NextResponse.json({ error: '본부 또는 팀이 존재하지 않습니다.' }, { status: 400 })
    if (error.code === '23505') return NextResponse.json({ error: '이미 등록된 캘린더입니다.' }, { status: 409 })
    console.error('[admin/calendars POST] error:', error)
    return NextResponse.json({ error: '캘린더 등록에 실패했습니다.' }, { status: 500 })
  }
  return NextResponse.json(data, { status: 201 })
}
