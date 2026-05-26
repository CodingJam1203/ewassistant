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
import { parseCell } from '@/lib/leave-calendar'
import { normalizeName } from '@/lib/org-calendar/name-match'

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

  // Phase A — 시트 source 매핑된 팀의 사용자에 한해 leave_calendar_cache 데이터 합산.
  // best-effort: 실패해도 GCal lookup은 그대로 반환 (fetchFailed 영향 X).
  try {
    await mergeSheetDataIntoLookup({ adminClient, dates, byEmail })
  } catch (err) {
    console.warn('[org-calendar/lookup] sheet merge failed:', err)
  }

  return { enabled: true, fetchFailed: false, byEmail }
}

// ─── Phase A — Sheet data merge layer ───────────────────────────────────────

interface UserProfileRow {
  email: string
  display_name: string | null
  division: string | null
  team: string | null
}

interface TeamRow {
  name: string
  sheet_source_id: string
  org_divisions: { name: string }
  org_sheet_sources: { is_active: boolean }
}

interface SheetCacheRow {
  key: string
  data: { departments?: Record<string, Array<{ name?: string; cellValue?: string }>> }
}

/**
 * Phase A — 시트 source 매핑된 팀의 사용자에 leave_calendar_cache 데이터 합산.
 *
 * 동작 정책:
 *   - 팀 멤버: sheet_source_id 매핑된 팀(opt-in)만 시트 데이터 활용
 *   - 본부 직속(team NULL): 본부에 active source 있으면 자동 적용 (fallback)
 *   - 본부 단위 1차 필터 — 시트의 dept entries × user의 (division, team) 매칭
 *   - 이름 매칭은 user_profiles.display_name == sheet entry.name (정확 일치)
 *   - 본부 내 동명이인은 둘 다 매칭됨 (Phase B에서 override 처리 예정)
 *   - 휴가 우선순위: GCal already set → 시트 skip / GCal 비어있음 → 시트 적용
 *   - 일반 일정: 그대로 events에 push (dedup은 Phase B)
 *   - Mode 1 zero impact: 매핑 0인 본부의 멤버는 변화 없음
 */
