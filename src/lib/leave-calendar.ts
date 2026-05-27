/**
 * 외부 Google Sheets 휴가/일정 캘린더 — DB 캐시 layer
 *
 * 정책:
 *   - 사용자 요청에서 절대 직접 Apps Script를 호출하지 않음
 *   - DB(leave_calendar_cache)를 1차 source로 사용
 *   - TTL 30분 초과 시에만 Apps Script 호출 → 결과 upsert
 *   - Apps Script 실패 시 stale 캐시 fallback
 *   - cron(07:00 KST)에서 forceRefresh로 강제 갱신
 *   - env(LEAVE_CALENDAR_WEBHOOK_URL) 미설정 시 모든 호출 no-op
 *
 * 멀티 인스턴스 환경 안전:
 *   - DB cache라 인스턴스 간 공유 OK
 *   - 동시 cache miss → 동시 Apps Script 호출 가능성 (드물고 무해 — TTL 30분 단위)
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { parseLeaveLabel } from '@/lib/leave-timeline'
import type {
  CalendarBatchResponse,
  CalendarCellEntry,
  CalendarEventChunk,
  ParsedCalendarCell,
  UserCalendarLookup,
} from '@/types/leave-calendar'

const TTL_MS = 6 * 60 * 60 * 1000  // 6시간 — Apps Script 느릴 때 stale fallback 윈도우 확장
// 사용자 요청 핫패스(getCalendarForDate)에서 사용. 평소엔 캐시 hit이라 영향 없고,
// cache miss(첫 진입/TTL 만료)에서만 fetch. 너무 길면 페이지 로드가 같이 막혀서 짧게 둠.
// cron 강제 갱신은 별도 timeout 사용.
const APPS_SCRIPT_TIMEOUT_MS = 15_000      // 7s → 15s. Apps Script가 종종 10s+ 걸려 cold cache miss 시에도 잡힘
const APPS_SCRIPT_TIMEOUT_MS_CRON = 30_000  // cron은 더 여유 (재시도 없음)

function cacheKey(date: string): string {
  // legacy 키 형식. writeCache fallback path만 이 형식으로 씀.
  // 새 write-cache PUSH는 source 단위로 'calendar:<source_id>:YYYY-MM-DD' 형식.
  return `calendar:${date}`
}

/**
 * Phase A — leave_calendar_cache 키에서 날짜 suffix 추출.
 * 두 형식 모두 지원:
 *   - legacy:  'calendar:YYYY-MM-DD'
 *   - 신규:    'calendar:<source_id>:YYYY-MM-DD'
 */
function parseCacheKeyDate(key: string): string | null {
  const m = /(\d{4}-\d{2}-\d{2})$/.exec(key)
  return m ? m[1] : null
}

/**
 * Phase A — 같은 날짜의 여러 cache row(legacy 1 + source별 N)의 departments를 합쳐서
 * 단일 CalendarBatchResponse 형태로 반환. 호출처는 형식 변화 모름.
 */
function mergeDepartmentsInto(
  base: CalendarBatchResponse['departments'],
  add: CalendarBatchResponse['departments'] | undefined,
): void {
  if (!add) return
  for (const [name, entries] of Object.entries(add)) {
    if (!Array.isArray(entries)) continue
    if (!base[name]) base[name] = []
    base[name].push(...entries)
  }
}

/** env 셋업 여부 — 미설정 시 모든 외부 호출이 자동 skip됨 */
export function isCalendarEnabled(): boolean {
  return !!process.env.LEAVE_CALENDAR_WEBHOOK_URL
}

// ─── Apps Script 호출 ─────────────────────────────────────────────────────────

async function callAppsScriptOnce(
  date: string,
  opts?: { timeoutMs?: number }
): Promise<CalendarBatchResponse> {
  const url = process.env.LEAVE_CALENDAR_WEBHOOK_URL
  if (!url) {
    throw new Error('LEAVE_CALENDAR_WEBHOOK_URL not configured')
  }
  const token = process.env.LEAVE_CALENDAR_TOKEN

  const params = new URLSearchParams({ date })
  if (token) params.set('token', token)

  const fullUrl = url.includes('?') ? `${url}&${params}` : `${url}?${params}`

  const timeoutMs = opts?.timeoutMs ?? APPS_SCRIPT_TIMEOUT_MS
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(fullUrl, {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal,
    })
    if (!res.ok) {
      throw new Error(`Apps Script HTTP ${res.status}: ${await res.text().catch(() => '')}`)
    }
    const data = await res.json() as CalendarBatchResponse
    if (data && typeof data === 'object' && data.error) {
      throw new Error(`Apps Script returned error: ${data.error}`)
    }
    return {
      date,
      departments: data?.departments ?? {},
    }
  } finally {
    clearTimeout(timer)
  }
}

