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
  const payloads = events.map((ev: ParsedEvent) => ({
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

  // 3) upsert (UNIQUE: org_calendar_id, google_event_id)
  if (payloads.length > 0) {
    const { error: upsertErr } = await adminClient
      .from('org_calendar_events')
      .upsert(payloads, { onConflict: 'org_calendar_id,google_event_id' })
    if (upsertErr) throw new Error(`upsert failed: ${upsertErr.message}`)
  }

  // 4) Google에서 삭제된 이벤트 정리 — 이번 fetch에 없는 row 삭제
  const fetchedIds = events.map(e => e.googleEventId)
  // 빈 array면 모든 row 삭제 — 캘린더 자체가 비었거나 fetch 안 됐을 케이스. 후자 보호 위해
  // events.length === 0이면 삭제 skip (보수적). 정말 비었으면 다음번 sync에서 정리됨.
  if (fetchedIds.length > 0) {
    await adminClient
      .from('org_calendar_events')
      .delete()
      .eq('org_calendar_id', cal.id)
      .not('google_event_id', 'in', `(${fetchedIds.map(id => `"${id.replace(/"/g, '""')}"`).join(',')})`)
  }

  return payloads.length
}
