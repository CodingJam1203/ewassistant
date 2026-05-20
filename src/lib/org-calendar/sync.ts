/**
 * Google Calendar API events.list({ singleEvents: true }) 기반 sync (Phase 4.7).
 *
 * 호출처: /api/cron/calendar-sync, /api/admin/calendars/sync, /api/calendar/refresh
 *
 * 정책:
 *   - timeMin: now - 90일, timeMax: now + 365일 (사용자 기본값. 캘린더 뷰 범위 +backfill).
 *   - singleEvents=true: RRULE 반복 이벤트를 occurrence별 instance로 expand해서 받음.
 *     각 occurrence는 별도 row가 됨 → 매트릭스/Agenda에 매 occurrence 노출.
 *   - recurring instance의 master rrule 회수: distinct recurringEventId set → events.get(master).
 *     master 1번 fetch로 그 master의 모든 instance row에 rrule 동일 복사.
 *   - google_event_id = Google API의 plain `id` (occurrence면 `<masterId>_<startUTC>` 형식).
 *     events.update/delete에 직접 사용 가능 (resolvePlainEventId fallback 불요).
 *   - cleanup grace: source='nclick' + nclick_pushed_at 최근 60초 row는 보존.
 *
 * 이전 iCal feed 기반 ical-fetch/ical-parse는 더 이상 사용 안 함 (코드는 남아있되 dead).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { calendar_v3 } from 'googleapis'
import { getGoogleCalendarClient, extractCalendarRawId } from '@/lib/google-calendar/client'
import { loadUserLookup, matchUsers, inferEventType, type UserLookup } from './match-users'

const FETCH_CONCURRENCY = 5
const SYNC_RANGE_PAST_DAYS = 90
const SYNC_RANGE_FUTURE_DAYS = 365

export interface SyncResult {
  totalCalendars: number
  succeeded: number
  failed: number
  totalEvents: number
  failures: Array<{ calendarId: string; error: string }>
}

interface CalendarRow {
  id: string
  division_id: string
  team_id: string | null
  google_calendar_id: string
  calendar_type: 'meeting' | 'vacation' | 'birthday' | 'other'
  label: string
}

export async function syncAllCalendars(
  adminClient: SupabaseClient,
): Promise<SyncResult> {
  const { data: calendars, error } = await adminClient
    .from('org_calendars')
    .select('id, division_id, team_id, google_calendar_id, calendar_type, label')
    .eq('is_active', true)
    .returns<CalendarRow[]>()

  if (error || !calendars) {
    throw new Error(`org_calendars list failed: ${error?.message ?? 'no data'}`)
  }

  const lookup = await loadUserLookup(adminClient)

  const result: SyncResult = {
    totalCalendars: calendars.length,
    succeeded: 0,
    failed: 0,
    totalEvents: 0,
    failures: [],
  }

  for (let i = 0; i < calendars.length; i += FETCH_CONCURRENCY) {
    const batch = calendars.slice(i, i + FETCH_CONCURRENCY)
    const settled = await Promise.allSettled(
      batch.map(cal => syncOne(adminClient, cal, lookup)),
    )
    settled.forEach((s, idx) => {
      const cal = batch[idx]
      if (s.status === 'fulfilled') {
        result.succeeded++
        result.totalEvents += s.value
      } else {
        result.failed++
        result.failures.push({
          calendarId: cal.google_calendar_id,
          error: s.reason instanceof Error ? s.reason.message : String(s.reason),
        })
      }
    })
  }

  return result
}

/**
 * 한 캘린더의 events를 Google API로 fetch → upsert → cleanup.
 * timeMin~timeMax 범위의 모든 occurrence를 받음 (singleEvents=true).
 */
