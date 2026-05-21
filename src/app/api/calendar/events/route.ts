/**
 * /api/calendar/events
 *
 * GET  ?from=YYYY-MM-DD&to=YYYY-MM-DD&divisionIds=a,b
 *      본부 캘린더 뷰(/calendar)용 read endpoint. org_calendar_events 캐시 read만.
 *
 * POST — N-Click에서 일정 등록 → Google API push → DB insert + history (Phase 4.2)
 *        body: { calendarId, title, description?, location?, startAt, endAt, isAllDay, rrule?, inferredType? }
 *        권한: 본인 본부의 캘린더만 (admin은 전체). 다른 본부 시도 403.
 */
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { extractCalendarRawId } from '@/lib/google-calendar/client'
import { pushEventInsert, pushEventDelete, syncMasterById } from '@/lib/google-calendar/events'
import { resolveUserAuthz, canWriteToCalendar } from '@/lib/google-calendar/authz'
import { loadUserLookup, matchUsers, inferEventType } from '@/lib/org-calendar/match-users'

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
      rrule, recurring_event_id,
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
    rrule: string | null
    recurring_event_id: string | null
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
      rrule: r.rrule ?? null,
      recurringEventId: r.recurring_event_id ?? null,
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

interface PostBody {
  calendarId?: string
  title?: string
  description?: string | null
  location?: string | null
  startAt?: string
  endAt?: string
  isAllDay?: boolean
  rrule?: string | null
  inferredType?: 'meeting' | 'vacation' | 'birthday' | 'other'
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const authz = await resolveUserAuthz(admin, user.id, user.email)
  if (!authz) return NextResponse.json({ error: 'Forbidden — profile not found' }, { status: 403 })

  const body: PostBody = await request.json().catch(() => ({}))
  const calendarId  = (body.calendarId ?? '').trim()
  const title       = (body.title ?? '').trim()
  const startIso    = (body.startAt ?? '').trim()
  const endIso      = (body.endAt ?? '').trim()
  const isAllDay    = body.isAllDay === true
  const rrule       = body.rrule?.trim() || null
  const description = body.description ?? null
  const location    = body.location ?? null

  if (!calendarId) return NextResponse.json({ error: 'calendarId required' }, { status: 400 })
  if (!title)      return NextResponse.json({ error: 'title required' },      { status: 400 })
  if (!startIso || !endIso) return NextResponse.json({ error: 'startAt/endAt required' }, { status: 400 })

  const startAt = new Date(startIso)
  const endAt   = new Date(endIso)
  if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) {
    return NextResponse.json({ error: 'invalid startAt/endAt' }, { status: 400 })
  }
  if (startAt >= endAt) {
    return NextResponse.json({ error: 'startAt must be < endAt' }, { status: 400 })
  }

  // 캘린더 조회 + 권한 검증
  const { data: calendar, error: calErr } = await admin
    .from('org_calendars')
    .select('id, division_id, team_id, google_calendar_id, calendar_type, is_active')
    .eq('id', calendarId)
    .maybeSingle()
  if (calErr || !calendar) return NextResponse.json({ error: 'calendar not found' }, { status: 404 })
  if (!calendar.is_active)  return NextResponse.json({ error: 'calendar inactive' }, { status: 400 })
  if (!canWriteToCalendar(authz, calendar.division_id)) {
    return NextResponse.json({ error: 'Forbidden — 본인 본부 캘린더에만 등록 가능' }, { status: 403 })
  }

  const inferredType = body.inferredType ?? calendar.calendar_type

  // Google push
  const rawCalId = extractCalendarRawId(calendar.google_calendar_id)
  let pushed
  try {
    pushed = await pushEventInsert(rawCalId, {
      title, description, location,
      startAt, endAt, isAllDay,
      rrule,
      nclickType: inferredType,  // 사용자가 고른 속성 박제 → sync가 제목 추측 없이 신뢰
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[calendar/events POST] google push failed:', message)
    return NextResponse.json({ error: `Google push 실패: ${message}` }, { status: 502 })
  }

  // Phase 4.7+ — master row 직접 insert 하지 않고, events.list({iCalUID})로 instance(들) 받아 채움.
  // single: 1 row, recurring: occurrence별 N rows. master row 잔존으로 인한 중복 노출 차단.
  const lookup = await loadUserLookup(admin)
  let syncResult
  try {
    syncResult = await syncMasterById({
      adminClient: admin,
      rawCalId,
      calendar: {
        id: calendar.id,
        division_id: calendar.division_id,
        team_id: calendar.team_id,
        calendar_type: inferredType,
      },
      iCalUID: pushed.iCalUID,
      rrule,
      userId: user.id,
      nclickType: inferredType,  // 사용자가 고른 속성 — occurrence 전부 이 type으로 신뢰
      matchUsersForTitle: (t, attendees) => matchUsers(
        { title: t, attendeeEmails: attendees, divisionId: calendar.division_id, teamId: calendar.team_id },
        lookup,
      ),
      inferType: inferEventType,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[calendar/events POST] syncMasterById failed:', message)
    // Google엔 push 됐는데 DB 동기화 실패 — best-effort 보상 삭제
    try {
      await pushEventDelete(rawCalId, pushed.rawId)
    } catch (rollbackErr) {
      console.error('[calendar/events POST] rollback delete failed:', rollbackErr)
    }
    return NextResponse.json({ error: `DB 동기화 실패: ${message}` }, { status: 500 })
  }

  if (!syncResult.primaryRow) {
    return NextResponse.json({ error: '동기화 결과 없음 — events.list가 빈 응답' }, { status: 500 })
  }

  // history 기록 (best-effort)
  await admin.from('org_calendar_event_history').insert({
    event_id: syncResult.primaryRow.id,
    org_calendar_id: calendar.id,
    action: 'create',
    actor_user_id: user.id,
    actor_email: user.email,
    snapshot: syncResult.primaryRow,
  })

  return NextResponse.json({ event: syncResult.primaryRow })
}
