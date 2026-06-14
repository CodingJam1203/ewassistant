'use client'

/**
 * EventEditModal — Phase 4.3 등록/수정 모달.
 *
 * 구성:
 *   - 태그 MultiTagPicker (사람 + 그룹 multi-select, 본인 default)
 *   - 속성: meeting/vacation/birthday/other (radio)
 *   - 본문: 텍스트 입력
 *   - 미리보기: "[토큰들] 본문" — Google에 전송될 title
 *   - 일정: 시작·종료 date + 종일 toggle + 시간 (시각 이벤트만)
 *   - 캘린더: dropdown — 속성 + 토큰의 팀에 따라 prefill (사용자 변경 가능)
 *   - 위치·메모: optional
 *
 * 권한 체크는 API에서. 본 컴포넌트는 UI 가이드만 — 본인 본부 외 캘린더 옵션도 보일 수 있으나
 * 저장 시 403이 나오면 에러로 표시.
 */

import { useEffect, useMemo, useState } from 'react'
import { X, Loader2, Trash2, ExternalLink } from 'lucide-react'
import CustomDropdown from '@/components/ui/CustomDropdown'
import TimeSelect from '@/components/TimeSelect'
import MultiTagPicker, { buildSuffixCount, userShortLabel, type PickerToken, type PickerUser, type PickerTag } from './MultiTagPicker'
import { extractFirstName } from '@/lib/users/first-name'
import { useDivisionPolicy } from '@/hooks/useDivisionPolicy'

export type CalendarType = 'meeting' | 'vacation' | 'birthday' | 'other'

interface PickerData {
  users: PickerUser[]
  tags: PickerTag[]
  divisions: Array<{ id: string; name: string; sort_order: number }>
  teams: Array<{ id: string; name: string; division_id: string; sort_order: number }>
  calendars: Array<{ id: string; label: string; calendar_type: CalendarType; division_id: string; team_id: string | null; event_classification?: 'by_type' | 'by_title' }>
  myProfile: {
    userId: string
    email: string | null
    displayName: string | null
    divisionId: string | null
    teamId: string | null
    isAdmin: boolean
  }
}

export interface EventEditInitial {
  id?: string                   // 수정 모드일 때 필수
  title?: string                // 기존 title — 수정 모드에서 본문/토큰 분리 시 사용
  description?: string | null
  location?: string | null
  startAt?: string              // ISO
  endAt?: string                // ISO
  isAllDay?: boolean
  inferredType?: CalendarType
  calendarId?: string
  rrule?: string | null         // RRULE 본문 (Phase 4.4 반복)
  recurringEventId?: string | null  // master id (있으면 이 instance는 반복 시리즈 소속)
}

/** Phase 4.8 — 반복 시리즈에서 수정·삭제 옵션 (Google Calendar 패턴 동일) */
export type RecurrenceMode = 'instance' | 'following' | 'all'

interface EventEditModalProps {
  isCreate: boolean
  initial: EventEditInitial | null
  onClose: () => void
  onSaved: () => void
  /** Phase B — true면 모든 input disabled + 저장/삭제 버튼 숨김. 시트 chip 또는 sheet_only/none mode. */
  readOnly?: boolean
  /**
   * v1.77 — true면 속성 라디오에서 "휴가" 옵션 제거.
   * read_only_calendar 본부 사용자: 휴가는 NPM SoT라 EventEditModal로 등록·수정 차단.
   * 기존 inferred_type='vacation' 이벤트가 수정 모드로 들어와도 휴가 옵션 노출 안 함
   * (단 readOnly=true와 함께 들어오는 시트 chip 케이스는 어차피 input 모두 disabled).
   */
  disableVacationType?: boolean
}

/** 속성 라디오 옵션 — 라벨별 분류 type. 미팅/회의/행사는 모두 meeting(회의 캘린더 prefill). */
const ATTR_OPTIONS: { key: string; label: string; type: CalendarType }[] = [
  { key: 'meeting',    label: '미팅',        type: 'meeting'  },
  { key: 'conference', label: '회의',        type: 'meeting'  },
  { key: 'event',      label: '행사',        type: 'meeting'  },
  { key: 'vacation',   label: '휴가',        type: 'vacation' },
  { key: 'birthday',   label: '생일/기념일', type: 'birthday' },
]

/** 기존 이벤트 inferred_type → 속성 라디오 key 역매핑. meeting/other/미지정 → 미팅. */
function inferredToAttrKey(t: CalendarType | undefined): string {
  if (t === 'vacation') return 'vacation'
  if (t === 'birthday') return 'birthday'
  return 'meeting'
}

const CALENDAR_TYPE_LABEL: Record<CalendarType, string> = {
  meeting: '미팅',
  vacation: '휴가',
  birthday: '생일/기념일',
  other: '기타',
}

function toLocalDate(iso: string | undefined): string {
  // YYYY-MM-DD in KST for input[type=date]
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d)
}

function toLocalTime(iso: string | undefined): string {
  // HH:mm in KST
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(d)
}

// ─── Phase 4.4 / Phase 4.4-ext: 반복(RRULE) Google Calendar 패턴 ─────────────
//
// Google Calendar 단축 7 preset (시작일 의존 동적 label):
//   - 반복 안 함
//   - 매일
//   - 매주 {시작일 요일}            (예: 매주 수요일)
//   - 매월 {n}번째 {시작일 요일}    (예: 매월 3번째 수요일)
//   - 매년 {시작일 월}월 {시작일 일}일 (예: 매년 5월 20일)
//   - 주중 매일 (월-금)
//   - 맞춤... → CustomRecur 모달/inline form
//
// 맞춤 옵션: interval/unit (일/주/월/년), 요일 multi (주만), 종료 (없음/날짜/N회).

export type RecurPreset =
  | 'none'
  | 'daily'
  | 'weekly_same_dow'
  | 'monthly_nth_dow'
  | 'yearly_same_date'
  | 'weekdays'
  | 'custom'

export type RecurUnit = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY'
export type RecurEnd  = 'never' | 'until' | 'count'

export interface CustomRecur {
  unit: RecurUnit
  interval: number              // 1~N
  byday: string[]               // ['MO','WE','FR'] — unit='WEEKLY'일 때만 의미. 비어있으면 시작일 요일
  end: RecurEnd
  until: string                 // YYYY-MM-DD (end='until'일 때)
  count: number                 // (end='count'일 때)
}