// ─── DB 캐시 ──────────────────────────────────────────────────────────────────

interface CachedRow {
  data: CalendarBatchResponse
  updatedAtMs: number
}

async function readCache(date: string): Promise<CachedRow | null> {
  try {
    const adminClient = createAdminClient()
    // Phase A — legacy('calendar:DATE') + 신규('calendar:<source>:DATE') 둘 다 fetch.
    // OR 2 conditions만 사용 — 단일 date라 쿼리 짧음.
    // 결과를 merge해서 단일 CalendarBatchResponse로 반환 (호출처 호환 유지).
    const { data, error } = await adminClient
      .from('leave_calendar_cache')
      .select('key, data, updated_at')
      .or(`key.eq.calendar:${date},key.like.calendar:%:${date}`)
    if (error || !data || data.length === 0) return null

    const merged: CalendarBatchResponse = { date, departments: {} }
    let latestMs = 0
    for (const r of data as Array<{ key: string; data: CalendarBatchResponse; updated_at: string }>) {
      const ts = new Date(r.updated_at).getTime()
      if (ts > latestMs) latestMs = ts
      mergeDepartmentsInto(merged.departments, r.data?.departments)
    }
    return { data: merged, updatedAtMs: latestMs }
  } catch (err) {
    console.warn('[leave-calendar] readCache failed:', err)
    return null
  }
}

async function writeCache(date: string, payload: CalendarBatchResponse): Promise<void> {
  try {
    const adminClient = createAdminClient()
    await adminClient
      .from('leave_calendar_cache')
      .upsert({
        key: cacheKey(date),
        data: payload,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'key' })
  } catch (err) {
    console.warn('[leave-calendar] writeCache failed:', err)
  }
}

// ─── 공개 API ─────────────────────────────────────────────────────────────────

// 같은 인스턴스에서 동시에 같은 date를 fetch하지 않도록 in-flight dedupe
const inFlight = new Map<string, Promise<CalendarBatchResponse | null>>()

/**
 * 캐시 우선 조회 — Stale-While-Revalidate 패턴.
 *
 * - cache hit (TTL 내) → 즉시 반환
 * - cache hit (stale)  → stale 즉시 반환 + 백그라운드 갱신 (사용자는 안 기다림)
 * - cache miss         → 동기 호출 (timeout 짧음). 실패 시 null
 *
 * 이 패턴 덕에 hot path에서 외부 fetch 대기 시간이 거의 0으로 수렴.
 * 첫 진입 + cron 실패 같은 cold start에서만 동기 대기 발생.
 */
export async function getCalendarForDate(date: string): Promise<CalendarBatchResponse | null> {
  if (!isCalendarEnabled()) return null

  const cached = await readCache(date)
  const now = Date.now()

  if (cached) {
    const fresh = now - cached.updatedAtMs < TTL_MS
    if (fresh) {
      // ✓ 캐시 신선 — 즉시 반환
      return cached.data
    }
    // ✗ stale — 즉시 반환 + 백그라운드 갱신 트리거
    triggerBackgroundRefresh(date)
    return cached.data
  }

  // 캐시 자체 없음 → 동기 호출 (timeout 짧음)
  try {
    const fresh = await callAppsScriptOnce(date)
    await writeCache(date, fresh)
    return fresh
  } catch (err) {
    console.warn('[leave-calendar] cold-cache fetch failed:', err)
    return null
  }
}

function triggerBackgroundRefresh(date: string): void {
  if (inFlight.has(date)) return
  const p = (async () => {
    try {
      const fresh = await callAppsScriptOnce(date)
      await writeCache(date, fresh)
      return fresh
    } catch (err) {
      console.warn('[leave-calendar] background refresh failed:', err)
      return null
    } finally {
      inFlight.delete(date)
    }
  })()
  inFlight.set(date, p)
  // p를 await하지 않음 — 사용자 응답은 stale 캐시로 즉시 반환됨
}

