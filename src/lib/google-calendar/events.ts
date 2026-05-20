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
  return body
}

/** 우리 sync.ts와 동일 형식으로 google_event_id 구성 — idempotent 보장 */
function composeGoogleEventId(iCalUID: string, startAt: Date): string {
  return `${iCalUID}::${startAt.getTime()}`
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
    googleEventId: composeGoogleEventId(iCalUID, payload.startAt),
    rawId,
    iCalUID,
  }
}

export async function pushEventUpdate(
  calendarRawId: string,
  rawEventId: string,
  payload: PushPayload,
): Promise<PushResult> {
  const cal = getGoogleCalendarClient()
  const res = await cal.events.update({
    calendarId: calendarRawId,
    eventId: rawEventId,
    requestBody: buildEventBody(payload),
  })
  const rawId   = res.data.id ?? rawEventId
  const iCalUID = res.data.iCalUID ?? rawId
  return {
    googleEventId: composeGoogleEventId(iCalUID, payload.startAt),
    rawId,
    iCalUID,
  }
}

export async function pushEventDelete(
  calendarRawId: string,
  rawEventId: string,
): Promise<void> {
  const cal = getGoogleCalendarClient()
  try {
    await cal.events.delete({ calendarId: calendarRawId, eventId: rawEventId })
  } catch (err: unknown) {
    // 410 Gone / 404 Not Found — 이미 Google에서 삭제됨. 무시.
    const code = (err as { code?: number; status?: number })?.code
                ?? (err as { code?: number; status?: number })?.status
    if (code === 404 || code === 410) return
    throw err
  }
}

/**
 * google_event_id 형식("uid::ms")에서 plain rawEventId 회수.
 * push insert 응답에서 rawId를 DB에 별도 저장하지 않으면 update/delete 시 필요.
 * 우리는 row.google_event_id의 "::" 앞부분 = iCalUID = Google rawId(대부분 동일)로 가정.
 *
 * 단 Google이 iCalUID와 plain id가 다른 케이스(recurrence 등)도 있어 update/delete 시점에는
 * row에 별도 컬럼 두는 게 더 안전하나 — 4.2 MVP는 단일 이벤트만이라 iCalUID==id 가정으로 진행.
 */
export function extractRawEventIdFromGoogleEventId(googleEventId: string): string {
  const idx = googleEventId.indexOf('::')
  return idx > 0 ? googleEventId.slice(0, idx) : googleEventId
}
