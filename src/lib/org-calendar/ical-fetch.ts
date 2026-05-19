/**
 * Google Calendar iCal fetch + 파싱
 *
 * 전제 — 캘린더가 "공개" 설정되어 있어야 ID만으로 read 가능
 *   (Google Calendar 설정 → 액세스 권한 → "공개 사용 설정" 활성화)
 *
 * URL 패턴:
 *   https://calendar.google.com/calendar/ical/{CALENDAR_ID}/public/basic.ics
 *
 * 429 방지 — 호출처(cron)에서 캘린더당 적정 빈도(30분~1시간)로만 호출.
 * 사용자 요청은 DB cache(org_calendar_events) read만 — Google에 직접 호출 X.
 *
 * node-ical은 Node.js 전용 (BigInt 등 native 의존). Edge runtime + Turbopack
 * build time 분석에서 깨질 수 있어 dynamic import로 lazy load.
 */

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
    // dynamic import — build time bundle 분석에서 node-ical(BigInt) 제외
    const ical = await import('node-ical')
    const parsed = ical.sync.parseICS(text)

    const events: ParsedEvent[] = []
    for (const key of Object.keys(parsed)) {
      const item = parsed[key]
      if (!item || item.type !== 'VEVENT') continue

      const start = item.start instanceof Date ? item.start : new Date(item.start as unknown as string)
      const end   = item.end   instanceof Date ? item.end   : new Date(item.end   as unknown as string)
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) continue

      // node-ical의 VEvent type에 attendee 필드가 항상 있는 건 아니라 unknown 후 narrow
      const attendees: string[] = []
      const attRaw = (item as unknown as { attendee?: unknown }).attendee
      const list = Array.isArray(attRaw) ? attRaw : (attRaw != null ? [attRaw] : [])
      for (const a of list) {
        const valOrParams = a as { val?: string; params?: { CN?: string } } | string
        const val = typeof valOrParams === 'string' ? valOrParams : valOrParams?.val
        if (typeof val === 'string') {
          // "mailto:foo@bar.com" 형태 → 이메일만 추출
          const m = val.match(/mailto:([^>\s]+)/i)
          if (m) attendees.push(m[1].trim().toLowerCase())
        }
      }

      events.push({
        googleEventId: String(item.uid ?? key),
        title: typeof item.summary === 'string' ? item.summary : '',
        description: typeof item.description === 'string' ? item.description : null,
        location: typeof item.location === 'string' ? item.location : null,
        startAt: start,
        endAt: end,
        isAllDay: !!(item as unknown as { datetype?: string }).datetype
          ? (item as unknown as { datetype?: string }).datetype === 'date'
          : detectAllDay(start, end),
        attendeeEmails: attendees,
        rawUid: String(item.uid ?? key),
      })
    }

    return events
  } finally {
    clearTimeout(timer)
  }
}

/** datetype 정보 없으면 시각 패턴으로 추정. start/end 정각 + 24h 배수 = 종일 */
function detectAllDay(start: Date, end: Date): boolean {
  if (start.getUTCHours() !== 0 || start.getUTCMinutes() !== 0) return false
  if (end.getUTCHours() !== 0   || end.getUTCMinutes()   !== 0) return false
  const diff = (end.getTime() - start.getTime()) / 86400000
  return Math.abs(diff - Math.round(diff)) < 0.01 && diff >= 1
}
