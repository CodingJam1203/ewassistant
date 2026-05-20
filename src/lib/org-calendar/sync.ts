/**
 * org_calendars → iCal fetch → org_calendar_events upsert
 *
 * 호출처: /api/cron/calendar-sync (정기) + /api/admin/calendars/[id]/sync (수동)
 *
 * 정책:
 *   - 1회 호출당 모든 active 캘린더 fetch (병렬 처리, 동시성 5 제한)
 *   - 각 캘린더 fetch 실패 시 다른 캘린더는 계속 진행 (Promise.allSettled)
 *   - 이벤트 upsert 시 (org_calendar_id, google_event_id) UNIQUE 기준
 *   - 한 캘린더 fetch 결과의 google_event_id 외 모든 row를 삭제 — Google에서 삭제된 이벤트 반영
 */

import { fetchCalendarEvents, type ParsedEvent } from './ical-fetch'
import { loadUserLookup, matchUsers, inferEventType } from './match-users'
import type { SupabaseClient } from '@supabase/supabase-js'

const FETCH_CONCURRENCY = 5

export interface SyncResult {
  totalCalendars: number
  succeeded: number
  failed: number
  totalEvents: number
  failures: Array<{ calendarId: string; error: string }>
}

interface CalendarRow {
  id: string
  google_calendar_id: string
  calendar_type: 'meeting' | 'vacation' | 'birthday' | 'other'
  label: string
}

export async function syncAllCalendars(
  adminClient: SupabaseClient,
): Promise<SyncResult> {
  // 1) active 캘린더 list
  const { data: calendars, error } = await adminClient
    .from('org_calendars')
    .select('id, google_calendar_id, calendar_type, label')
    .eq('is_active', true)
    .returns<CalendarRow[]>()

  if (error || !calendars) {
    throw new Error(`org_calendars list failed: ${error?.message ?? 'no data'}`)
  }

  // 2) 사용자 lookup 1회 load
  const lookup = await loadUserLookup(adminClient)

  // 3) 캘린더별 fetch (concurrency 제한)
  const result: SyncResult = {
    totalCalendars: calendars.length,
    succeeded: 0,
    failed: 0,
    totalEvents: 0,
    failures: [],
  }

  // 단순 batch 처리 — 동시 N개
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

async function syncOne(
  adminClient: SupabaseClient,
  cal: CalendarRow,
  lookup: Awaited<ReturnType<typeof loadUserLookup>>,
): Promise<number> {
  // 1) iCal fetch
  const events = await fetchCalendarEvents(cal.google_calendar_id, { timeoutMs: 20_000 })

  // 2) 매핑 + upsert payload 만들기
  const now = new Date().toISOString()
  const rawPayloads = events.map((ev: ParsedEvent) => ({
    org_calendar_id: cal.id,
    google_event_id: ev.googleEventId,
    title: ev.title || null,
    description: ev.description,
    location: ev.location,
    start_at: ev.startAt.toISOString(),
    end_at: ev.endAt.toISOString(),
    is_all_day: ev.isAllDay,
    attendee_emails: ev.attendeeEmails.length > 0 ? ev.attendeeEmails : null,
    matched_user_emails: matchUsers(ev, lookup),
    inferred_type: inferEventType(cal.calendar_type, ev.title || ''),
    raw_uid: ev.rawUid,
    synced_at: now,
  }))

  // payload dedup 안전망 — Postgres upsert는 같은 conflict key를 한 번에 두 번
  // affect 못 함("cannot affect row a second time"). 같은 google_event_id가
  // 들어오면 마지막 것 유지 (Map은 같은 key set 시 덮어씀).
  const dedupMap = new Map<string, typeof rawPayloads[number]>()
  for (const p of rawPayloads) {
    dedupMap.set(p.google_event_id, p)
  }
  const payloads = Array.from(dedupMap.values())

  // 3) upsert (UNIQUE: org_calendar_id, google_event_id)
  if (payloads.length > 0) {
    const { error: upsertErr } = await adminClient
      .from('org_calendar_events')
      .upsert(payloads, { onConflict: 'org_calendar_id,google_event_id' })
    if (upsertErr) throw new Error(`upsert failed: ${upsertErr.message}`)
  }

  // 4) Google에서 삭제된 이벤트 정리 — 이번 fetch에 없는 row 삭제.
  //
  // 이전 방식: `.not('google_event_id', 'in', '(quoted,list)')` — URL 길이/quoting 한계로
  // 캘린더 events 수백 개 이상일 때 silent fail. (실제 PROD에서 647 events 마이스팀 휴가에서
  // Google측 삭제된 이벤트가 정리 안 되던 케이스 확인)
  //
  // 새 방식: 그 캘린더의 (id, google_event_id) 전체를 한 번 select → JS Set으로 fetched와
  // diff → 삭제 대상 row id만 chunk로 `.in('id', [...])` delete. PostgREST id IN 절은
  // chunk size 200으로 URL 길이 안전.
  if (events.length > 0) {
    const fetchedSet = new Set(events.map(e => e.googleEventId))
    const { data: existing, error: listErr } = await adminClient
      .from('org_calendar_events')
      .select('id, google_event_id')
      .eq('org_calendar_id', cal.id)
      .returns<Array<{ id: string; google_event_id: string }>>()
    if (listErr) throw new Error(`existing list failed: ${listErr.message}`)
    const toDelete: string[] = []
    for (const row of existing ?? []) {
      if (!fetchedSet.has(row.google_event_id)) toDelete.push(row.id)
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
  // events.length === 0이면 캘린더 자체가 비었거나 fetch 실패 케이스. 후자 보호 위해 삭제 skip.

  return payloads.length
}