/**
 * Batch 호출 — DB 캐시에서 한 번에 여러 날짜 fetch.
 *
 * 정책 (2026-05 변경):
 *   - 기본은 cache-only. Apps Script 호출 안 함.
 *   - 사용자 트래픽 path(/api/calendar/range 등)는 절대 Apps Script 호출 X.
 *   - 캐시 freshness는 Apps Script 측 Time Trigger(매시간)가 N-Click write-cache endpoint로 PUSH해서 유지.
 *   - opt.allowAppsScriptFallback=true 일 때만 누락분을 Apps Script로 채움 (cron 전용).
 *
 * 캐시 read는 IN 쿼리 1회로 묶어서 N round-trip 회피.
 *
 * 응답 형식:
 *   { 'YYYY-MM-DD': CalendarBatchResponse | null, ... }
 */
export async function getCalendarRangeBatch(
  dates: string[],
  opts?: { timeoutMs?: number; allowAppsScriptFallback?: boolean },
): Promise<Record<string, CalendarBatchResponse | null>> {
  if (!isCalendarEnabled()) {
    return Object.fromEntries(dates.map(d => [d, null]))
  }

  const result: Record<string, CalendarBatchResponse | null> = {}
  const missing: string[] = []
  const now = Date.now()

  // 1) 캐시 전체 1회 fetch — Phase A 이후 legacy + source별 row 모두 들고와서 date로 그룹·merge.
  //    LIKE 'calendar:%' 로 캘린더 캐시 row 전부 가져옴 (테이블 max ~90 dates × 본부 수 ⇒ 수백 row 수준).
  //    91개 OR 체인보다 단순하고 안정적.
  try {
    const adminClient = createAdminClient()
    const datesSet = new Set(dates)
    const { data: rows } = await adminClient
      .from('leave_calendar_cache')
      .select('key, data, updated_at')
      .like('key', 'calendar:%')

    // date → { merged departments, latest updated_at } 누적
    const byDate = new Map<string, { merged: CalendarBatchResponse; latestMs: number }>()
    for (const r of (rows ?? []) as Array<{ key: string; data: CalendarBatchResponse; updated_at: string }>) {
      const d = parseCacheKeyDate(r.key)
      if (!d || !datesSet.has(d)) continue
      const ts = new Date(r.updated_at).getTime()
      let entry = byDate.get(d)
      if (!entry) {
        entry = { merged: { date: d, departments: {} }, latestMs: 0 }
        byDate.set(d, entry)
      }
      if (ts > entry.latestMs) entry.latestMs = ts
      mergeDepartmentsInto(entry.merged.departments, r.data?.departments)
    }

    for (const date of dates) {
      const e = byDate.get(date)
      if (e) {
        result[date] = e.merged
        if (now - e.latestMs >= TTL_MS) missing.push(date)
      } else {
        result[date] = null
        missing.push(date)
      }
    }
  } catch (err) {
    console.warn('[leave-calendar] cache bulk read failed:', err)
    for (const date of dates) {
      if (!(date in result)) result[date] = null
    }
    // 캐시 자체 실패면 더 진행해도 비싸기만 함 → 그대로 반환
    return result
  }

  // 2) 사용자 트래픽 path는 여기서 종료 (Apps Script 호출 안 함).
  //    Apps Script push가 1시간마다 캐시를 갱신하므로 stale이어도 그대로 반환.
  if (!opts?.allowAppsScriptFallback || missing.length === 0) {
    return result
  }

  // 3) (cron 전용) 누락분 batch 호출 — Apps Script의 MAX_RANGE_DAYS=90 한도에 맞춰 chunk
  const url = process.env.LEAVE_CALENDAR_WEBHOOK_URL
  if (!url) return result
  const token = process.env.LEAVE_CALENDAR_TOKEN

  const sorted = missing.slice().sort()

  // 날짜 span 기준 chunk — Apps Script MAX_RANGE_DAYS=90이라 from~to span이 90일 이상이면 거부됨.
  // entry 수가 적어도 첫 날짜와 마지막 날짜가 멀면 한 호출에 못 담음.
  const MAX_SPAN_DAYS = 89  // from-to 양끝 포함 90일 이내
  const dayMs = 86_400_000
  const toMs = (s: string) => new Date(s + 'T00:00:00Z').getTime()
  const chunks: string[][] = []
  let curChunk: string[] = []
  let curStartMs = 0
  for (const d of sorted) {
    const dMs = toMs(d)
    if (curChunk.length === 0) {
      curChunk = [d]
      curStartMs = dMs
    } else if ((dMs - curStartMs) / dayMs > MAX_SPAN_DAYS) {
      chunks.push(curChunk)
      curChunk = [d]
      curStartMs = dMs
    } else {
      curChunk.push(d)
    }
  }
  if (curChunk.length > 0) chunks.push(curChunk)

  for (const chunk of chunks) {
    const params = new URLSearchParams({
      from: chunk[0],
      to:   chunk[chunk.length - 1],
    })
    if (token) params.set('token', token)
    const fullUrl = url.includes('?') ? `${url}&${params}` : `${url}?${params}`

    const timeoutMs = opts?.timeoutMs ?? 12_000
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const res = await fetch(fullUrl, {
        method: 'GET',
        cache: 'no-store',
        signal: controller.signal,
      })
      if (!res.ok) {
        console.warn('[leave-calendar] batch chunk HTTP', res.status)
        continue
      }
      const data = await res.json() as { batch?: Record<string, { departments: CalendarBatchResponse['departments'] }>, error?: string }
      if (data.error) {
        console.warn('[leave-calendar] batch chunk error:', data.error)
        continue
      }
      if (!data.batch || typeof data.batch !== 'object') {
        console.warn('[leave-calendar] batch chunk returned no batch field')
        continue
      }

      // chunk 응답에서 해당 날짜만 채움
      for (const date of chunk) {
        const entry = data.batch[date]
        if (entry) {
          const payload: CalendarBatchResponse = {
            date,
            departments: entry.departments ?? {},
          }
          result[date] = payload
          writeCache(date, payload).catch(() => {})
        }
      }
    } catch (err) {
      console.warn('[leave-calendar] batch chunk fetch failed:', err)
    } finally {
      clearTimeout(timer)
    }
  }

  return result
}

