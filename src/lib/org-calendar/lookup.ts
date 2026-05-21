/**
 * org_calendar_events(Google Calendar sync 결과) 기반 휴가/일정 조회 공용 lib.
 *
 * Phase 1.5f (2026-05-21) — MY PAGE 캘린더(/api/calendar/range)에 있던 조회 로직을
 * 추출해서 둘러보기(team-status) + cron 알림(morning-summary, reminder-20/22)이 공유.
 * 기존 Google Sheets(leave_calendar_cache + Apps Script) 소스를 대체.
 *
 * 매칭: org_calendar_events.matched_user_emails 와 대상 emails 교집합(overlaps).
 *       sync(match-users.ts)가 title `[이름]` parse + 참석자 email로 미리 채워둔 결과.
 *       매칭 안 된 이벤트는 어느 사용자에도 분배하지 않음 (fallback 없음 — 사용자 정책 확정).
 *
 * 휴가 판정 정책 (MY PAGE와 동일):
 *   - is_all_day || duration ≥ 8h → 'full_day'
 *   - 종료 ≤ 14:00 → 'morning_half'
 *   - 시작 ≥ 14:00 → 'afternoon_half'
 *   - 그 외 → 'morning_half'
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { UserCalendarLookup, CalendarEventChunk } from '@/types/leave-calendar'
import type { LeaveType } from '@/types/leave-timeline'

/** ISO → KST 'HH:mm' */
export function toKstTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('ko-KR', {
    timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false,
  })
}

/** Date → KST 'YYYY-MM-DD' */
export function toKstDateString(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d)
}

/**
 * 제목 앞 대괄호 prefix를 통째로 제거.
 * 참석자 이름·팀 라벨(`[재민,승현]`, `[MICE팀]`) prefix는 카드/셀별로 사람이 분리돼 있어 노이즈.
 * 첫 번째 `[...]` 블록을 제거하고 본문 텍스트만 남김.
 */
export function stripBracketPrefix(title: string): string {
  if (!title) return title
  return title.replace(/^\[[^\]]*\]\s*/, '')
}

/** vacation 이벤트의 시간 범위 → LeaveType 분류 */
export function decideLeaveType(startMs: number, endMs: number, isAllDay: boolean): LeaveType {
  if (isAllDay) return 'full_day'
  const duration = endMs - startMs
  if (duration >= 480 * 60 * 1000) return 'full_day'
  const startKstHour = new Date(startMs).getUTCHours() + 9
  const endKstHour   = new Date(endMs).getUTCHours()   + 9
  const sh = startKstHour % 24
  const eh = endKstHour % 24
  if (eh <= 14) return 'morning_half'
  if (sh >= 14) return 'afternoon_half'
  return 'morning_half'
}

interface OrgCalendarRow {
  id: string
  title: string | null
  start_at: string
  end_at: string
  is_all_day: boolean
  inferred_type: string | null
  matched_user_emails: string[] | null
  org_calendar_id: string
  rrule: string | null
  recurring_event_id: string | null
}

export interface OrgCalendarLookupResult {
  enabled: boolean
  fetchFailed: boolean
  /** key: lowercase email. value: { 'YYYY-MM-DD': UserCalendarLookup } — dates 전부 초기화됨 */
  byEmail: Map<string, Record<string, UserCalendarLookup>>
}

/** dates 전부에 대해 빈 lookup으로 초기화된 record 생성 */
function emptyByDate(dates: string[]): Record<string, UserCalendarLookup> {
  const rec: Record<string, UserCalendarLookup> = {}
  for (const d of dates) {
    rec[d] = { enabled: true, leaveType: null, leaveLabel: null, events: [], raw: null }
  }
  return rec
}

/**
 * 대상 emails × dates 범위의 org_calendar_events 조회 → 사용자별 날짜별 lookup.
 *
 * @param emails  소문자 이메일 배열 (조회 대상). 빈 배열이면 빈 결과.
 * @param dates   'YYYY-MM-DD' 배열 (KST 기준). 연속/비연속 무관. 결과 record는 이 날짜들로 초기화.
 */
