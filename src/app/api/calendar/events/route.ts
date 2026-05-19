/**
 * GET /api/calendar/events?from=YYYY-MM-DD&to=YYYY-MM-DD&divisionIds=a,b
 *
 * 본부 캘린더 뷰(/calendar)용 read endpoint. org_calendar_events 캐시 read만 — Google
 * 직접 호출 X. 인증된 사용자만 (RLS authenticated SELECT).
 *
 * 응답:
 *   { events: [{ id, calendarId, calendarLabel, calendarType, divisionId,
 *                divisionName, teamId, teamName, title, description, location,
 *                startAt, endAt, isAllDay, matchedUserEmails, inferredType }] }
 */
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const from = (searchParams.get('from') ?? '').trim()
  const to   = (searchParams.get('to')   ?? '').trim()
  const divisionFilter = (searchParams.get('divisionIds') ?? '').trim()

  const isoRe = /^\d{4}-\d{2}-\d{2}$/
  if (!isoRe.test(from) || !isoRe.test(to)) {
    return NextResponse.json({ error: 'from/to are required (YYYY-MM-DD)' }, { status: 400 })
  }
  if (from > to) {
    return NextResponse.json({ error: 'from must be <= to' }, { status: 400 })
  }

  const admin = createAdminClient()

  // 범위에 걸치는 이벤트 — start_at <= to 끝 + end_at >= from 시작
  // ISO date를 KST 자정 기준으로 변환
  const fromIso = new Date(`${from}T00:00:00+09:00`).toISOString()
  const toIso   = new Date(`${to}T23:59:59+09:00`).toISOString()

  let query = admin
    .from('org_calendar_events')
    .select(`
      id, title, description, location,
      start_at, end_at, is_all_day,
      matched_user_emails, inferred_type,
      org_calendar:org_calendars!inner(
        id, label, calendar_type, is_active,
        division_id, team_id,
        division:org_divisions(id, name),
        team:org_teams(id, name)
      )
    `)
    .eq('org_calendar.is_active', true)
    .lte('start_at', toIso)
    .gte('end_at',   fromIso)
    .order('start_at', { ascending: true })

  if (divisionFilter) {
    const ids = divisionFilter.split(',').map(s => s.trim()).filter(Boolean)
    if (ids.length > 0) {
      query = query.in('org_calendar.division_id', ids)
    }
  }

  const { data, error } = await query
  if (error) {
    console.error('[calendar/events] error:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  interface OrgCalendarShape {
    id: string
    label: string
    calendar_type: 'meeting' | 'vacation' | 'birthday' | 'other'
    division_id: string
    team_id: string | null
    division: { id: string; name: string } | null
    team: { id: string; name: string } | null
  }
  interface RowShape {
    id: string
    title: string | null
    description: string | null
    location: string | null
    start_at: string
    end_at: string
    is_all_day: boolean
    matched_user_emails: string[] | null
    inferred_type: string | null
    org_calendar: OrgCalendarShape | OrgCalendarShape[] | null
  }

  const rows = (data ?? []) as unknown as RowShape[]
  const events = rows.map(r => {
    // Supabase nested select은 단건 join이라도 배열로 올 수도 — 둘 다 처리
    const cal: OrgCalendarShape | null = Array.isArray(r.org_calendar)
      ? (r.org_calendar[0] ?? null)
      : r.org_calendar
    return {
      id: r.id,
      title: r.title ?? '',
      description: r.description,
      location: r.location,
      startAt: r.start_at,
      endAt: r.end_at,
      isAllDay: r.is_all_day,
      matchedUserEmails: r.matched_user_emails ?? [],
      inferredType: (r.inferred_type ?? 'other') as 'meeting' | 'vacation' | 'birthday' | 'other',
      calendarId: cal?.id ?? '',
      calendarLabel: cal?.label ?? '',
      calendarType: cal?.calendar_type ?? 'other',
      divisionId: cal?.division_id ?? '',
      divisionName: cal?.division?.name ?? '',
      teamId: cal?.team_id ?? null,
      teamName: cal?.team?.name ?? null,
    }
  })

  return NextResponse.json({ events, userEmail: user.email })
}
