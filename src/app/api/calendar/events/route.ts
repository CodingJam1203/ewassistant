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
import { parseCell } from '@/lib/leave-calendar'
import { getUserCalendarMode, modeBlocksEventWrite } from '@/lib/org-calendar/calendar-mode'
import { normalizeName } from '@/lib/org-calendar/name-match'
import type { SupabaseClient } from '@supabase/supabase-js'

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
      rrule, recurring_event_id, google_event_id,
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
    google_event_id: string | null
    org_calendar: OrgCalendarShape | OrgCalendarShape[] | null
  }

  // v1.75 — 같은 Google 이벤트가 여러 org_calendars row 에 sync 되어 N row 가 된 케이스 dedupe.
  // 매트릭스 뷰 정책상 본부 일정(teamId NULL) 이 본부 행에 노출되므로 본부 row 우선 채택,
  // 그 외엔 최초 등장 row 채택. matched_user_emails 는 전체 row 합집합으로 보존 — 어느
  // 캘린더 row 에서 매칭됐든 사용자 매칭 정보가 잃어버려지지 않도록.
  // key = google_event_id + start_at (recurring occurrence 도 startMs 다르면 다른 일정).
  const allRows = (data ?? []) as unknown as RowShape[]
  const dedupeMap = new Map<string, { row: RowShape; mergedEmails: Set<string>; isHqOwned: boolean }>()
  for (const r of allRows) {
    const eid = r.google_event_id
    if (!eid) {
      // google_event_id 없으면 dedupe 대상에서 제외 (legacy/시트 case 안전망) — 그대로 push.
      const onceKey = `__no-eid__/${r.id}`
      dedupeMap.set(onceKey, { row: r, mergedEmails: new Set(r.matched_user_emails ?? []), isHqOwned: false })
      continue
    }
    const cal: OrgCalendarShape | null = Array.isArray(r.org_calendar)
      ? (r.org_calendar[0] ?? null)
      : r.org_calendar
    const isHq = cal?.team_id == null
    const key = `${eid}|${r.start_at}`
    const existing = dedupeMap.get(key)
    if (!existing) {
      dedupeMap.set(key, {
        row: r,
        mergedEmails: new Set(r.matched_user_emails ?? []),
        isHqOwned: isHq,
      })
    } else {
      // matched_user_emails 합집합으로 누적
      for (const em of r.matched_user_emails ?? []) existing.mergedEmails.add(em)
      // 본부(teamId NULL) row 가 들어오면 우선 채택으로 swap
      if (isHq && !existing.isHqOwned) {
        existing.row = r
        existing.isHqOwned = true
      }
    }
  }
  const rows = Array.from(dedupeMap.values()).map(d => {
    // matched_user_emails 합집합 적용
    return { ...d.row, matched_user_emails: Array.from(d.mergedEmails) }
  })

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

  // Phase A — 시트 events 합산 (sheet_source_id 매핑된 팀 + 본부 직속 fallback)
  let sheetEvents: typeof events = []
  try {
    sheetEvents = await fetchSheetEvents({
      adminClient: admin,
      from,
      to,
      divisionFilterIds: divisionFilter
        ? divisionFilter.split(',').map(s => s.trim()).filter(Boolean)
        : null,
    })
  } catch (err) {
    console.warn('[calendar/events] sheet merge failed:', err)
  }

  // Phase B — 사용자 본인 mode 반환. 클라이언트는 이걸로 일정 등록 버튼/모달 readOnly 분기.
  let userMode: 'gcal_only' | 'gcal_plus_sheet' | 'sheet_only' | 'none' = 'none'
  try {
    userMode = await getUserCalendarMode(admin, user.email ?? '')
  } catch (err) {
    console.warn('[calendar/events] mode lookup failed:', err)
  }

  return NextResponse.json({
    events: [...events, ...sheetEvents],
    userEmail: user.email,
    userMode,
  })
}

// ─── Phase A — 시트 events 합산 ─────────────────────────────────────────────

interface SheetSourceJoinRow {
  id: string
  label: string
  is_active: boolean
  division: { id: string; name: string }
}

interface SheetTeamJoinRow {
  name: string
  sheet_source_id: string
  org_divisions: { id: string; name: string }
}

interface SheetUserProfileRow {
  email: string
  display_name: string | null
  division: string | null
  team: string | null
}

interface SheetCacheRow {
  key: string
  data: { departments?: Record<string, Array<{ name?: string; cellValue?: string }>> }
}

interface SheetEventLike {
  id: string
  title: string
  description: string | null
  location: string | null
  startAt: string
  endAt: string
  isAllDay: boolean
  matchedUserEmails: string[]
  inferredType: 'meeting' | 'vacation' | 'birthday' | 'other'
  rrule: string | null
  recurringEventId: string | null
  calendarId: string
  calendarLabel: string
  calendarType: 'meeting' | 'vacation' | 'birthday' | 'other'
  divisionId: string
  divisionName: string
  teamId: string | null
  teamName: string | null
}

