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
      googleEventId: composeGoogleEventId(iCalUID, payload.startAt),
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
    googleEventId: composeGoogleEventId(iCalUID, payload.startAt),
    rawId,
    iCalUID,
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
