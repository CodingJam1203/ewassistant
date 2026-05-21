/**
 * Google Calendar events API wrapper — N-Click → Google push.
 *
 * 핵심 정책:
 *   - 종일 이벤트(isAllDay=true): start.date/end.date 형식 (YYYY-MM-DD). end.date는 exclusive(다음 날).
 *   - 시각 이벤트: start.dateTime/end.dateTime + timeZone='Asia/Seoul'.
 *   - rrule: 'FREQ=...' 본문. body.recurrence = ['RRULE:...'] 형태로 변환.
 *   - delete: 410/404는 무시 (이미 사라진 이벤트).
 *
 * google_event_id 형식:
 *   - 우리 sync.ts는 iCal feed UID + start.getTime() 으로 만듦 ("uid::ms").
 *   - push insert 응답의 iCalUID + startMs로 동일 형식 만들어 idempotent 보장.
 */

import { getGoogleCalendarClient } from './client'
import type { calendar_v3 } from 'googleapis'

export interface PushPayload {
  title: string
  description: string | null
  location: string | null
  startAt: Date            // 시각 이벤트는 absolute time. 종일은 KST 자정 기준 Date 객체.
  endAt: Date              // 시각: absolute. 종일: exclusive 다음날 KST 자정.
  isAllDay: boolean
  rrule: string | null     // 'FREQ=WEEKLY;BYDAY=MO' 등 RRULE 본문 (null이면 단일 이벤트)
  /** N-Click 등록 시 사용자가 고른 속성. extendedProperties로 박제 → sync가 제목 추측 없이 신뢰. */
  nclickType?: 'meeting' | 'vacation' | 'birthday' | 'other'
}

export interface PushResult {
  googleEventId: string    // 우리 DB에 저장할 키. "iCalUID::startMs" 형식.
  rawId: string            // Google이 반환한 plain event id (API 호출용).
  iCalUID: string
}

function toKstDateString(d: Date): string {
  // YYYY-MM-DD in KST
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  })
  return f.format(d)
}

function buildEventBody(p: PushPayload): calendar_v3.Schema$Event {
  const body: calendar_v3.Schema$Event = {
    summary: p.title,
  }
  if (p.description) body.description = p.description
  if (p.location)    body.location    = p.location

  if (p.isAllDay) {
    body.start = { date: toKstDateString(p.startAt) }
    body.end   = { date: toKstDateString(p.endAt) }  // exclusive
  } else {
    body.start = { dateTime: p.startAt.toISOString(), timeZone: 'Asia/Seoul' }
    body.end   = { dateTime: p.endAt.toISOString(),   timeZone: 'Asia/Seoul' }
  }

  if (p.rrule) {
    const trimmed = p.rrule.replace(/^RRULE:/i, '').trim()
    if (trimmed) body.recurrence = [`RRULE:${trimmed}`]
  }
  // N-Click 속성 박제 — sync 시 inferEventType이 최우선 신뢰 (제목 추측 불필요)
  if (p.nclickType) {
    body.extendedProperties = { private: { nclickType: p.nclickType } }
  }
  return body
}

/**
 * Phase 4.7 이후: google_event_id는 Google API의 plain event id 그대로 사용 (sync도 동일).
 * 이전 "iCalUID::startMs" 형식은 events.update/delete API에 직접 못 써서 resolvePlainEventId
 * fallback이 필요했음. 이제 plain id라 직접 hit — fallback은 안전망으로만 유지.
 */
function composeGoogleEventId(rawId: string): string {
  return rawId
}

export async function pushEventInsert(
  calendarRawId: string,
  payload: PushPayload,
): Promise<PushResult> {
  const cal = getGoogleCalendarClient()
  const res = await cal.events.insert({
    calendarId: calendarRawId,
    requestBody: buildEventBody(payload),
  })
  const rawId   = res.data.id
  const iCalUID = res.data.iCalUID ?? res.data.id
  if (!rawId || !iCalUID) {
    throw new Error('Google events.insert returned no id/iCalUID')
  }
  return {
    googleEventId: composeGoogleEventId(rawId),
    rawId,
    iCalUID,
  }
}

