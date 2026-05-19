/**
 * Google Calendar iCal fetch + 파싱
 *
 * 전제 — 캘린더가 "공개" 설정되어 있거나 비공개 iCal URL을 사용
 *   (공개: ID만으로 fetch / 비공개: token 포함된 URL 사용)
 *
 * URL 패턴:
 *   공개: https://calendar.google.com/calendar/ical/{ID}/public/basic.ics
 *   비공개: https://calendar.google.com/calendar/ical/{ID}/private-{TOKEN}/basic.ics
 *
 * 429 방지 — 호출처(cron)에서 캘린더당 적정 빈도(30분~1시간)로만 호출.
 * 사용자 요청은 DB cache(org_calendar_events) read만 — Google에 직접 호출 X.
 *
 * 2026-05-19 v1: node-ical 패키지가 Turbopack/Vercel runtime에서 BigInt 의존성
 * 으로 깨짐(s.BigInt is not a function). 직접 iCal 파서(ical-parse.ts) 사용.
 */

import { parseICal } from './ical-parse'

export interface ParsedEvent {
  googleEventId: string
  title: string
  description: string | null
  location: string | null
  startAt: Date
  endAt: Date
  isAllDay: boolean
  attendeeEmails: string[]
  rawUid: string
}

/**
 * 캘린더 fetch URL 결정.
 *   - `https://...`로 시작하면 그대로 사용 (비공개 iCal URL — token 포함)
 *   - 그 외엔 calendar ID로 간주해서 public iCal URL 생성 (공개 캘린더 전용)
 *
 * 사용자가 admin UI에서 둘 중 어느 형태로 등록해도 동작하도록 통일.
 */
export function calendarFetchUrl(idOrUrl: string): string {
  const trimmed = idOrUrl.trim()
  if (trimmed.startsWith('https://') || trimmed.startsWith('http://')) {
    return trimmed
  }
  return `https://calendar.google.com/calendar/ical/${encodeURIComponent(trimmed)}/public/basic.ics`
}

/** @deprecated v1 호환 — calendarFetchUrl 사용 */
export function publicICalUrl(googleCalendarId: string): string {
  return calendarFetchUrl(googleCalendarId)
}

/**
 * iCal feed fetch + 파싱.
 *
 * - timeoutMs default 15s — Google이 가끔 느림
 * - 4xx/5xx + timeout 모두 throw — 호출처에서 retry/log 처리
 */
export async function fetchCalendarEvents(
  googleCalendarId: string,
  opts?: { timeoutMs?: number },
): Promise<ParsedEvent[]> {
  const url = calendarFetchUrl(googleCalendarId)
  const timeoutMs = opts?.timeoutMs ?? 15_000

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(url, {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal,
    })
    if (!res.ok) {
      throw new Error(`iCal HTTP ${res.status}: ${await res.text().catch(() => '')}`)
    }
    const text = await res.text()
    const parsed = parseICal(text)

    // 반복 이벤트(recurring)는 같은 UID로 여러 VEVENT가 expand되어 들어옴.
    // upsert가 같은 row를 두 번 affect 못 하므로 (uid + 시작시각)으로 unique key 생성.
    return parsed.map((ev): ParsedEvent => ({
      googleEventId: `${ev.uid}::${ev.start.getTime()}`,
      title: ev.summary,
      description: ev.description,
      location: ev.location,
      startAt: ev.start,
      endAt: ev.end,
      isAllDay: ev.isAllDay,
      attendeeEmails: ev.attendees,
      rawUid: ev.uid,
    }))
  } finally {
    clearTimeout(timer)
  }
}