async function syncOne(
  adminClient: SupabaseClient,
  cal: CalendarRow,
  lookup: UserLookup,
): Promise<number> {
  const calClient = getGoogleCalendarClient()
  const rawCalId = extractCalendarRawId(cal.google_calendar_id)

  const now = Date.now()
  const timeMin = new Date(now - SYNC_RANGE_PAST_DAYS  * 86_400_000).toISOString()
  const timeMax = new Date(now + SYNC_RANGE_FUTURE_DAYS * 86_400_000).toISOString()

  // 1) 모든 occurrence fetch (페이지네이션)
  const items: calendar_v3.Schema$Event[] = []
  let pageToken: string | undefined
  do {
    const res = await calClient.events.list({
      calendarId: rawCalId,
      singleEvents: true,
      timeMin,
      timeMax,
      maxResults: 2500,
      orderBy: 'startTime',
      pageToken,
      showDeleted: false,
    })
    if (res.data.items) items.push(...res.data.items)
    pageToken = res.data.nextPageToken ?? undefined
  } while (pageToken)

  // 2) recurring master id set → master events.get 으로 rrule 회수
  const masterIds = new Set<string>()
  for (const it of items) {
    if (it.recurringEventId) masterIds.add(it.recurringEventId)
  }
  const rruleByMaster = new Map<string, string | null>()
  await Promise.all(
    Array.from(masterIds).map(async (mId) => {
      try {
        const r = await calClient.events.get({ calendarId: rawCalId, eventId: mId })
        const rec = r.data.recurrence
        if (Array.isArray(rec) && rec.length > 0) {
          // 보통 ['RRULE:FREQ=...'] 형태 — 첫 RRULE만 사용 (Simple)
          const rruleLine = rec.find(s => s.startsWith('RRULE:'))
          if (rruleLine) {
            rruleByMaster.set(mId, rruleLine.replace(/^RRULE:/, ''))
            return
          }
        }
        rruleByMaster.set(mId, null)
      } catch {
        // master events.get 실패해도 instance row는 만듦. rrule만 null.
        rruleByMaster.set(mId, null)
      }
    }),
  )

  // 3) upsert payload 생성
  const nowIso = new Date().toISOString()
  type Payload = NonNullable<ReturnType<typeof buildPayload>>
  const payloads: Payload[] = []
  for (const it of items) {
    const p = buildPayload(it, cal, lookup, rruleByMaster, nowIso)
    if (p) payloads.push(p)
  }

  // payload dedup 안전망 — 같은 google_event_id가 들어오면 마지막 것 유지
  const dedupMap = new Map<string, typeof payloads[number]>()
  for (const p of payloads) {
    dedupMap.set(p.google_event_id, p)
  }
  const finalPayloads = Array.from(dedupMap.values())

  // 4) upsert
  if (finalPayloads.length > 0) {
    const { error: upsertErr } = await adminClient
      .from('org_calendar_events')
      .upsert(finalPayloads, { onConflict: 'org_calendar_id,google_event_id' })
    if (upsertErr) throw new Error(`upsert failed: ${upsertErr.message}`)
  }

  // 5) cleanup — fetched 외 모든 row 삭제 (nclick 60s grace 제외).
  if (items.length > 0) {
    const fetchedSet = new Set(finalPayloads.map(p => p.google_event_id))
    const graceMs = 60 * 1000
    const graceCutoff = new Date(Date.now() - graceMs).toISOString()
    // PostgREST default range 1000 한계 우회 — 한 캘린더에 1000건 이상이면 default가 잘려
    // cleanup 대상에서 누락됨 (PROD 마이스팀 회의 등 대형 캘린더에서 옛 형식 row 1341건 잔존
    // 사고 발생). 10000건 안전 marg.
    const { data: existing, error: listErr } = await adminClient
      .from('org_calendar_events')
      .select('id, google_event_id, source, nclick_pushed_at')
      .eq('org_calendar_id', cal.id)
      .range(0, 9999)
      .returns<Array<{ id: string; google_event_id: string; source: string | null; nclick_pushed_at: string | null }>>()
    if (listErr) throw new Error(`existing list failed: ${listErr.message}`)
    const toDelete: string[] = []
    for (const row of existing ?? []) {
      if (fetchedSet.has(row.google_event_id)) continue
      if (row.source === 'nclick' && row.nclick_pushed_at && row.nclick_pushed_at > graceCutoff) continue
      toDelete.push(row.id)
    }
    const CHUNK = 200
    for (let i = 0; i < toDelete.length; i += CHUNK) {
      const batch = toDelete.slice(i, i + CHUNK)
      const { error: delErr } = await adminClient
        .from('org_calendar_events')
        .delete()
        .in('id', batch)
      if (delErr) throw new Error(`cleanup delete failed: ${delErr.message}`)
    }
  }
  // items.length === 0이면 캘린더 자체가 비었거나 fetch 실패. 보수적 skip.

  return finalPayloads.length
}