/**
 * Google API의 `events.update` / `events.delete`는 plain event `id`를 요구.
 * 우리 DB의 google_event_id는 "iCalUID::startMs" 형식이라 prefix(iCalUID)를 직접 넘기면 404.
 * 이 helper로 events.list(iCalUID 필터)로 plain id를 lookup. Google source 이벤트도
 * iCal UID로 식별되어 매칭 가능.
 */
async function resolvePlainEventId(
  cal: ReturnType<typeof getGoogleCalendarClient>,
  calendarRawId: string,
  iCalUIDOrId: string,
): Promise<string | null> {
  // 1) 그대로 events.get 시도 — plain id면 hit
  try {
    const r = await cal.events.get({ calendarId: calendarRawId, eventId: iCalUIDOrId })
    if (r.data.id) return r.data.id
  } catch (err: unknown) {
    const code = (err as { code?: number; status?: number })?.code
                ?? (err as { code?: number; status?: number })?.status
    if (code !== 404) throw err
  }
  // 2) iCalUID 필터로 events.list
  const list = await cal.events.list({
    calendarId: calendarRawId,
    iCalUID: iCalUIDOrId,
    maxResults: 1,
    showDeleted: false,
  })
  return list.data.items?.[0]?.id ?? null
}

function getErrCode(err: unknown): number | null {
  const e = err as { code?: number; status?: number }
  return e?.code ?? e?.status ?? null
}

export async function pushEventUpdate(
  calendarRawId: string,
  rawEventIdOrICalUID: string,
  payload: PushPayload,
): Promise<PushResult> {
  const cal = getGoogleCalendarClient()
  const buildBody = () => buildEventBody(payload)

  // 1차: 그대로 update 시도 (rawEventId면 hit)
  try {
    const res = await cal.events.update({
      calendarId: calendarRawId,
      eventId: rawEventIdOrICalUID,
      requestBody: buildBody(),
    })
    const rawId   = res.data.id ?? rawEventIdOrICalUID
    const iCalUID = res.data.iCalUID ?? rawId
    return {
      googleEventId: composeGoogleEventId(rawId),
      rawId,
      iCalUID,
    }
  } catch (err: unknown) {
    if (getErrCode(err) !== 404) throw err
  }

  // 2차: iCalUID로 plain id lookup 후 update
  const realId = await resolvePlainEventId(cal, calendarRawId, rawEventIdOrICalUID)
  if (!realId) {
    throw new Error(`Google 이벤트를 찾을 수 없음 (iCalUID lookup 실패): ${rawEventIdOrICalUID}`)
  }
  const res = await cal.events.update({
    calendarId: calendarRawId,
    eventId: realId,
    requestBody: buildBody(),
  })
  const rawId   = res.data.id ?? realId
  const iCalUID = res.data.iCalUID ?? rawId
  return {
    googleEventId: composeGoogleEventId(rawId),
    rawId,
    iCalUID,
  }
}

/** Phase 4.8 — '이 일정' 수정: events.patch(instanceId)로 그 instance만 override */
export async function pushInstanceOverride(
  calendarRawId: string,
  instanceId: string,
  payload: PushPayload,
): Promise<void> {
  const cal = getGoogleCalendarClient()
  await cal.events.patch({
    calendarId: calendarRawId,
    eventId: instanceId,
    requestBody: buildEventBody(payload),
  })
}

/** Phase 4.8 — '이 일정' 삭제: events.delete(instanceId)로 그 occurrence만 cancel */
export async function pushInstanceDelete(
  calendarRawId: string,
  instanceId: string,
): Promise<void> {
  const cal = getGoogleCalendarClient()
  try {
    await cal.events.delete({ calendarId: calendarRawId, eventId: instanceId })
  } catch (err: unknown) {
    const code = getErrCode(err)
    if (code === 404 || code === 410) return
    throw err
  }
}

