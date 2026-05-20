/**
 * iCalendar (RFC 5545) 최소 파서.
 *
 * 동기:
 *   - node-ical은 Turbopack/Vercel bundle 단계에서 BigInt 의존성으로 깨짐 (runtime 직접 import도 fail)
 *   - ical.js 등 대안도 BigInt 위험 + 무거움
 *   - 우리는 Google Calendar feed의 VEVENT만 필요. RRULE(반복) 등 복잡 기능 불필요
 *   → 직접 파싱 (의존성 0, 가벼움)
 *
 * 지원:
 *   - VEVENT 블록만 (VTODO, VTIMEZONE 등 무시)
 *   - 표준 필드: UID, SUMMARY, DESCRIPTION, LOCATION, DTSTART, DTEND, ATTENDEE
 *   - DATE (종일) / DATETIME (시각, UTC `Z` 또는 TZID=Asia/Seoul)
 *   - iCal line folding (다음 줄이 공백/탭으로 시작하면 이어붙임)
 *   - text escape: \\n \\, \\; \\\\
 *
 * 무시 (현재 MVP에서 불필요):
 *   - RRULE (반복) — 첫 occurrence만 사용. 반복 이벤트는 Google이 매번 별도 VEVENT로
 *     보내주는 경우가 많아 큰 문제 X (timeMin~timeMax 범위 expand하면 그렇게 옴)
 *   - EXDATE, RECURRENCE-ID, ORGANIZER, etc.
 *
 * 한국 회사 캘린더 가정 — TZID 없는 floating time은 KST(+09:00)로 해석.
 */

export interface RawICalEvent {
  uid: string
  summary: string
  description: string | null
  location: string | null
  start: Date
  end: Date
  isAllDay: boolean
  attendees: string[]
}

/**
 * iCal 텍스트 → VEVENT 배열.
 * 잘못된 이벤트(UID 없거나 시간 invalid)는 skip.
 */
export function parseICal(text: string): RawICalEvent[] {
  const lines = unfoldLines(text)
  const events: RawICalEvent[] = []

  let inEvent = false
  let current: Partial<RawICalEvent> & { attendees: string[] } = { attendees: [] }

  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed === 'BEGIN:VEVENT') {
      inEvent = true
      current = { attendees: [] }
      continue
    }
    if (trimmed === 'END:VEVENT') {
      inEvent = false
      if (
        current.uid && current.start instanceof Date && current.end instanceof Date &&
        !Number.isNaN(current.start.getTime()) && !Number.isNaN(current.end.getTime())
      ) {
        events.push({
          uid: current.uid,
          summary: current.summary ?? '',
          description: current.description ?? null,
          location: current.location ?? null,
          start: current.start,
          end: current.end,
          isAllDay: current.isAllDay ?? false,
          attendees: current.attendees,
        })
      }
      continue
    }
    if (!inEvent) continue

    // KEY[;PARAMS]:VALUE 형식 분리
    const colonIdx = line.indexOf(':')
    if (colonIdx < 0) continue
    const keyPart = line.slice(0, colonIdx)
    const value   = line.slice(colonIdx + 1)

    const semi = keyPart.indexOf(';')
    const name = (semi < 0 ? keyPart : keyPart.slice(0, semi)).toUpperCase()
    const paramsStr = semi < 0 ? '' : keyPart.slice(semi + 1)
    const params: Record<string, string> = {}
    if (paramsStr) {
      for (const p of paramsStr.split(';')) {
        const eq = p.indexOf('=')
        if (eq > 0) {
          params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1)
        }
      }
    }

    switch (name) {
      case 'UID':         current.uid         = value.trim(); break
      case 'SUMMARY':     current.summary     = unescapeICal(value); break
      case 'DESCRIPTION': current.description = unescapeICal(value); break
      case 'LOCATION':    current.location    = unescapeICal(value); break
      case 'DTSTART': {
        const r = parseDateTime(value, params)
        if (r) { current.start = r.date; current.isAllDay = r.isDate }
        break
      }
      case 'DTEND': {
        const r = parseDateTime(value, params)
        if (r) { current.end = r.date }
        break
      }
      case 'ATTENDEE': {
        // ATTENDEE 값에서 mailto:이메일 추출
        const m = value.match(/mailto:([^\s,;]+)/i)
        if (m) current.attendees.push(m[1].toLowerCase().trim())
        break
      }
      default:
        // 그 외 필드는 무시
        break
    }
  }

  return events
}

/**
 * iCal line folding (RFC 5545 §3.1) 처리.
 * 다음 line이 공백/탭으로 시작하면 이전 line에 그 char 떼고 이어붙임.
 */
function unfoldLines(text: string): string[] {
  const raw = text.split(/\r?\n/)
  const result: string[] = []
  for (const line of raw) {
    if (line.length === 0) continue
    if ((line[0] === ' ' || line[0] === '\t') && result.length > 0) {
      result[result.length - 1] += line.slice(1)
    } else {
      result.push(line)
    }
  }
  return result
}

/** iCal escape 해제 — \n \, \; \\ 처리 */
function unescapeICal(s: string): string {
  return s
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\')
}

/**
 * DTSTART/DTEND 값 파싱.
 * - `20260519` → 종일 (UTC 자정)
 * - `20260519T100000Z` → UTC 시각
 * - `20260519T100000` (TZID=Asia/Seoul or no TZID) → KST로 해석
 * - 그 외 TZID → 일단 local time interpret (정확도 낮음, MVP 한계)
 */
function parseDateTime(
  value: string,
  params: Record<string, string>,
): { date: Date; isDate: boolean } | null {
  const v = value.trim()
  const isDateValue = params['VALUE']?.toUpperCase() === 'DATE'

  // 8자리 = 종일 DATE — KST 자정으로 저장하여 시각/날짜 비교 일관성 확보.
  // (이전엔 UTC 자정으로 저장 → KST 기준 +9h 어긋남 → 종일 이벤트가 다음 날에도 매칭되는 버그)
  if (isDateValue || /^\d{8}$/.test(v)) {
    if (!/^\d{8}$/.test(v)) return null
    const y = +v.slice(0, 4), mo = +v.slice(4, 6) - 1, d = +v.slice(6, 8)
    const utcMs = Date.UTC(y, mo, d) - 9 * 3600 * 1000
    return { date: new Date(utcMs), isDate: true }
  }

  // DATETIME: YYYYMMDDTHHMMSS[Z]
  const m = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/)
  if (!m) return null
  const y = +m[1], mo = +m[2] - 1, d = +m[3], h = +m[4], mi = +m[5], se = +m[6]
  const isZulu = m[7] === 'Z'

  if (isZulu) {
    return { date: new Date(Date.UTC(y, mo, d, h, mi, se)), isDate: false }
  }

  // 한국 회사 캘린더 가정 — TZID 무관하게 KST(+09:00)로 해석.
  // (Asia/Seoul 외에 "Korean Standard Time" · 사용자 정의 TZID 등이 와도 실제 데이터는
  //  한국 시각이라 그대로 KST 해석이 정확. 이전엔 `new Date(y, mo, d, h, mi, se)`로
  //  서버 local time(UTC) 해석되어 9시간 늦게 저장되던 케이스 안전망.)
  const utcMs = Date.UTC(y, mo, d, h, mi, se) - 9 * 3600 * 1000
  return { date: new Date(utcMs), isDate: false }
}