/**
 * 강제 갱신 — TTL 무시, 무조건 Apps Script 호출.
 * cron(07:00 KST)에서 호출.
 *
 * @returns 새 데이터 (실패 시 null — 기존 캐시는 그대로 유지)
 */
export async function forceRefreshCalendar(date: string): Promise<CalendarBatchResponse | null> {
  if (!isCalendarEnabled()) return null

  try {
    // cron은 사용자 요청 응답을 막지 않으므로 timeout을 길게 잡음
    const fresh = await callAppsScriptOnce(date, { timeoutMs: APPS_SCRIPT_TIMEOUT_MS_CRON })
    await writeCache(date, fresh)
    return fresh
  } catch (err) {
    console.error('[leave-calendar] force refresh failed:', err)
    return null
  }
}

// ─── 셀 값 파싱 ───────────────────────────────────────────────────────────────

const RANGE_REGEX = /^<([^>]+)>\s*(.+)$/
const TIME_RANGE_REGEX = /^(\d{1,2}:\d{2})\s*~\s*(\d{1,2}:\d{2})$/

function padHHmm(hhmm: string): string {
  const [h, m] = hhmm.split(':')
  return `${(h ?? '0').padStart(2, '0')}:${(m ?? '00').padStart(2, '0')}`
}

/**
 * 셀 값에서 휴가 + 일반 일정 파싱.
 * 휴가 키워드(휴가/연차/오전반차/오후반차/반차)가 포함되면 leaveType 반환, events는 빈 배열.
 * 휴가가 아니면 일반 일정 chunk로 파싱.
 *
 * 예시:
 *   "휴가" → { leaveType: 'full_day', events: [] }
 *   "오전반차" → { leaveType: 'morning_half', events: [] }
 *   "<10:00~12:00> 미팅" → { leaveType: null, events: [{startTime:'10:00', endTime:'12:00', title:'미팅'}] }
 *   "<종일> 워크샵" → { leaveType: null, events: [{startTime:null, endTime:null, title:'워크샵'}] }
 *   "회의" → { leaveType: null, events: [{startTime:null, endTime:null, title:'회의'}] }
 */