/** 그 instance start time -1초의 UTC Zulu 형식 (RRULE UNTIL 표준) */
function computeUntilZulu(beforeInstanceStart: Date): string {
  const before = new Date(beforeInstanceStart.getTime() - 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${before.getUTCFullYear()}${pad(before.getUTCMonth()+1)}${pad(before.getUTCDate())}T${pad(before.getUTCHours())}${pad(before.getUTCMinutes())}${pad(before.getUTCSeconds())}Z`
}

/** 기존 master의 recurrence(RRULE 배열)에 UNTIL 적용 — UNTIL/COUNT는 제거 후 새로 추가 */
function applyUntilToRecurrence(oldRecurrence: string[], untilStr: string): string[] {
  return oldRecurrence.map(line => {
    if (!line.startsWith('RRULE:')) return line
    const body = line.replace(/^RRULE:/, '')
    const cleaned = body
      .split(';')
      .filter(p => p && !p.toUpperCase().startsWith('UNTIL=') && !p.toUpperCase().startsWith('COUNT='))
      .join(';')
    return `RRULE:${cleaned};UNTIL=${untilStr}`
  })
}

/**
 * Phase 4.8 — '이 일정 및 향후 일정' 삭제:
 * 기존 master RRULE에 UNTIL=<instanceStart-1s> 적용. 새 master 생성 안 함.
 * 그 instance부터 끝까지 시리즈 모두 사라짐.
 */
export async function truncateMasterFollowing(
  calendarRawId: string,
  masterId: string,
  instanceStart: Date,
): Promise<{ oldMasterICalUID: string }> {
  const cal = getGoogleCalendarClient()
  const masterGet = await cal.events.get({ calendarId: calendarRawId, eventId: masterId })
  const oldICalUID = masterGet.data.iCalUID ?? masterId
  const oldRecurrence = masterGet.data.recurrence ?? []
  const untilStr = computeUntilZulu(instanceStart)
  const newRecurrence = applyUntilToRecurrence(oldRecurrence, untilStr)
  await cal.events.patch({
    calendarId: calendarRawId,
    eventId: masterId,
    requestBody: { recurrence: newRecurrence },
  })
  return { oldMasterICalUID: oldICalUID }
}

/**
 * Phase 4.8 — '이 일정 및 향후 일정' 수정:
 * 1) 기존 master RRULE에 UNTIL=<instanceStart-1s> 적용
 * 2) 새 master event 생성 — 변경된 내용 + 새 시작점 + RRULE (newPayload에 포함)
 * 시리즈 2개로 split (Google Calendar 표준 동작).
 */
export async function splitMasterFollowing(
  calendarRawId: string,
  masterId: string,
  instanceStart: Date,
  newPayload: PushPayload,
): Promise<{ oldMasterICalUID: string; newMaster: PushResult }> {
  const cal = getGoogleCalendarClient()
  // 1) 기존 master truncate
  const { oldMasterICalUID } = await truncateMasterFollowing(calendarRawId, masterId, instanceStart)
  // 2) 새 master insert
  const insRes = await cal.events.insert({
    calendarId: calendarRawId,
    requestBody: buildEventBody(newPayload),
  })
  const rawId   = insRes.data.id ?? ''
  const iCalUID = insRes.data.iCalUID ?? rawId
  if (!rawId || !iCalUID) throw new Error('split: new master insert returned no id/iCalUID')
  return {
    oldMasterICalUID,
    newMaster: {
      googleEventId: composeGoogleEventId(rawId),
      rawId,
      iCalUID,
    },
  }
}

export async function pushEventDelete(
  calendarRawId: string,
  rawEventIdOrICalUID: string,
): Promise<void> {
  const cal = getGoogleCalendarClient()

  // 1차: 그대로 delete 시도
  try {
    await cal.events.delete({ calendarId: calendarRawId, eventId: rawEventIdOrICalUID })
    return
  } catch (err: unknown) {
    const code = getErrCode(err)
    if (code === 410) return  // 이미 삭제됨
    if (code !== 404) throw err
  }

  // 2차: iCalUID로 plain id lookup 후 delete
  const realId = await resolvePlainEventId(cal, calendarRawId, rawEventIdOrICalUID)
  if (!realId) return  // 이미 사라진 상태
  try {
    await cal.events.delete({ calendarId: calendarRawId, eventId: realId })
  } catch (err: unknown) {
    const code = getErrCode(err)
    if (code === 404 || code === 410) return
    throw err
  }
}

/**
 * google_event_id 형식("uid::ms")에서 plain rawEventId 회수.
 * Phase 4.7 이후 새 google_event_id는 plain id라 이 함수는 사실상 그대로 반환.
 * 안전망으로 옛 형식이 남아있을 때만 prefix 추출.
 */
export function extractRawEventIdFromGoogleEventId(googleEventId: string): string {
  const idx = googleEventId.indexOf('::')
  return idx > 0 ? googleEventId.slice(0, idx) : googleEventId
}

/**
 * Phase 4.7+ — Google API events.list({iCalUID}) 으로 master/single event의 instances 받아
 * org_calendar_events row로 upsert. master row를 만들지 않고 occurrence row(들)만 채움.
 *
 * POST /api/calendar/events 후, PATCH 후 호출.
 * 단일 이벤트면 1 row, 반복이면 timeMin~timeMax 안의 occurrence들 다수.
 *
 * cleanup: 이 master id 관련된 우리 DB의 잔존 row(이전 등록 후 사라진 occurrence 등) 정리.
 */
export interface SyncMasterByIdResult {
  /** upsert된 row들 (events.list 결과 N개) */
  upsertedIds: string[]
  /** cleanup으로 삭제된 row id들 */
  deletedIds: string[]
  /** 이번 작업이 성공적으로 처리한 첫 row (history.create의 event_id로 사용) */
  primaryRow: Record<string, unknown> | null
}

const SYNC_RANGE_PAST_DAYS_PUSH   = 90
const SYNC_RANGE_FUTURE_DAYS_PUSH = 365

export async function syncMasterById(args: {
  adminClient: import('@supabase/supabase-js').SupabaseClient
  rawCalId: string
  calendar: { id: string; division_id: string; team_id: string | null; calendar_type: 'meeting' | 'vacation' | 'birthday' | 'other' }
  iCalUID: string
  rrule: string | null
  userId: string
  /** matched_user_emails 산출용 — 호출자가 미리 loadUserLookup 한 결과 전달 */
  matchUsersForTitle: (title: string, attendeeEmails: string[]) => string[]
  /** inferred_type 결정 helper (fallback — nclickType 없을 때만) */
  inferType: (calendarType: 'meeting' | 'vacation' | 'birthday' | 'other', title: string) => 'meeting' | 'vacation' | 'birthday' | 'other'
  /** N-Click 등록 속성. 있으면 occurrence 전부 이 type으로 신뢰 (제목 추측 X) */
  nclickType?: 'meeting' | 'vacation' | 'birthday' | 'other'
}): Promise<SyncMasterByIdResult> {
  const { adminClient, rawCalId, calendar, iCalUID, rrule, userId, matchUsersForTitle, inferType, nclickType } = args

  const cal = getGoogleCalendarClient()
  const now = Date.now()
  const timeMin = new Date(now - SYNC_RANGE_PAST_DAYS_PUSH  * 86_400_000).toISOString()
  const timeMax = new Date(now + SYNC_RANGE_FUTURE_DAYS_PUSH * 86_400_000).toISOString()

  // iCalUID 필터로 그 master의 모든 occurrence (또는 single 1건) 받기
  const items: import('googleapis').calendar_v3.Schema$Event[] = []
  let pageToken: string | undefined
  do {
    const res = await cal.events.list({
      calendarId: rawCalId,
      iCalUID,
      singleEvents: true,
      timeMin,
      timeMax,
      maxResults: 2500,
      orderBy: 'startTime',
      showDeleted: false,
      pageToken,
    })
    if (res.data.items) items.push(...res.data.items)
    pageToken = res.data.nextPageToken ?? undefined
  } while (pageToken)

  const nowIso = new Date().toISOString()
  const payloads: Record<string, unknown>[] = []
  let masterId: string | null = null

  for (const it of items) {
    if (!it.id) continue
    const start = parseEventTimeForPush(it.start)
    const end   = parseEventTimeForPush(it.end)
    if (!start || !end) continue
    const isAllDay = !!it.start?.date
    const attendeeEmails = (it.attendees ?? [])
      .map(a => (a.email ?? '').toLowerCase().trim())
      .filter(Boolean)
    const title = it.summary ?? ''
    const recurringEventId = it.recurringEventId ?? null
    if (recurringEventId) masterId = recurringEventId

    payloads.push({
      org_calendar_id: calendar.id,
      google_event_id: it.id,
      title: title || null,
      description: it.description ?? null,
      location: it.location ?? null,
      start_at: start.toISOString(),
      end_at: end.toISOString(),
      is_all_day: isAllDay,
      attendee_emails: attendeeEmails.length > 0 ? attendeeEmails : null,
      matched_user_emails: matchUsersForTitle(title, attendeeEmails),
      inferred_type: nclickType ?? inferType(calendar.calendar_type, title),
      raw_uid: it.iCalUID ?? null,
      recurring_event_id: recurringEventId,
      rrule: recurringEventId ? rrule : null,
      synced_at: nowIso,
      source: 'nclick',
      created_by_user_id: userId,
      nclick_pushed_at: nowIso,
    })
  }

  // single 이벤트의 경우 recurringEventId 없음 → masterId 못 정함. 그땐 그 1건의 id가 곧 master.
  if (!masterId && items.length === 1 && items[0].id) {
    masterId = items[0].id
  }

  let upsertedIds: string[] = []
  if (payloads.length > 0) {
    const { data: upserted, error: upErr } = await adminClient
      .from('org_calendar_events')
      .upsert(payloads, { onConflict: 'org_calendar_id,google_event_id' })
      .select('id, google_event_id')
    if (upErr) throw new Error(`upsert failed: ${upErr.message}`)
    upsertedIds = (upserted ?? []).map((r: { id: string }) => r.id)
  }

  // cleanup: 이 master id 관련 row 중 이번 fetched에 없는 잔존 row 삭제.
  // (POST에서는 master row 자체가 잘못 들어가는 케이스, PATCH에서는 RRULE 변경으로 사라진 occurrence)
  let deletedIds: string[] = []
  if (masterId) {
    const fetchedSet = new Set(payloads.map(p => p.google_event_id as string))
    const { data: existing } = await adminClient
      .from('org_calendar_events')
      .select('id, google_event_id')
      .eq('org_calendar_id', calendar.id)
      .or(`google_event_id.eq.${masterId},recurring_event_id.eq.${masterId}`)
      .range(0, 9999)
    const toDelete = (existing ?? [])
      .filter((r: { google_event_id: string }) => !fetchedSet.has(r.google_event_id))
      .map((r: { id: string }) => r.id)
    if (toDelete.length > 0) {
      const { error: delErr } = await adminClient
        .from('org_calendar_events')
        .delete()
        .in('id', toDelete)
      if (delErr) throw new Error(`cleanup delete failed: ${delErr.message}`)
      deletedIds = toDelete
    }
  }

  // history용 primary row — 첫 occurrence 또는 single row 선택
  let primaryRow: Record<string, unknown> | null = null
  if (upsertedIds.length > 0) {
    const { data } = await adminClient
      .from('org_calendar_events')
      .select('*')
      .eq('id', upsertedIds[0])
      .maybeSingle()
    primaryRow = (data as Record<string, unknown> | null) ?? null
  }

  return { upsertedIds, deletedIds, primaryRow }
}

function parseEventTimeForPush(t: import('googleapis').calendar_v3.Schema$EventDateTime | undefined): Date | null {
  if (!t) return null
  if (t.dateTime) {
    const d = new Date(t.dateTime)
    return Number.isNaN(d.getTime()) ? null : d
  }
  if (t.date) {
    const m = t.date.match(/^(\d{4})-(\d{2})-(\d{2})$/)
    if (!m) return null
    const y = +m[1], mo = +m[2] - 1, d = +m[3]
    return new Date(Date.UTC(y, mo, d, -9, 0, 0))
  }
  return null
}
