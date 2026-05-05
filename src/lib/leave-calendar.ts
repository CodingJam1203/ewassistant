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

const TTL_MS = 30 * 60 * 1000  // 30분
const APPS_SCRIPT_TIMEOUT_MS = 10_000

function cacheKey(date: string): string {
  return `calendar:${date}`
}

/** env 셋업 여부 — 미설정 시 모든 외부 호출이 자동 skip됨 */
export function isCalendarEnabled(): boolean {
  return !!process.env.LEAVE_CALENDAR_WEBHOOK_URL
}

// ─── Apps Script 호출 ─────────────────────────────────────────────────────────

async function callAppsScriptOnce(date: string): Promise<CalendarBatchResponse> {
  const url = process.env.LEAVE_CALENDAR_WEBHOOK_URL
  if (!url) {
    throw new Error('LEAVE_CALENDAR_WEBHOOK_URL not configured')
  }
  const token = process.env.LEAVE_CALENDAR_TOKEN

  const params = new URLSearchParams({ date })
  if (token) params.set('token', token)

  const fullUrl = url.includes('?') ? `${url}&${params}` : `${url}?${params}`

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), APPS_SCRIPT_TIMEOUT_MS)

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
    const { data, error } = await adminClient
      .from('leave_calendar_cache')
      .select('data, updated_at')
      .eq('key', cacheKey(date))
      .maybeSingle()
    if (error || !data) return null
    return {
      data: data.data as CalendarBatchResponse,
      updatedAtMs: new Date(data.updated_at as string).getTime(),
    }
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

/**
 * 캐시 우선 조회 — TTL 만료 시에만 Apps Script 호출.
 * Apps Script 실패 시 stale 캐시 fallback. 둘 다 실패하면 null.
 */
export async function getCalendarForDate(date: string): Promise<CalendarBatchResponse | null> {
  if (!isCalendarEnabled()) return null

  const cached = await readCache(date)
  const now = Date.now()

  if (cached && now - cached.updatedAtMs < TTL_MS) {
    return cached.data
  }

  // TTL 만료 또는 캐시 없음 → Apps Script 호출
  try {
    const fresh = await callAppsScriptOnce(date)
    await writeCache(date, fresh)
    return fresh
  } catch (err) {
    console.warn('[leave-calendar] Apps Script fetch failed:', err)
    if (cached) {
      console.warn('[leave-calendar] returning stale cache (age=', now - cached.updatedAtMs, 'ms)')
      return cached.data
    }
    return null
  }
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
    const fresh = await callAppsScriptOnce(date)
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

  const events: CalendarEventChunk[] = []
  for (const line of text.split(/\n+/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const match = RANGE_REGEX.exec(trimmed)
    if (!match) {
      events.push({ startTime: null, endTime: null, title: trimmed })
      continue
    }
    const range = match[1].trim()
    const title = match[2].trim()
    if (range === '종일' || range.toLowerCase() === 'all-day') {
      events.push({ startTime: null, endTime: null, title })
      continue
    }
    const tm = TIME_RANGE_REGEX.exec(range)
    if (tm) {
      events.push({ startTime: padHHmm(tm[1]), endTime: padHHmm(tm[2]), title })
    } else {
      events.push({ startTime: null, endTime: null, title: trimmed })
    }
  }
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
 * 결과: 본부 안의 [{name, leaveType, leaveLabel, events}, ...] (휴가가 아닌 사람도 events 있을 수 있음)
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