export const DEFAULT_CUSTOM_RECUR: CustomRecur = {
  unit: 'WEEKLY', interval: 1, byday: [], end: 'never', until: '', count: 13,
}

const DOWS_ICAL = ['SU','MO','TU','WE','TH','FR','SA'] as const
const DOW_KO    = ['일','월','화','수','목','금','토']
type DowIcal = typeof DOWS_ICAL[number]

function getKstDayParts(date: Date): { year: number; month: number; day: number; weekday: number; nth: number } {
  const k = new Date(date.getTime() + 9 * 3600 * 1000)
  const day = k.getUTCDate()
  return {
    year: k.getUTCFullYear(),
    month: k.getUTCMonth() + 1,
    day,
    weekday: k.getUTCDay(),
    nth: Math.floor((day - 1) / 7) + 1,  // 1~5
  }
}

/** YYYY-MM-DD KST → UTC ISO 그날 23:59:59 (UNTIL은 inclusive). */
function untilKstDateToIcal(yyyymmdd: string): string | null {
  const m = yyyymmdd.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return null
  const y = +m[1], mo = +m[2] - 1, d = +m[3]
  // KST 그날 끝(23:59:59) → UTC 14:59:59
  const ms = Date.UTC(y, mo, d, 23 - 9, 59, 59)
  const dt = new Date(ms)
  // iCal UNTIL 형식: YYYYMMDDTHHMMSSZ
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${dt.getUTCFullYear()}${pad(dt.getUTCMonth()+1)}${pad(dt.getUTCDate())}T${pad(dt.getUTCHours())}${pad(dt.getUTCMinutes())}${pad(dt.getUTCSeconds())}Z`
}

/** iCal UNTIL → KST YYYY-MM-DD */
function icalUntilToKstDate(until: string): string | null {
  // YYYYMMDDTHHMMSSZ
  const m = until.match(/^(\d{4})(\d{2})(\d{2})(T(\d{2})(\d{2})(\d{2})Z)?$/)
  if (!m) return null
  const y = +m[1], mo = +m[2] - 1, d = +m[3]
  const h = m[5] ? +m[5] : 0, mi = m[6] ? +m[6] : 0, s = m[7] ? +m[7] : 0
  // KST 변환
  const ms = Date.UTC(y, mo, d, h, mi, s) + 9 * 3600 * 1000
  const kst = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${kst.getUTCFullYear()}-${pad(kst.getUTCMonth()+1)}-${pad(kst.getUTCDate())}`
}

export function buildRRule(preset: RecurPreset, startAt: Date, custom?: CustomRecur): string | null {
  if (preset === 'none') return null
  const k = getKstDayParts(startAt)
  if (preset === 'daily') return 'FREQ=DAILY'
  if (preset === 'weekly_same_dow')  return `FREQ=WEEKLY;BYDAY=${DOWS_ICAL[k.weekday]}`
  if (preset === 'monthly_nth_dow')  return `FREQ=MONTHLY;BYDAY=${k.nth}${DOWS_ICAL[k.weekday]}`
  if (preset === 'yearly_same_date') return `FREQ=YEARLY;BYMONTH=${k.month};BYMONTHDAY=${k.day}`
  if (preset === 'weekdays')         return 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR'
  if (preset === 'custom') {
    if (!custom) return null
    const parts: string[] = [`FREQ=${custom.unit}`]
    if (custom.interval > 1) parts.push(`INTERVAL=${custom.interval}`)
    if (custom.unit === 'WEEKLY' && custom.byday.length > 0) {
      parts.push(`BYDAY=${custom.byday.join(',')}`)
    }
    if (custom.end === 'until' && custom.until) {
      const u = untilKstDateToIcal(custom.until)
      if (u) parts.push(`UNTIL=${u}`)
    } else if (custom.end === 'count' && custom.count > 0) {
      parts.push(`COUNT=${custom.count}`)
    }
    return parts.join(';')
  }
  return null
}

/**
 * DB rrule 본문 → preset 결정 + custom state 복원.
 * 7 preset의 알려진 패턴이면 그대로, 그 외는 'custom'으로 분류 + custom state도 함께 회수.
 */
export function parseRRule(
  rrule: string | null | undefined,
  startAt: Date,
): { preset: RecurPreset; custom: CustomRecur } {
  const empty: CustomRecur = { ...DEFAULT_CUSTOM_RECUR }
  if (!rrule) return { preset: 'none', custom: empty }
  const r = rrule.replace(/^RRULE:/i, '').trim()
  const k = getKstDayParts(startAt)

  if (r === 'FREQ=DAILY') return { preset: 'daily', custom: empty }

  // 매주 같은 요일 (단일 BYDAY = 시작일 요일)
  const w1 = r.match(/^FREQ=WEEKLY;BYDAY=(SU|MO|TU|WE|TH|FR|SA)$/)
  if (w1 && w1[1] === DOWS_ICAL[k.weekday]) return { preset: 'weekly_same_dow', custom: empty }

  // 주중 매일
  if (/^FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR$/.test(r)) return { preset: 'weekdays', custom: empty }

  // 매월 n번째 같은 요일
  const m1 = r.match(/^FREQ=MONTHLY;BYDAY=(\d)(SU|MO|TU|WE|TH|FR|SA)$/)
  if (m1) {
    const nth = +m1[1]
    const dow = m1[2] as DowIcal
    if (nth === k.nth && dow === DOWS_ICAL[k.weekday]) {
      return { preset: 'monthly_nth_dow', custom: empty }
    }
  }

  // 매년 같은 날짜
  const y1 = r.match(/^FREQ=YEARLY;BYMONTH=(\d{1,2});BYMONTHDAY=(\d{1,2})$/)
  if (y1 && +y1[1] === k.month && +y1[2] === k.day) {
    return { preset: 'yearly_same_date', custom: empty }
  }

  // 그 외 — custom으로 파싱
  const params = new Map<string, string>()
  for (const part of r.split(';')) {
    const eq = part.indexOf('=')
    if (eq > 0) params.set(part.slice(0, eq).toUpperCase(), part.slice(eq + 1))
  }
  const freq = (params.get('FREQ') ?? 'WEEKLY') as RecurUnit
  const interval = +(params.get('INTERVAL') ?? '1') || 1
  const byday = (params.get('BYDAY') ?? '').split(',').map(s => s.trim()).filter(Boolean)
  const until = params.get('UNTIL') ?? ''
  const count = +(params.get('COUNT') ?? '0') || 0
  const custom: CustomRecur = {
    unit: ['DAILY','WEEKLY','MONTHLY','YEARLY'].includes(freq) ? freq : 'WEEKLY',
    interval,
    byday,
    end: until ? 'until' : count ? 'count' : 'never',
    until: until ? (icalUntilToKstDate(until) ?? '') : '',
    count: count || 13,
  }
  return { preset: 'custom', custom }
}