export function parseCell(raw: string): ParsedCalendarCell {
  const text = (raw ?? '').trim()
  if (!text) return { raw: '', leaveType: null, events: [] }

  const leaveType = parseLeaveLabel(text)
  if (leaveType) {
    return { raw: text, leaveType, events: [] }
  }

  // v1.50 — 줄바꿈 기준 무조건 split 폐기.
  //   시간 prefix `<HH:mm~HH:mm>` 또는 `<종일>`이 있는 라인만 새 이벤트 시작 신호.
  //   prefix 없는 후속 라인은 이전 이벤트의 title에 공백으로 누적 (한 셀에 자유 텍스트가
  //   줄바꿈으로 나뉘어 적힌 케이스 — 예: "SK하이닉스\n(신입면접)" → 1 이벤트).
  //   첫 라인이 prefix 없으면 새 이벤트 시작 (title=line).
  const events: CalendarEventChunk[] = []
  let current: CalendarEventChunk | null = null
  const flush = () => { if (current) { events.push(current); current = null } }
  for (const line of text.split(/\n+/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const match = RANGE_REGEX.exec(trimmed)
    if (!match) {
      // prefix 없음 — 이전 이벤트가 있으면 title에 누적, 없으면 새 이벤트 시작
      if (current) {
        current.title = `${current.title} ${trimmed}`.trim()
      } else {
        current = { startTime: null, endTime: null, title: trimmed }
      }
      continue
    }
    // prefix 있음 — 새 이벤트 시작 (이전 이벤트 flush)
    flush()
    const range = match[1].trim()
    const title = match[2].trim()
    if (range === '종일' || range.toLowerCase() === 'all-day') {
      current = { startTime: null, endTime: null, title }
      continue
    }
    const tm = TIME_RANGE_REGEX.exec(range)
    if (tm) {
      current = { startTime: padHHmm(tm[1]), endTime: padHHmm(tm[2]), title }
    } else {
      current = { startTime: null, endTime: null, title: trimmed }
    }
  }
  flush()
  return { raw: text, leaveType: null, events }
}

// ─── 사용자 단위 조회 ─────────────────────────────────────────────────────────

/**
 * 캐시(또는 fresh)에서 특정 사용자(이름 매칭)의 셀을 찾아 휴가/일정 파싱.
 *
 * 이름 매칭 규칙: 공백 trim 후 완전 일치.
 * 동명이인은 1차 범위 밖 (시트에 부서/팀이 보통 분리되어 있어 충돌 적음).
 */
export async function getUserCalendarLookup(opts: {
  date: string
  department: string
  userName: string
}): Promise<UserCalendarLookup> {
  if (!isCalendarEnabled()) {
    return { enabled: false, leaveType: null, leaveLabel: null, events: [], raw: null }
  }

  const batch = await getCalendarForDate(opts.date)
  if (!batch) {
    return {
      enabled: true,
      fetchFailed: true,
      leaveType: null,
      leaveLabel: null,
      events: [],
      raw: null,
    }
  }

  const deptEntries = batch.departments?.[opts.department] ?? []
  const target = deptEntries.find(e => e.name?.trim() === opts.userName.trim())
  if (!target) {
    return { enabled: true, leaveType: null, leaveLabel: null, events: [], raw: null }
  }
  const parsed = parseCell(target.cellValue)
  return {
    enabled: true,
    leaveType: parsed.leaveType,
    leaveLabel: parsed.leaveType ? target.cellValue.trim() : null,
    events: parsed.events,
    raw: target.cellValue,
  }
}

/**
 * 본부 전체 휴가자 조회 (07시 cron용).
 */
export async function getDepartmentDailyParsed(opts: {
  date: string
  department: string
}): Promise<{
  enabled: boolean
  fetchFailed: boolean
  entries: Array<{
    name: string
    leaveType: ParsedCalendarCell['leaveType']
    leaveLabel: string | null
    events: CalendarEventChunk[]
    raw: string
  }>
}> {
  if (!isCalendarEnabled()) {
    return { enabled: false, fetchFailed: false, entries: [] }
  }
  const batch = await getCalendarForDate(opts.date)
  if (!batch) {
    return { enabled: true, fetchFailed: true, entries: [] }
  }
  const deptEntries: CalendarCellEntry[] = batch.departments?.[opts.department] ?? []
  const entries = deptEntries
    .filter(e => e.name && e.cellValue)
    .map(e => {
      const parsed = parseCell(e.cellValue)
      return {
        name: e.name.trim(),
        leaveType: parsed.leaveType,
        leaveLabel: parsed.leaveType ? e.cellValue.trim() : null,
        events: parsed.events,
        raw: e.cellValue,
      }
    })
  return { enabled: true, fetchFailed: false, entries }
}