async function fetchSheetEvents(args: {
  adminClient: SupabaseClient
  from: string
  to: string
  divisionFilterIds: string[] | null
}): Promise<SheetEventLike[]> {
  const { adminClient, from, to, divisionFilterIds } = args

  // 1) 활성 source 조회 (division 정보 포함). divisionFilter 있으면 그 본부만.
  let sourceQuery = adminClient
    .from('org_sheet_sources')
    .select('id, label, is_active, division:org_divisions!inner(id, name)')
    .eq('is_active', true)
  if (divisionFilterIds && divisionFilterIds.length > 0) {
    sourceQuery = sourceQuery.in('division_id', divisionFilterIds)
  }
  const { data: sourceRows, error: srcErr } = await sourceQuery
  if (srcErr || !sourceRows || sourceRows.length === 0) return []

  // sourceById — id → { label, divisionId, divisionName }
  const sourceById = new Map<string, { label: string; divisionId: string; divisionName: string }>()
  for (const s of sourceRows as unknown as SheetSourceJoinRow[]) {
    const div = s.division
    if (!div?.id || !s.id) continue
    sourceById.set(s.id, { label: s.label ?? '', divisionId: div.id, divisionName: div.name ?? '' })
  }
  if (sourceById.size === 0) return []

  // 2) 팀 매핑 (sheet_source_id 매핑된 팀만 + 모든 팀의 id 정보)
  // teamKey "본부명::팀명" → sheet_source_id (매핑된 팀만)
  // teamKeyToTeamId "본부명::팀명" → team_id (모든 팀 — Phase B.5 매트릭스 뷰에서 시트 events의 teamId 채움용)
  const { data: allTeamRows, error: teamsErr } = await adminClient
    .from('org_teams')
    .select('id, name, sheet_source_id, org_divisions!inner(id, name)')
  if (teamsErr) return []

  const teamKeyToSourceId = new Map<string, string>()
  const teamKeyToTeamId = new Map<string, string>()
  for (const t of (allTeamRows ?? []) as unknown as Array<SheetTeamJoinRow & { id: string }>) {
    const divName = t.org_divisions?.name
    if (!divName || !t.name) continue
    teamKeyToTeamId.set(`${divName}::${t.name}`, t.id)
    if (t.sheet_source_id && sourceById.has(t.sheet_source_id)) {
      teamKeyToSourceId.set(`${divName}::${t.name}`, t.sheet_source_id)
    }
  }

  // 본부 직속 fallback — 본부명 → 첫 active source id
  const divisionToSourceId = new Map<string, string>()
  for (const [sid, info] of sourceById) {
    if (!divisionToSourceId.has(info.divisionName)) {
      divisionToSourceId.set(info.divisionName, sid)
    }
  }

  // 3) 사용자 매핑 — divisionFilter 본부의 user_profiles 전부 fetch
  const targetDivisionNames = new Set<string>()
  for (const info of sourceById.values()) targetDivisionNames.add(info.divisionName)

  let userQuery = adminClient
    .from('user_profiles')
    .select('id, email, display_name, division, team')
    .eq('is_active', true)
    .in('division', Array.from(targetDivisionNames))
  const { data: userRows, error: usersErr } = await userQuery
  if (usersErr || !userRows) return []

  // source × normalizedName → matched users 인덱스 (entry 매칭용 O(1))
  // Phase B.6 — display_name 정규화(normalizeName) 후 키 사용. 본부 내 N≥2면 동명이인 보류.
  interface MatchedUser { email: string; teamId: string | null; userId: string }
  const sourceNameToUsers = new Map<string, MatchedUser[]>()
  // userIdToInfo: override 적용 시 그 user의 email/teamId 조회용
  const userIdToInfo = new Map<string, { email: string; teamId: string | null }>()
  for (const u of userRows as Array<SheetUserProfileRow & { id?: string }>) {
    if (!u.division || !u.display_name || !u.id) continue
    let sourceId: string | undefined
    let teamId: string | null = null
    if (u.team) {
      sourceId = teamKeyToSourceId.get(`${u.division}::${u.team}`)
      teamId = teamKeyToTeamId.get(`${u.division}::${u.team}`) ?? null
    } else {
      sourceId = divisionToSourceId.get(u.division)
    }
    if (!sourceId) continue
    const normName = normalizeName(u.display_name)
    if (!normName) continue
    userIdToInfo.set(u.id, { email: u.email.toLowerCase(), teamId })
    const key = `${sourceId}::${normName}`
    const arr = sourceNameToUsers.get(key)
    if (arr) arr.push({ email: u.email.toLowerCase(), teamId, userId: u.id })
    else sourceNameToUsers.set(key, [{ email: u.email.toLowerCase(), teamId, userId: u.id }])
  }
  if (sourceNameToUsers.size === 0 && userIdToInfo.size === 0) return []

  // Phase B.6 — sheet_name_overrides 조회 (운영자 명시 매핑). source 전체 fetch 후 메모리 인덱스.
  // key: `${sourceId}::${normalizedSheetName}` → user_id (override 우선 적용)
  const { data: overrideRows } = await adminClient
    .from('sheet_name_overrides')
    .select('sheet_source_id, sheet_name, user_id')
  const overrideIndex = new Map<string, string>()
  for (const r of (overrideRows ?? []) as Array<{ sheet_source_id: string; sheet_name: string; user_id: string }>) {
    const normName = normalizeName(r.sheet_name)
    if (!normName) continue
    overrideIndex.set(`${r.sheet_source_id}::${normName}`, r.user_id)
  }

  // 4) leave_calendar_cache 신규 형식 row fetch (from~to 범위)
  const { data: cacheRows, error: cacheErr } = await adminClient
    .from('leave_calendar_cache')
    .select('key, data')
    .like('key', 'calendar:%:%')
  if (cacheErr || !cacheRows) return []

  // 5) row 순회 — date 추출 + range filter + source 매칭 + entry → event 변환
  const out: SheetEventLike[] = []
  for (const r of cacheRows as SheetCacheRow[]) {
    const m = /^calendar:([0-9a-f-]{36}):(\d{4}-\d{2}-\d{2})$/i.exec(r.key)
    if (!m) continue
    const sourceId = m[1]
    const date = m[2]
    if (date < from || date > to) continue
    const sourceInfo = sourceById.get(sourceId)
    if (!sourceInfo) continue

    const departments = r.data?.departments
    if (!departments) continue

    for (const entries of Object.values(departments)) {
      if (!Array.isArray(entries)) continue
      let entryIdx = 0
      for (const entry of entries) {
        const sheetName = (entry.name ?? '').trim()
        if (!sheetName) { entryIdx++; continue }
        const cellValue = entry.cellValue ?? ''
        if (!cellValue) { entryIdx++; continue }

        // Phase B.6 매칭 정책:
        //   1) override 있으면 그 user만 매칭 (본부 무관)
        //   2) override 없고 본부 내 N=1 자동 매칭 → 그 user
        //   3) N=0 또는 N≥2 → 매칭 보류
        // Phase B.6 정책 수정 (사용자 의도) — 시트 events는 매칭된 사용자에게만 노출.
        // 매칭 안 된 시트 entries는 무시 (본부 일정 row에 누적되던 폭주 방지).
        // 본부 일정 row는 GCal 본부 캘린더(team_id NULL)의 매칭 없는 events만 받음.
        const normSheetName = normalizeName(sheetName)
        let emails: string[] = []
        const overrideUserId = overrideIndex.get(`${sourceId}::${normSheetName}`)
        if (overrideUserId) {
          const info = userIdToInfo.get(overrideUserId)
          if (info) emails = [info.email]
        } else {
          const matched = sourceNameToUsers.get(`${sourceId}::${normSheetName}`)
          if (matched && matched.length === 1) {
            emails = [matched[0].email]
          }
        }
        if (emails.length === 0) { entryIdx++; continue }  // 매칭 없으면 시트 entry 무시

        const parsed = parseCell(cellValue)
        const isVacation = !!parsed.leaveType

        // 시각 정보 — parsed.events에 시간이 있으면 그것, 없으면 종일
        const evChunks = parsed.events ?? []
        const hasTime = evChunks.length > 0 && (evChunks[0].startTime || evChunks[0].endTime)
        let startAt: string
        let endAt: string
        let isAllDay: boolean

        if (isVacation || !hasTime) {
          // 종일 — KST 자정 기준
          startAt = new Date(`${date}T00:00:00+09:00`).toISOString()
          endAt   = new Date(`${date}T23:59:59+09:00`).toISOString()
          isAllDay = true
        } else {
          const startTime = evChunks[0].startTime ?? '00:00'
          const endTime = evChunks[0].endTime ?? '23:59'
          startAt = new Date(`${date}T${startTime}:00+09:00`).toISOString()
          endAt   = new Date(`${date}T${endTime}:00+09:00`).toISOString()
          isAllDay = false
        }

        const title = isVacation
          ? (cellValue.trim() || '휴가')
          : (evChunks[0]?.title?.trim() || cellValue.trim())

        out.push({
          id: `sheet:${sourceId}:${date}:${entryIdx}:${sheetName}`,
          title,
          description: cellValue,  // 원본 cellValue 보존 (EventEditModal description 노출용)
          location: null,
          startAt,
          endAt,
          isAllDay,
          matchedUserEmails: emails,
          inferredType: isVacation ? 'vacation' : 'other',
          rrule: null,
          recurringEventId: null,
          calendarId: '',
          calendarLabel: sourceInfo.label,
          calendarType: isVacation ? 'vacation' : 'other',
          divisionId: sourceInfo.divisionId,
          divisionName: sourceInfo.divisionName,
          teamId: null,
          teamName: null,
        })
        entryIdx++
      }
    }
  }

  return out
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

  // Phase B — calendar_mode 가드 (sheet_only/none은 일정 쓰기 차단)
  const mode = await getUserCalendarMode(admin, user.email)
  const guard = modeBlocksEventWrite(mode)
  if (guard.blocked) {
    return NextResponse.json({ error: guard.reason, mode }, { status: 403 })
  }

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