export function recurPresetLabel(preset: RecurPreset, startAt: Date, custom?: CustomRecur): string {
  if (preset === 'none')    return '반복 안 함'
  if (preset === 'daily')   return '매일'
  const k = getKstDayParts(startAt)
  if (preset === 'weekly_same_dow')  return `매주 ${DOW_KO[k.weekday]}요일`
  if (preset === 'monthly_nth_dow')  return `매월 ${k.nth}번째 ${DOW_KO[k.weekday]}요일`
  if (preset === 'yearly_same_date') return `매년 ${k.month}월 ${k.day}일`
  if (preset === 'weekdays')         return '주중 매일(월-금)'
  if (preset === 'custom') {
    if (!custom) return '맞춤...'
    const unit = custom.unit === 'DAILY' ? '일' : custom.unit === 'WEEKLY' ? '주' : custom.unit === 'MONTHLY' ? '개월' : '년'
    const interval = custom.interval > 1 ? `${custom.interval}` : '매'
    let s = `${interval}${unit}`
    if (custom.unit === 'WEEKLY' && custom.byday.length > 0) {
      const koDays = custom.byday.map(b => DOW_KO[DOWS_ICAL.indexOf(b as DowIcal)]).filter(Boolean).join(',')
      s += ` ${koDays}요일`
    }
    if (custom.end === 'until' && custom.until)        s += ` (${custom.until}까지)`
    else if (custom.end === 'count' && custom.count)   s += ` (${custom.count}회)`
    return s
  }
  return ''
}

/** title에서 "[토큰들] 본문" 분리. 토큰들 매핑해서 PickerToken[] 만들기 어려우니 본문만 잘라냄. */
function splitTitleBody(title: string): string {
  const m = title.match(/^\s*\[[^\]]+\]\s*(.*)$/)
  return m ? m[1] : title
}

/** title에서 "[토큰들]" 부분만 추출. 콤마/공백 splits → 각 토큰 문자열 배열 */
function extractTitleTokenStrings(title: string): string[] {
  const m = title.match(/^\s*\[([^\]]+)\]/)
  if (!m) return []
  return m[1]
    .split(/[,+&·\/]/)
    .map(s => s.trim())
    .filter(s => s.length > 0)
}

/**
 * 수정 모드에서 title의 [토큰들]을 실제 PickerToken[]으로 복원.
 *
 * 매칭 규칙 (v1.83.22 — 팀 우선순위 + 매칭 실패 시 name kind 토큰):
 *   1) users에서 풀네임 정확 매칭
 *   2) users에서 마지막 2글자 suffix 일치:
 *      2-1) 캘린더의 팀과 같은 user 우선 (다른 팀 동명이인 제외)
 *      2-2) 같은 팀 0건 → 같은 본부 user
 *      2-3) 본부도 0건 → 모두 매칭 (fallback)
 *   3) tags에서 label 정확 매칭 (event의 calendar 본부 우선 + 그 안에서 team 우선)
 *   4) tags에서 alias_patterns 포함 (동일 우선순위)
 *   5) 모두 실패 → kind='name' 텍스트 토큰 (사용자에게 그대로 보존)
 */
function reconstructTokens(
  title: string,
  users: PickerUser[],
  tags: PickerTag[],
  eventCalendarDivisionId: string | null,
  eventCalendarTeamId: string | null,
  /** v1.83.22 — suffix 매칭 시 팀/본부 비교용 (id가 아닌 name 비교 — PickerUser가 name만 가짐) */
  eventCalendarDivisionName: string | null,
  eventCalendarTeamName: string | null,
): PickerToken[] {
  const tokenStrs = extractTitleTokenStrings(title)
  if (tokenStrs.length === 0) return []

  // suffix → users[] map
  const suffixToUsers = new Map<string, PickerUser[]>()
  const nameToUsers   = new Map<string, PickerUser[]>()
  for (const u of users) {
    const name = (u.display_name ?? '').trim()
    if (!name) continue
    const list = nameToUsers.get(name) ?? []
    list.push(u)
    nameToUsers.set(name, list)
    if (name.length >= 2) {
      const sfx = name.slice(-2)
      const slist = suffixToUsers.get(sfx) ?? []
      slist.push(u)
      suffixToUsers.set(sfx, slist)
    }
  }

  // 같은 division 우선, 같은 team 우선 — tag 점수 함수
  const tagScore = (t: PickerTag): number => {
    let s = 0
    if (t.division_id === eventCalendarDivisionId) s += 10
    if (t.team_id === eventCalendarTeamId) s += 5
    return s
  }

  const out: PickerToken[] = []
  const addedKeys = new Set<string>()

  const pushUser = (u: PickerUser, label?: string) => {
    const key = `user:${u.email.toLowerCase()}`
    if (addedKeys.has(key)) return
    addedKeys.add(key)
    out.push({ kind: 'user', key, label: label ?? (u.display_name ?? u.email), email: u.email })
  }
  const pushTag = (t: PickerTag) => {
    const key = `tag:${t.id}`
    if (addedKeys.has(key)) return
    addedKeys.add(key)
    out.push({ kind: 'tag', key, label: t.label, tagId: t.id })
  }
  // v1.83.22 — 매칭 실패 토큰을 name kind로 보존
  const pushName = (label: string) => {
    const key = `name:${label}`
    if (addedKeys.has(key)) return
    addedKeys.add(key)
    out.push({ kind: 'name', key, label })
  }

  for (const tok of tokenStrs) {
    // 1) 풀네임
    const fullMatch = nameToUsers.get(tok)
    if (fullMatch && fullMatch.length > 0) {
      for (const u of fullMatch) pushUser(u)
      continue
    }
    // 2) suffix (2글자 토큰) — v1.83.22 팀/본부 우선순위
    if (tok.length >= 2) {
      const sfxMatch = suffixToUsers.get(tok.length === 2 ? tok : tok.slice(-2))
      if (sfxMatch && sfxMatch.length > 0) {
        // 같은 팀 user 우선 → 같은 본부 → fallback 모두
        const sameTeam = eventCalendarTeamName
          ? sfxMatch.filter(u => (u.team ?? '') === eventCalendarTeamName)
          : []
        const sameDiv = eventCalendarDivisionName
          ? sfxMatch.filter(u => (u.division ?? '') === eventCalendarDivisionName)
          : []
        const target = sameTeam.length > 0 ? sameTeam
                     : sameDiv.length > 0 ? sameDiv
                     : sfxMatch  // 본부도 0이면 매우 드문 케이스 — 모두 매칭 fallback
        for (const u of target) pushUser(u)
        continue
      }
    }
    // 3) tag — label 정확. 동일 label 여러 division/team이면 점수 가장 높은 것
    const tagLabelMatches = tags.filter(t => t.label === tok)
    if (tagLabelMatches.length > 0) {
      tagLabelMatches.sort((a, b) => tagScore(b) - tagScore(a))
      pushTag(tagLabelMatches[0])
      continue
    }
    // 4) tag alias
    const aliasMatches = tags.filter(t => t.alias_patterns.includes(tok))
    if (aliasMatches.length > 0) {
      aliasMatches.sort((a, b) => tagScore(b) - tagScore(a))
      pushTag(aliasMatches[0])
      continue
    }
    // v1.83.22 — 5) 매칭 실패 → name kind 텍스트 토큰 (사용자에게 노출 + 그대로 저장)
    pushName(tok)
  }
  return out
}