/** Google event item → DB row payload (또는 invalid면 null) */
function buildPayloadValid(
  item: calendar_v3.Schema$Event,
  cal: CalendarRow,
  lookup: UserLookup,
  rruleByMaster: Map<string, string | null>,
  nowIso: string,
) {
  // 시간 파싱
  const start = parseEventTime(item.start)
  const end   = parseEventTime(item.end)
  if (!start || !end) return null
  const isAllDay = !!item.start?.date

  const attendeeEmails = (item.attendees ?? [])
    .map(a => (a.email ?? '').toLowerCase().trim())
    .filter(Boolean)

  const title = item.summary ?? ''
  const recurringEventId = item.recurringEventId ?? null
  const rrule = recurringEventId ? (rruleByMaster.get(recurringEventId) ?? null) : null

  return {
    org_calendar_id: cal.id,
    google_event_id: item.id ?? '',
    title: title || null,
    description: item.description ?? null,
    location: item.location ?? null,
    start_at: start.toISOString(),
    end_at: end.toISOString(),
    is_all_day: isAllDay,
    attendee_emails: attendeeEmails.length > 0 ? attendeeEmails : null,
    matched_user_emails: matchUsers(
      { title, attendeeEmails, divisionId: cal.division_id, teamId: cal.team_id },
      lookup,
    ),
    inferred_type: inferEventType(cal.calendar_type, title),
    raw_uid: item.iCalUID ?? null,
    recurring_event_id: recurringEventId,
    rrule,
    synced_at: nowIso,
    // source는 upsert 시 기존 값 유지 (default 'google'). nclick으로 우리가 만든 row는
    // 이 sync에서 동일 google_event_id로 다시 들어오니 그대로 'google'로 덮어쓰지 않도록
    // 분기 처리는 안 함 — 새 sync 후 source='nclick'은 nclick_pushed_at으로만 식별.
  }
}

function buildPayload(
  item: calendar_v3.Schema$Event,
  cal: CalendarRow,
  lookup: UserLookup,
  rruleByMaster: Map<string, string | null>,
  nowIso: string,
) {
  if (!item.id) return null
  return buildPayloadValid(item, cal, lookup, rruleByMaster, nowIso)
}

/** Google event의 start/end (date 또는 dateTime) → Date 객체 */
function parseEventTime(t: calendar_v3.Schema$EventDateTime | undefined): Date | null {
  if (!t) return null
  if (t.dateTime) {
    const d = new Date(t.dateTime)
    return Number.isNaN(d.getTime()) ? null : d
  }
  if (t.date) {
    // 종일 — YYYY-MM-DD. KST 자정 기준 ISO 변환.
    const m = t.date.match(/^(\d{4})-(\d{2})-(\d{2})$/)
    if (!m) return null
    const y = +m[1], mo = +m[2] - 1, d = +m[3]
    // KST 자정 = UTC 그 전날 15:00
    return new Date(Date.UTC(y, mo, d, -9, 0, 0))
  }
  return null
}