export async function fetchOrgCalendarLookup(args: {
  adminClient: SupabaseClient
  emails: string[]
  dates: string[]
}): Promise<OrgCalendarLookupResult> {
  const { adminClient, dates } = args
  const emails = args.emails.map(e => e.toLowerCase()).filter(Boolean)

  const byEmail = new Map<string, Record<string, UserCalendarLookup>>()
  for (const e of emails) byEmail.set(e, emptyByDate(dates))

  if (emails.length === 0 || dates.length === 0) {
    return { enabled: true, fetchFailed: false, byEmail }
  }

  const sortedDates = [...dates].sort()
  const from = sortedDates[0]
  const to   = sortedDates[sortedDates.length - 1]
  const fromIso = new Date(`${from}T00:00:00+09:00`).toISOString()
  const toIso   = new Date(`${to}T23:59:59+09:00`).toISOString()

  const { data: rows, error } = await adminClient
    .from('org_calendar_events')
    .select('id, title, start_at, end_at, is_all_day, inferred_type, matched_user_emails, org_calendar_id, rrule, recurring_event_id')
    .lte('start_at', toIso)
    .gte('end_at',   fromIso)
    .overlaps('matched_user_emails', emails)
    .range(0, 9999)
    .returns<OrgCalendarRow[]>()

  if (error) {
    console.error('[org-calendar/lookup] query error:', error.message)
    return { enabled: true, fetchFailed: true, byEmail }
  }

  // 날짜별 KST 경계 (시각 이벤트 매핑용)
  const dateSet = new Set(dates)
  const dayBoundsMs = new Map<string, { start: number; end: number }>()
  for (const d of dates) {
    dayBoundsMs.set(d, {
      start: new Date(`${d}T00:00:00+09:00`).getTime(),
      end:   new Date(`${d}T23:59:59+09:00`).getTime(),
    })
  }

  for (const r of rows ?? []) {
    const evStartMs = new Date(r.start_at).getTime()
    const evEndMs   = new Date(r.end_at).getTime()
    const isVacation = r.inferred_type === 'vacation'

    // 이 이벤트가 걸치는 (조회 대상 dates 안의) KST 날짜
    let matchingDates: string[]
    if (r.is_all_day) {
      const durationDays = Math.max(1, Math.round((evEndMs - evStartMs) / 86_400_000))
      const startKst = toKstDateString(new Date(evStartMs))
      const [sy, sm, sd] = startKst.split('-').map(Number)
      const lastKst = toKstDateString(new Date(Date.UTC(sy, sm - 1, sd + durationDays - 1)))
      matchingDates = dates.filter(d => d >= startKst && d <= lastKst)
    } else {
      matchingDates = dates.filter(d => {
        const b = dayBoundsMs.get(d)
        if (!b) return false
        return !(evStartMs > b.end || evEndMs <= b.start)
      })
    }
    if (matchingDates.length === 0) continue

    const cleanedTitle = stripBracketPrefix(r.title ?? '')

    // 이 이벤트의 matched_user_emails 중 조회 대상(byEmail)에 있는 사용자에게만 분배
    const targets = (r.matched_user_emails ?? [])
      .map(e => e.toLowerCase())
      .filter(e => byEmail.has(e))
    if (targets.length === 0) continue

    for (const email of targets) {
      const rec = byEmail.get(email)!
      for (const dateIso of matchingDates) {
        if (!dateSet.has(dateIso)) continue
        const lookup = rec[dateIso]
        if (isVacation) {
          if (lookup.leaveType === null) {
            lookup.leaveType = decideLeaveType(evStartMs, evEndMs, r.is_all_day)
            lookup.leaveLabel = cleanedTitle || '휴가'
            lookup.raw = cleanedTitle || null
          }
        } else {
          const chunk: CalendarEventChunk = {
            startTime: r.is_all_day ? null : toKstTime(r.start_at),
            endTime:   r.is_all_day ? null : toKstTime(r.end_at),
            title:     cleanedTitle,
            id: r.id,
            startAt: r.start_at,
            endAt:   r.end_at,
            isAllDay: r.is_all_day,
            inferredType: r.inferred_type,
            orgCalendarId: r.org_calendar_id,
            rrule: r.rrule,
            recurringEventId: r.recurring_event_id,
          }
          lookup.events.push(chunk)
        }
      }
    }
  }

  return { enabled: true, fetchFailed: false, byEmail }
}