export default function EventEditModal({ isCreate, initial, onClose, onSaved, readOnly = false, disableVacationType = false }: EventEditModalProps) {
  const [data, setData] = useState<PickerData | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // v1.77.2 — readOnly(시트 출처) 모드일 때 본부 시트 URL 노출.
  // 사용자가 "어디서 수정?" 헷갈리지 않게 모달에서 시트로 바로 갈 수 있는 액션 제공.
  const policy = useDivisionPolicy()

  // form state
  const [tokens, setTokens] = useState<PickerToken[]>([])
  // 속성 옵션 — 미팅/회의/행사는 모두 회의(meeting)로 분류·prefill. 휴가→vacation, 생일/기념일→birthday.
  // inferred_type enum은 meeting/vacation/birthday/other 4개라 회의성 3개는 meeting으로 저장되지만,
  // 사용자가 일정 성격을 선택할 수 있게 UI 옵션으로 제공.
  const [attrKey, setAttrKey] = useState<string>(inferredToAttrKey(initial?.inferredType))
  const inferredType: CalendarType = ATTR_OPTIONS.find(o => o.key === attrKey)?.type ?? 'meeting'
  const [body, setBody] = useState<string>(initial?.title ? splitTitleBody(initial.title) : '')
  const [isAllDay, setIsAllDay] = useState(initial?.isAllDay ?? false)
  const [startDate, setStartDate] = useState(toLocalDate(initial?.startAt) || toLocalDate(new Date().toISOString()))
  const [startTime, setStartTime] = useState(toLocalTime(initial?.startAt) || '10:00')
  const [endDate, setEndDate] = useState(toLocalDate(initial?.endAt) || toLocalDate(new Date().toISOString()))
  const [endTime, setEndTime] = useState(toLocalTime(initial?.endAt) || '11:00')
  const [calendarId, setCalendarId] = useState<string>(initial?.calendarId ?? '')
  const [userTouchedCalendar, setUserTouchedCalendar] = useState(false)
  const [description, setDescription] = useState<string>(initial?.description ?? '')
  const [location, setLocation] = useState<string>(initial?.location ?? '')
  // Phase 4.8 — 반복 시리즈 수정/삭제 옵션 confirm modal
  const isRecurringInstance = !isCreate && !!initial?.recurringEventId
  const [recurrenceConfirm, setRecurrenceConfirm] = useState<null | { action: 'submit' | 'delete'; mode: RecurrenceMode }>(null)

  // 반복(RRULE) — 수정 모드면 initial.rrule 파싱해 preset/custom state 복원
  const [recurPreset, setRecurPreset] = useState<RecurPreset>(() => {
    const startGuess = new Date(initial?.startAt ?? Date.now())
    return parseRRule(initial?.rrule ?? null, startGuess).preset
  })
  const [customRecur, setCustomRecur] = useState<CustomRecur>(() => {
    const startGuess = new Date(initial?.startAt ?? Date.now())
    const parsed = parseRRule(initial?.rrule ?? null, startGuess).custom
    // weekly + byday 비어있으면 시작일 요일을 default 채움
    if (parsed.unit === 'WEEKLY' && parsed.byday.length === 0) {
      const k = new Date(startGuess.getTime() + 9 * 3600 * 1000)
      const DOWS = ['SU','MO','TU','WE','TH','FR','SA']
      parsed.byday = [DOWS[k.getUTCDay()]]
    }
    return parsed
  })

  // picker data fetch
  useEffect(() => {
    const ac = new AbortController()
    ;(async () => {
      try {
        const res = await fetch('/api/calendar/picker-data', { cache: 'no-store', signal: ac.signal })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const json = await res.json() as PickerData
        setData(json)
        // 초기 본인 토큰: 생성 모드에서 tokens 비어있으면 본인 default.
        // v1.83 — 본인 라벨은 extractFirstName(성 trim) 우선 적용.
        //         실패 시 userShortLabel fallback(suffix unique 검사).
        //         사유: 본인 일정은 동명이인 충돌 무관하게 짧은 first-name이 자연스러움.
        if (isCreate && tokens.length === 0 && json.myProfile.email && json.myProfile.displayName) {
          const sfxCount = buildSuffixCount(json.users)
          const firstName = extractFirstName(json.myProfile.displayName)
          const label = firstName || userShortLabel(json.myProfile.displayName, json.myProfile.email, sfxCount)
          setTokens([{
            kind: 'user',
            key: `user:${json.myProfile.email.toLowerCase()}`,
            label,
            email: json.myProfile.email,
          }])
        }
        // 수정 모드: title의 [토큰들] 부분을 PickerToken[]으로 복원
        if (!isCreate && tokens.length === 0 && initial?.title) {
          // event의 캘린더 division/team 식별 — tag 매칭 점수 + suffix 동명이인 팀 우선순위에 사용
          const evCal = json.calendars.find(c => c.id === initial.calendarId)
          // v1.83.22 — division/team 이름도 lookup (PickerUser는 name 보유)
          const evDivName = evCal ? (json.divisions.find(d => d.id === evCal.division_id)?.name ?? null) : null
          const evTeamName = evCal?.team_id
            ? (json.teams.find(t => t.id === evCal.team_id)?.name ?? null)
            : null
          const reconstructed = reconstructTokens(
            initial.title,
            json.users,
            json.tags,
            evCal?.division_id ?? null,
            evCal?.team_id ?? null,
            evDivName,
            evTeamName,
          )
          if (reconstructed.length > 0) setTokens(reconstructed)
        }
      } catch (err) {
        if ((err as Error).name === 'AbortError') return
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setLoading(false)
      }
    })()
    return () => ac.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // calendar prefill 자동 — type + tokens의 첫 tag/user 팀 기준.
  //
  // 정책 (2026-05-20 사용자 명시, 본부별 mapping은 추후 확장):
  //   - meeting · other  →  팀별 회의 캘린더 (calendar_type='meeting', team_id=targetTeamId)
  //   - vacation         →  팀별 휴가 캘린더 (calendar_type='vacation', team_id=targetTeamId)
  //   - birthday         →  본부 생일/기념일 캘린더 (calendar_type='birthday', team_id=null)
  //
  // 매칭 실패 시 fallback: 본부 안 같은 type → 본부 안 첫 캘린더 → 전체 첫 캘린더.
  useEffect(() => {
    if (!data) return
    if (userTouchedCalendar) return
    if (!isCreate && initial?.calendarId) return  // 수정 모드는 기존 캘린더 유지

    // 후보 팀 결정: tokens 중 첫 tag의 team_id, 없으면 사용자 본인 teamId
    let targetTeamId: string | null = null
    let targetDivisionId: string | null = null
    for (const t of tokens) {
      if (t.kind === 'tag') {
        const tag = data.tags.find(x => x.id === t.tagId)
        if (tag) { targetTeamId = tag.team_id; targetDivisionId = tag.division_id; break }
      }
    }
    if (!targetDivisionId) {
      targetDivisionId = data.myProfile.divisionId
      targetTeamId = data.myProfile.teamId
    }
    if (!targetDivisionId) return

    // type → 매핑 rule
    const targetCalType: CalendarType = inferredType === 'other' ? 'meeting' : inferredType
    const scopeIsDivision = inferredType === 'birthday'  // 본부 공용으로

    const inDiv = data.calendars.filter(c => c.division_id === targetDivisionId)

    let pick: typeof data.calendars[number] | undefined

    // 0) 통합형(by_title) 캘린더 우선 — 한 캘린더에 휴가·미팅 다 쌓는 팀/본부.
    //    v1.79.1 (2026-06-14) — 팀/본부 공용 분기 분리:
    //      - 팀 일정(targetTeamId 있음): 팀 by_title + calendar_type 일치 시만. 본부 공용 fallback
    //        하지 않음 (팀 일정인데 본부 공용으로 떨어지는 문제 fix).
    //      - 본부 직속 일정(targetTeamId === null): 본부 공용 by_title 매칭 (calendar_type 무관 —
    //        HR임팩트본부 공용처럼 본부 직속이 회의·휴가 모두 받는 통합형 운영 지원).
    //    팀에 by_title 캘린더가 없으면 0순위 skip → 1순위(정확 type 매칭)로 자연스럽게 진행.
    //    (생일은 본부 공용 별도라 0순위 skip)
    if (!scopeIsDivision && targetTeamId) {
      pick = inDiv.find(c => c.team_id === targetTeamId && c.event_classification === 'by_title' && c.calendar_type === targetCalType)
    } else if (!scopeIsDivision && !targetTeamId) {
      pick = inDiv.find(c => c.team_id === null && c.event_classification === 'by_title')
    }

    if (!pick && scopeIsDivision) {
      // 1) 본부 공용 (team_id null) + 정확 type
      pick = inDiv.find(c => c.team_id === null && c.calendar_type === targetCalType)
      // 2) fallback: 팀 + 정확 type
      if (!pick && targetTeamId) {
        pick = inDiv.find(c => c.team_id === targetTeamId && c.calendar_type === targetCalType)
      }
    } else if (!pick && targetTeamId) {
      // 1) 팀 + 정확 type
      pick = inDiv.find(c => c.team_id === targetTeamId && c.calendar_type === targetCalType)
      // 2) fallback: 본부 공용 + 정확 type
      if (!pick) pick = inDiv.find(c => c.team_id === null && c.calendar_type === targetCalType)
    }

    // 3) 마지막 fallback: 본부 내 같은 type → 본부 내 첫 → 전체 첫
    if (!pick) pick = inDiv.find(c => c.calendar_type === targetCalType)
    if (!pick) pick = inDiv[0]
    if (!pick) pick = data.calendars[0]

    if (pick) setCalendarId(pick.id)
  }, [data, tokens, inferredType, isCreate, initial, userTouchedCalendar])

  const titlePreview = useMemo(() => {
    if (tokens.length === 0) return body || '(제목 없음)'
    // v1.83.24 — 저장될 title은 user token의 풀네임에서 성을 제거 (예: 정진성 → 진성).
    // 화면 chip은 동명이인 구별 위해 풀네임 유지하지만, 구글캘린더로 push되는 title에는 first-name만.
    const userByEmail = new Map<string, PickerUser>()
    for (const u of data?.users ?? []) userByEmail.set(u.email.toLowerCase(), u)
    const tokenStr = tokens.map(t => {
      if (t.kind === 'user') {
        const full = (userByEmail.get(t.email.toLowerCase())?.display_name ?? '').trim()
        return full ? extractFirstName(full) : t.label
      }
      return t.label
    }).join(', ')
    return `[${tokenStr}] ${body}`.trim()
  }, [tokens, body, data])

  const calendarOptions = useMemo(() => {
    if (!data) return []
    // 본부별 그룹 + label 표시
    const divName = new Map(data.divisions.map(d => [d.id, d.name]))
    const teamName = new Map(data.teams.map(t => [t.id, t.name]))
    return data.calendars.map(c => ({
      value: c.id,
      label: `${divName.get(c.division_id) ?? ''} · ${c.team_id ? teamName.get(c.team_id) : '본부 공용'} — ${c.label}`,
    }))
  }, [data])

  const handleSubmit = async () => {
    if (!data) return
    setError(null)

    const title = titlePreview
    if (!title || title === '(제목 없음)') {
      return setError('본문 또는 토큰이 1개 이상 필요')
    }
    if (!calendarId) return setError('캘린더 선택 필요')

    // Phase 4.8 — 반복 시리즈 instance면 confirm modal 띄우고 mode 받기
    if (isRecurringInstance && !recurrenceConfirm) {
      setRecurrenceConfirm({ action: 'submit', mode: 'instance' })
      return
    }

    // 시간 ISO 합성 (KST 기준)
    let startIso: string
    let endIso: string
    if (isAllDay) {
      // 종일 — KST 자정. end는 종일 마지막 날의 다음 날 자정(exclusive). 우리는 단일 일 기본.
      // 사용자가 end_date를 명시적으로 다음날까지 지정하면 그대로.
      // 종일 1일 = start_date 00:00 KST ~ start_date+1 00:00 KST (Google iCal 표준).
      if (!startDate) return setError('시작일 필요')
      const endDay = endDate && endDate >= startDate ? endDate : startDate
      const [sy, sm, sd] = startDate.split('-').map(Number)
      const [ey, em, ed] = endDay.split('-').map(Number)
      // KST 자정 → UTC 변환
      startIso = new Date(Date.UTC(sy, sm - 1, sd, -9, 0, 0)).toISOString()
      // end는 exclusive → 다음날 자정
      endIso = new Date(Date.UTC(ey, em - 1, ed + 1, -9, 0, 0)).toISOString()
    } else {
      if (!startDate || !startTime || !endDate || !endTime) return setError('일자/시간 필요')
      const [sy, sm, sd] = startDate.split('-').map(Number)
      const [sh, smi] = startTime.split(':').map(Number)
      const [ey, em, ed] = endDate.split('-').map(Number)
      const [eh, emi] = endTime.split(':').map(Number)
      startIso = new Date(Date.UTC(sy, sm - 1, sd, sh - 9, smi, 0)).toISOString()
      endIso = new Date(Date.UTC(ey, em - 1, ed, eh - 9, emi, 0)).toISOString()
    }

    if (new Date(startIso) >= new Date(endIso)) {
      return setError('시작이 종료보다 빨라야 합니다')
    }

    // RRULE 결정 — 'custom'은 customRecur state에서 build, 그 외 preset은 startAt 기반.
    const rrulePayload: string | null = recurPreset === 'custom'
      ? buildRRule('custom', new Date(startIso), customRecur)
      : buildRRule(recurPreset, new Date(startIso))

    setSaving(true)
    try {
      const url = isCreate ? '/api/calendar/events' : `/api/calendar/events/${initial!.id}`
      const method = isCreate ? 'POST' : 'PATCH'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          calendarId,
          title,
          description: description || null,
          location: location || null,
          startAt: startIso,
          endAt: endIso,
          isAllDay,
          inferredType,
          rrule: rrulePayload,
          recurrenceMode: recurrenceConfirm?.mode ?? 'all',
        }),
        cache: 'no-store',
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`)
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (isCreate || !initial?.id) return

    // Phase 4.8 — 반복 시리즈 instance면 confirm modal로 mode 받기
    if (isRecurringInstance && !recurrenceConfirm) {
      setRecurrenceConfirm({ action: 'delete', mode: 'instance' })
      return
    }
    if (!isRecurringInstance) {
      if (!confirm('이 일정을 삭제하시겠습니까? Google Calendar에도 함께 삭제됩니다.')) return
    }

    setSaving(true)
    setError(null)
    try {
      const mode = recurrenceConfirm?.mode ?? 'all'
      const res = await fetch(`/api/calendar/events/${initial.id}?mode=${mode}`, {
        method: 'DELETE', cache: 'no-store',
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`)
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-3">
      <div className="relative bg-surface rounded-[10px] shadow-xl max-w-2xl w-full max-h-[92vh] flex flex-col">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold text-text-primary">
              {isCreate ? '새 일정 등록' : readOnly ? '일정 보기' : '일정 수정'}
            </h2>
            {readOnly && (
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-warning-bg text-warning-text border border-warning-border">
                외부 시트 — 보기 전용
              </span>
            )}
          </div>
          <button type="button" onClick={onClose} className="text-text-secondary hover:text-text-primary" aria-label="닫기">
            <X className="h-4 w-4" />
          </button>
        </div>

        {loading ? (
          <div className="p-8 text-center text-sm text-text-muted">
            <Loader2 className="h-5 w-5 animate-spin inline mr-2" /> 불러오는 중…
          </div>
        ) : !data ? (
          <div className="p-8 text-center text-sm text-danger-text">데이터 로드 실패</div>
        ) : (
          <div className={`flex-1 overflow-y-auto p-4 space-y-3 ${readOnly ? 'pointer-events-none opacity-70 select-text' : ''}`}>
            {/* v1.77.2 — readOnly(시트 출처) 안내: 어디서 수정해야 하는지 본문 상단에서 명시. */}
            {readOnly && (
              <div className="rounded-md border border-warning-border bg-warning-bg/60 px-3 py-2 text-[12px] text-warning-text leading-snug">
                이 일정은 외부 스프레드시트에서 관리됩니다. 수정·삭제는 시트에서 직접 해주세요.
                {policy.sheetUrl && (
                  <span className="block mt-0.5 text-text-muted">
                    하단의 [📊 스프레드시트에서 수정] 버튼을 눌러 시트로 이동하세요.
                  </span>
                )}
              </div>
            )}
            {/* 태그 */}
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1">태그 (사람·그룹)</label>
              <MultiTagPicker
                users={data.users}
                tags={data.tags}
                divisions={data.divisions}
                myProfile={{
                  email: data.myProfile.email,
                  displayName: data.myProfile.displayName,
                  divisionId: data.myProfile.divisionId,
                  teamId: data.myProfile.teamId,
                  teamName: data.teams.find(t => t.id === data.myProfile.teamId)?.name ?? null,
                }}
                value={tokens}
                onChange={setTokens}
              />
            </div>

            {/* 속성 — v1.77: disableVacationType=true(외부 캘린더 모드)면 휴가 옵션 제거 */}
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1">
                속성
                {disableVacationType && (
                  <span className="ml-1.5 text-[10px] font-normal text-text-muted">
                    (휴가는 NPM에서 등록해주세요)
                  </span>
                )}
              </label>
              <div className="inline-flex items-center rounded-[10px] border border-border-strong bg-surface overflow-hidden">
                {ATTR_OPTIONS
                  .filter(o => !disableVacationType || o.key !== 'vacation')
                  .map(o => (
                    <button
                      key={o.key}
                      type="button"
                      onClick={() => setAttrKey(o.key)}
                      className={`h-9 px-3 text-xs font-medium ${attrKey === o.key ? 'bg-primary-600 text-white' : 'text-text-secondary hover:bg-surface-muted'}`}
                    >
                      {o.label}
                    </button>
                  ))}
              </div>
            </div>

            {/* 본문 */}
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1">본문</label>
              <input
                type="text"
                value={body}
                onChange={e => setBody(e.target.value)}
                placeholder="예: 토스 위클리 미팅"
                className="block w-full h-10 px-3 rounded-[10px] border border-border-strong bg-surface text-sm focus:outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20"
              />
              <div className="mt-1 text-[11px] text-text-muted">
                미리보기: <span className="font-medium text-text-primary">{titlePreview}</span>
              </div>
            </div>

            {/* 일정 */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-medium text-text-secondary">일정</label>
                <label className="inline-flex items-center gap-1.5 text-xs text-text-secondary cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isAllDay}
                    onChange={e => setIsAllDay(e.target.checked)}
                    className="h-3.5 w-3.5 rounded border-border-strong"
                  />
                  종일
                </label>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <div className="text-[10px] text-text-muted mb-0.5">시작</div>
                  <div className="flex flex-col gap-1.5">
                    <input
                      type="date"
                      value={startDate}
                      onChange={e => {
                        // v1.61.10 — 시작일 변경 시 종료일 자동 동기화 (역전 방지).
                        // 종료일 == 기존 시작일 또는 종료일 < 새 시작일이면 종료일도 set.
                        const v = e.target.value
                        setStartDate(v)
                        if (v && (endDate === startDate || endDate < v)) {
                          setEndDate(v)
                        }
                      }}
                      className="block w-full h-9 px-2 rounded-[10px] border border-border-strong bg-surface text-sm"
                    />
                    {!isAllDay && (
                      <TimeSelect
                        value={startTime}
                        onChange={(v) => {
                          // v1.61.10 — 시작 시간 변경 시 종료가 시작 이하이면 시작+1h로 자동 조정.
                          // 같은 일자 + 종료 ≤ 새 시작 → 종료 = 시작+1h. 다른 일자면 손대지 않음.
                          setStartTime(v)
                          if (startDate === endDate && endTime <= v) {
                            const [hh, mm] = v.split(':').map(Number)
                            const totalMin = (hh * 60 + mm) + 60  // +1h
                            const newHh = Math.floor(totalMin / 60) % 24
                            const newMm = totalMin % 60
                            const newEnd = `${String(newHh).padStart(2, '0')}:${String(newMm).padStart(2, '0')}`
                            setEndTime(newEnd)
                          }
                        }}
                        minuteStep={30}
                        ariaLabelHour="시작 시"
                        ariaLabelMinute="시작 분"
                      />
                    )}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-text-muted mb-0.5">종료</div>
                  <div className="flex flex-col gap-1.5">
                    <input
                      type="date"
                      value={endDate}
                      onChange={e => setEndDate(e.target.value)}
                      className="block w-full h-9 px-2 rounded-[10px] border border-border-strong bg-surface text-sm"
                    />
                    {!isAllDay && (
                      <TimeSelect
                        value={endTime}
                        onChange={setEndTime}
                        minuteStep={30}
                        ariaLabelHour="종료 시"
                        ariaLabelMinute="종료 분"
                      />
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* 캘린더 선택 */}
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1">저장할 캘린더</label>
              <CustomDropdown
                value={calendarId}
                onChange={(v) => { setCalendarId(v); setUserTouchedCalendar(true) }}
                options={calendarOptions}
                placeholder="캘린더 선택"
                ariaLabel="저장할 캘린더"
              />
              <div className="mt-1 text-[10px] text-text-muted">
                속성 + 태그 팀에 따라 자동 prefill. 필요 시 직접 변경.
              </div>
            </div>

            {/* 반복(RRULE) — Google Calendar 패턴: 7 preset dropdown + 맞춤 inline form */}
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1">반복</label>
              {(() => {
                const startAtForLabel = new Date(startDate ? `${startDate}T00:00:00+09:00` : Date.now())
                const recurOptions = [
                  { value: 'none',              label: '반복 안 함' },
                  { value: 'daily',             label: '매일' },
                  { value: 'weekly_same_dow',   label: recurPresetLabel('weekly_same_dow',   startAtForLabel) },
                  { value: 'monthly_nth_dow',   label: recurPresetLabel('monthly_nth_dow',   startAtForLabel) },
                  { value: 'yearly_same_date',  label: recurPresetLabel('yearly_same_date',  startAtForLabel) },
                  { value: 'weekdays',          label: '주중 매일(월-금)' },
                  { value: 'custom',            label: '맞춤...' },
                ]
                return (
                  <CustomDropdown
                    value={recurPreset}
                    onChange={(v) => setRecurPreset(v as RecurPreset)}
                    options={recurOptions}
                    ariaLabel="반복 설정"
                    placeholder="반복 안 함"
                  />
                )
              })()}
              <div className="mt-1 text-[10px] text-text-muted">
                {recurPreset === 'none'
                  ? '한 번만 발생'
                  : `${recurPresetLabel(recurPreset, new Date(startDate ? `${startDate}T00:00:00+09:00` : Date.now()), customRecur)} — Google Calendar에 반복 일정으로 등록`}
              </div>

              {/* "맞춤" inline form */}
              {recurPreset === 'custom' && (
                <div className="mt-2 p-3 rounded-[10px] border border-border bg-surface-muted/40 space-y-2">
                  {/* 반복 주기 */}
                  <div className="flex items-center gap-2">
                    <label className="text-xs text-text-secondary shrink-0">반복 주기</label>
                    <input
                      type="number"
                      min={1}
                      max={99}
                      value={customRecur.interval}
                      onChange={e => setCustomRecur({ ...customRecur, interval: Math.max(1, Math.min(99, +e.target.value || 1)) })}
                      className="w-16 h-9 px-2 rounded-[10px] border border-border-strong bg-surface text-sm tabular-nums"
                    />
                    <div className="w-24">
                      <CustomDropdown
                        value={customRecur.unit}
                        onChange={(v) => setCustomRecur({ ...customRecur, unit: v as RecurUnit })}
                        options={[
                          { value: 'DAILY', label: '일' },
                          { value: 'WEEKLY', label: '주' },
                          { value: 'MONTHLY', label: '개월' },
                          { value: 'YEARLY', label: '년' },
                        ]}
                        ariaLabel="반복 단위"
                      />
                    </div>
                  </div>

                  {/* 주 단위일 때 요일 multi-select */}
                  {customRecur.unit === 'WEEKLY' && (
                    <div>
                      <div className="text-xs text-text-secondary mb-1">반복 요일</div>
                      <div className="inline-flex gap-1 flex-wrap">
                        {['SU','MO','TU','WE','TH','FR','SA'].map((d, i) => {
                          const checked = customRecur.byday.includes(d)
                          return (
                            <button
                              key={d}
                              type="button"
                              onClick={() => {
                                const next = checked
                                  ? customRecur.byday.filter(x => x !== d)
                                  : [...customRecur.byday, d]
                                setCustomRecur({ ...customRecur, byday: next })
                              }}
                              className={`h-8 w-8 rounded-full text-xs font-medium border ${checked ? 'bg-primary-600 text-white border-primary-600' : 'bg-surface text-text-secondary border-border-strong hover:bg-surface-muted'}`}
                            >
                              {['일','월','화','수','목','금','토'][i]}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )}

                  {/* 종료 */}
                  <div>
                    <div className="text-xs text-text-secondary mb-1">종료</div>
                    <div className="space-y-1.5">
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="radio"
                          checked={customRecur.end === 'never'}
                          onChange={() => setCustomRecur({ ...customRecur, end: 'never' })}
                        />
                        없음
                      </label>
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="radio"
                          checked={customRecur.end === 'until'}
                          onChange={() => setCustomRecur({ ...customRecur, end: 'until' })}
                        />
                        <span>날짜:</span>
                        <input
                          type="date"
                          value={customRecur.until}
                          onChange={e => setCustomRecur({ ...customRecur, end: 'until', until: e.target.value })}
                          className="h-8 px-2 rounded border border-border-strong bg-surface text-sm"
                        />
                      </label>
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="radio"
                          checked={customRecur.end === 'count'}
                          onChange={() => setCustomRecur({ ...customRecur, end: 'count' })}
                        />
                        <span>다음</span>
                        <input
                          type="number"
                          min={1}
                          max={999}
                          value={customRecur.count}
                          onChange={e => setCustomRecur({ ...customRecur, end: 'count', count: Math.max(1, +e.target.value || 1) })}
                          className="w-16 h-8 px-2 rounded border border-border-strong bg-surface text-sm tabular-nums"
                        />
                        <span>회 반복</span>
                      </label>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* 위치 / 메모 */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1">위치 (선택)</label>
                <input
                  type="text"
                  value={location}
                  onChange={e => setLocation(e.target.value)}
                  className="block w-full h-9 px-3 rounded-[10px] border border-border-strong bg-surface text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1">메모 (선택)</label>
                <input
                  type="text"
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  className="block w-full h-9 px-3 rounded-[10px] border border-border-strong bg-surface text-sm"
                />
              </div>
            </div>

            {error && (
              <div className="rounded-[10px] border border-danger-border bg-danger-bg p-3 text-sm text-danger-text">
                {error}
              </div>
            )}
          </div>
        )}

        <div className="px-4 py-3 border-t border-border flex items-center justify-between gap-2">
          {!isCreate && !readOnly ? (
            <button
              type="button"
              onClick={handleDelete}
              disabled={saving}
              className="h-9 px-3 text-sm rounded-[10px] border border-danger-border bg-surface text-danger-text hover:bg-danger-bg disabled:opacity-50 inline-flex items-center gap-1"
            >
              <Trash2 className="h-4 w-4" /> 삭제
            </button>
          ) : readOnly && policy.sheetUrl ? (
            // v1.77.2 — 시트 출처 일정은 시트에서만 수정 가능. 모달에서 바로 시트로 이동.
            <a
              href={policy.sheetUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="h-9 px-3 text-sm rounded-[10px] border border-warning-border bg-warning-bg text-warning-text hover:bg-warning-bg/80 inline-flex items-center gap-1 font-medium"
              title="외부 스프레드시트에서 일정 수정"
            >
              📊 스프레드시트에서 수정 <ExternalLink className="h-3.5 w-3.5" />
            </a>
          ) : <span />}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="h-9 px-3 text-sm rounded-[10px] border border-border-strong bg-surface text-text-secondary hover:bg-surface-muted disabled:opacity-50"
            >
              {readOnly ? '닫기' : '취소'}
            </button>
            {!readOnly && (
              <button
                type="button"
                onClick={handleSubmit}
                disabled={saving || loading || !data}
                className="h-9 px-4 text-sm font-medium rounded-[10px] bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50 inline-flex items-center gap-1"
              >
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                {isCreate ? '등록' : '저장'}
              </button>
            )}
          </div>
        </div>

        {/* Phase 4.8 — 반복 시리즈 수정·삭제 3옵션 confirm modal */}
        {recurrenceConfirm && (
          <div className="absolute inset-0 z-10 bg-black/40 flex items-center justify-center p-3" onClick={() => setRecurrenceConfirm(null)}>
            <div className="bg-surface rounded-[10px] shadow-xl w-80 p-4" onClick={e => e.stopPropagation()}>
              <h3 className="text-sm font-semibold text-text-primary mb-3">
                {recurrenceConfirm.action === 'delete' ? '반복 일정 삭제' : '반복 일정 수정'}
              </h3>
              <div className="space-y-2 mb-4">
                {([
                  { v: 'instance',  label: '이 일정' },
                  { v: 'following', label: '이 일정 및 향후 일정' },
                  { v: 'all',       label: '모든 일정' },
                ] as Array<{ v: RecurrenceMode; label: string }>).map(opt => (
                  <label key={opt.v} className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="radio"
                      name="recurrenceMode"
                      checked={recurrenceConfirm.mode === opt.v}
                      onChange={() => setRecurrenceConfirm({ ...recurrenceConfirm, mode: opt.v })}
                    />
                    {opt.label}
                  </label>
                ))}
              </div>
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setRecurrenceConfirm(null)}
                  disabled={saving}
                  className="h-9 px-3 text-sm rounded-[10px] border border-border-strong bg-surface text-text-secondary hover:bg-surface-muted disabled:opacity-50"
                >
                  취소
                </button>
                <button
                  type="button"
                  onClick={() => {
                    // confirm 상태는 유지된 채로 handleSubmit/Delete 재호출 — 그쪽에서 mode를 읽음
                    if (recurrenceConfirm.action === 'submit') {
                      void handleSubmit()
                    } else {
                      void handleDelete()
                    }
                  }}
                  disabled={saving}
                  className="h-9 px-4 text-sm font-medium rounded-[10px] bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50 inline-flex items-center gap-1"
                >
                  {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                  확인
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