async function mergeSheetDataIntoLookup(args: {
  adminClient: SupabaseClient
  dates: string[]
  byEmail: Map<string, Record<string, UserCalendarLookup>>
}): Promise<void> {
  const { adminClient, dates, byEmail } = args
  if (byEmail.size === 0 || dates.length === 0) return

  const emails = Array.from(byEmail.keys())

  // 1) user_profiles에서 display_name + (division, team) text 컬럼 조회
  const { data: userRows, error: usersErr } = await adminClient
    .from('user_profiles')
    .select('id, email, display_name, division, team')
    .in('email', emails)

  if (usersErr || !userRows || userRows.length === 0) return

  // 2-a) sheet_source_id 매핑된 팀 + 활성 source join (팀 멤버용 매핑)
  const { data: teamRows, error: teamsErr } = await adminClient
    .from('org_teams')
    .select('name, sheet_source_id, org_divisions!inner(name), org_sheet_sources!inner(is_active)')
    .not('sheet_source_id', 'is', null)
    .eq('org_sheet_sources.is_active', true)

  if (teamsErr) return

  // 2-b) 본부 단위 활성 source (본부 직속 fallback용) — 본부에 active source 있으면 본부 직속 자동 적용
  const { data: sourceRows, error: sourcesErr } = await adminClient
    .from('org_sheet_sources')
    .select('id, division:org_divisions!inner(name)')
    .eq('is_active', true)

  if (sourcesErr) return

  // teamKey ("본부명::팀명") → sheet_source_id
  const teamKeyToSourceId = new Map<string, string>()
  for (const t of (teamRows ?? []) as unknown as TeamRow[]) {
    const divName = t.org_divisions?.name
    if (!divName || !t.name || !t.sheet_source_id) continue
    teamKeyToSourceId.set(`${divName}::${t.name}`, t.sheet_source_id)
  }

  // 본부명 → 첫 active source_id (본부 직속 fallback)
  const divisionToSourceId = new Map<string, string>()
  for (const s of (sourceRows ?? []) as unknown as Array<{ id: string; division: { name: string } }>) {
    const divName = s.division?.name
    if (!divName || !s.id) continue
    if (!divisionToSourceId.has(divName)) {
      divisionToSourceId.set(divName, s.id)
    }
  }

  if (teamKeyToSourceId.size === 0 && divisionToSourceId.size === 0) return

  // 3) user → sheet_source_id + normalizedName 매핑 (Phase B.6 정규화 + 동명이인 처리)
  const userToTarget = new Map<string, { sourceId: string; normName: string; userId: string }>()
  const userIdToEmail = new Map<string, string>()
  for (const u of userRows as Array<UserProfileRow & { id?: string }>) {
    if (!u.division || !u.display_name || !u.id) continue

    let sourceId: string | undefined
    if (u.team) {
      sourceId = teamKeyToSourceId.get(`${u.division}::${u.team}`)
    } else {
      sourceId = divisionToSourceId.get(u.division)
    }
    if (!sourceId) continue

    const normName = normalizeName(u.display_name)
    if (!normName) continue
    const lowEmail = u.email.toLowerCase()
    userToTarget.set(lowEmail, { sourceId, normName, userId: u.id })
    userIdToEmail.set(u.id, lowEmail)
  }
  if (userToTarget.size === 0) return  // 매핑된 사용자 없음 → Mode 1 zero impact

  // 4) source × normalizedName → users 인덱스. 본부 내 N≥2 자동 매칭 보류용.
  const sourceNameToEmails = new Map<string, string[]>()
  for (const [email, target] of userToTarget) {
    const key = `${target.sourceId}::${target.normName}`
    const arr = sourceNameToEmails.get(key)
    if (arr) arr.push(email)
    else sourceNameToEmails.set(key, [email])
  }

  // Phase B.6 — sheet_name_overrides 조회 (운영자 명시 매핑)
  const { data: overrideRows } = await adminClient
    .from('sheet_name_overrides')
    .select('sheet_source_id, sheet_name, user_id')
  const overrideIndex = new Map<string, string>()  // `${sourceId}::${normName}` → user_id
  for (const r of (overrideRows ?? []) as Array<{ sheet_source_id: string; sheet_name: string; user_id: string }>) {
    const normName = normalizeName(r.sheet_name)
    if (!normName) continue
    overrideIndex.set(`${r.sheet_source_id}::${normName}`, r.user_id)
  }

  // 5) leave_calendar_cache에서 신규 형식(`calendar:<source_id>:DATE`) row 전부 read
  const dateSet = new Set(dates)
  const { data: cacheRows, error: cacheErr } = await adminClient
    .from('leave_calendar_cache')
    .select('key, data')
    .like('key', 'calendar:%:%')

  if (cacheErr || !cacheRows) return

  // 6) row 순회 — source_id + date 파싱 → 매칭 user들에게 entries 합산
  for (const r of cacheRows as SheetCacheRow[]) {
    const m = /^calendar:([0-9a-f-]{36}):(\d{4}-\d{2}-\d{2})$/i.exec(r.key)
    if (!m) continue
    const sourceId = m[1]
    const date = m[2]
    if (!dateSet.has(date)) continue

    const departments = r.data?.departments
    if (!departments) continue

    for (const entries of Object.values(departments)) {
      if (!Array.isArray(entries)) continue
      for (const entry of entries) {
        const sheetName = (entry.name ?? '').trim()
        if (!sheetName) continue
        const cellValue = entry.cellValue ?? ''
        if (!cellValue) continue

        // Phase B.6 매칭 정책:
        //   1) override 있으면 그 user만
        //   2) 본부 내 자동 매칭 N=1 → 그 user
        //   3) N=0 또는 N≥2 → 보류
        const normSheetName = normalizeName(sheetName)
        let matchedEmails: string[] = []
        const overrideUserId = overrideIndex.get(`${sourceId}::${normSheetName}`)
        if (overrideUserId) {
          const oEmail = userIdToEmail.get(overrideUserId)
          if (oEmail) matchedEmails = [oEmail]
        } else {
          const auto = sourceNameToEmails.get(`${sourceId}::${normSheetName}`)
          if (auto && auto.length === 1) matchedEmails = [auto[0]]
        }
        if (matchedEmails.length === 0) continue

        const parsed = parseCell(cellValue)

        for (const email of matchedEmails) {
          const rec = byEmail.get(email)
          if (!rec) continue
          const lookup = rec[date]
          if (!lookup) continue

          if (parsed.leaveType) {
            // 휴가 — GCal이 이미 설정했으면 skip (GCal 우선)
            if (lookup.leaveType === null) {
              lookup.leaveType = parsed.leaveType
              lookup.leaveLabel = cellValue.trim()
              lookup.raw = cellValue
            }
          } else {
            // 일반 일정 — events에 누적
            for (const ev of parsed.events) {
              lookup.events.push(ev as CalendarEventChunk)
            }
          }
        }
      }
    }
  }
}
