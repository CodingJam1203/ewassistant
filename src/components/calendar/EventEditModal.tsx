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
import { X, Loader2, Trash2 } from 'lucide-react'
import CustomDropdown from '@/components/ui/CustomDropdown'
import TimeSelect from '@/components/TimeSelect'
import MultiTagPicker, { buildSuffixCount, userShortLabel, type PickerToken, type PickerUser, type PickerTag } from './MultiTagPicker'

type CalendarType = 'meeting' | 'vacation' | 'birthday' | 'other'

interface PickerData {
  users: PickerUser[]
  tags: PickerTag[]
  divisions: Array<{ id: string; name: string; sort_order: number }>
  teams: Array<{ id: string; name: string; division_id: string; sort_order: number }>
  calendars: Array<{ id: string; label: string; calendar_type: CalendarType; division_id: string; team_id: string | null }>
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
}

interface EventEditModalProps {
  isCreate: boolean
  initial: EventEditInitial | null
  onClose: () => void
  onSaved: () => void
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

// ─── Phase 4.4 반복(RRULE) Simple preset ─────────────────────────────────────
//
// 4 preset: 없음 / 매일 / 매주 (시작일 같은 요일) / 매월 (시작일 같은 일자).
// 더 복잡한 RRULE(UNTIL/COUNT/BYSETPOS 등)은 후속.
// "custom"은 우리가 만든 게 아니라 외부에서 들어온 복잡한 RRULE — 변경 시 강제 reset 차단을
// 위해 별도 카테고리로 표시. 사용자가 preset 선택 시 그 RRULE은 덮어쓰임.

type RecurPreset = 'none' | 'daily' | 'weekly' | 'monthly' | 'custom'

const DOWS_ICAL = ['SU','MO','TU','WE','TH','FR','SA'] as const
const DOW_KO    = ['일','월','화','수','목','금','토']

function getKstDayParts(date: Date): { day: number; weekday: number } {
  const k = new Date(date.getTime() + 9 * 3600 * 1000)
  return { day: k.getUTCDate(), weekday: k.getUTCDay() }
}

function buildRRule(preset: RecurPreset, startAt: Date): string | null {
  if (preset === 'none' || preset === 'custom') return null
  if (preset === 'daily') return 'FREQ=DAILY'
  const { day, weekday } = getKstDayParts(startAt)
  if (preset === 'weekly') return `FREQ=WEEKLY;BYDAY=${DOWS_ICAL[weekday]}`
  if (preset === 'monthly') return `FREQ=MONTHLY;BYMONTHDAY=${day}`
  return null
}

/** DB rrule 본문 → preset 종류 + 자연어 미리보기 */
function parseRRule(rrule: string | null | undefined, startAt: Date): { preset: RecurPreset; preview: string } {
  if (!rrule) return { preset: 'none', preview: '반복 없음' }
  const r = rrule.replace(/^RRULE:/i, '').trim()
  if (r === 'FREQ=DAILY') return { preset: 'daily', preview: '매일' }
  const w = r.match(/^FREQ=WEEKLY;BYDAY=(SU|MO|TU|WE|TH|FR|SA)$/)
  if (w) {
    const idx = DOWS_ICAL.indexOf(w[1] as typeof DOWS_ICAL[number])
    return { preset: 'weekly', preview: `매주 ${DOW_KO[idx]}요일` }
  }
  const m = r.match(/^FREQ=MONTHLY;BYMONTHDAY=(\d{1,2})$/)
  if (m) return { preset: 'monthly', preview: `매월 ${m[1]}일` }
  // 그 외 — 외부에서 들어온 복잡한 RRULE. 사용자가 preset 바꾸면 단순화됨.
  return { preset: 'custom', preview: `사용자 정의 (${r})` }
}

function recurPresetPreview(preset: RecurPreset, startAt: Date): string {
  if (preset === 'none')    return '반복 없음'
  if (preset === 'daily')   return '매일'
  if (preset === 'weekly')  { const { weekday } = getKstDayParts(startAt); return `매주 ${DOW_KO[weekday]}요일` }
  if (preset === 'monthly') { const { day } = getKstDayParts(startAt); return `매월 ${day}일` }
  return '사용자 정의'
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
 * 매칭 규칙 (사람 우선):
 *   1) users에서 풀네임 정확 매칭 (예: "김재민" → 그 user)
 *   2) users에서 마지막 2글자 suffix 일치 — suffix가 unique이면 그 user 단독, 충돌이면 모두 추가
 *   3) tags에서 label 정확 매칭 (event의 calendar 본부 우선 + 그 안에서 team 우선)
 *   4) tags에서 alias_patterns 포함 (동일 우선순위)
 *
 * 매칭 못 한 토큰은 무시 (사용자가 다시 손으로 추가).
 */
function reconstructTokens(
  title: string,
  users: PickerUser[],
  tags: PickerTag[],
  eventCalendarDivisionId: string | null,
  eventCalendarTeamId: string | null,
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

  for (const tok of tokenStrs) {
    // 1) 풀네임
    const fullMatch = nameToUsers.get(tok)
    if (fullMatch && fullMatch.length > 0) {
      for (const u of fullMatch) pushUser(u)
      continue
    }
    // 2) suffix (2글자 토큰)
    if (tok.length >= 2) {
      const sfxMatch = suffixToUsers.get(tok.length === 2 ? tok : tok.slice(-2))
      if (sfxMatch && sfxMatch.length > 0) {
        for (const u of sfxMatch) pushUser(u)
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
    // 그 외 — 매칭 실패. 무시.
  }
  return out
}

export default function EventEditModal({ isCreate, initial, onClose, onSaved }: EventEditModalProps) {
  const [data, setData] = useState<PickerData | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // form state
  const [tokens, setTokens] = useState<PickerToken[]>([])
  const [inferredType, setInferredType] = useState<CalendarType>(initial?.inferredType ?? 'meeting')
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
  // 반복(RRULE) — 수정 모드면 initial.rrule 파싱해 preset 복원
  const [recurPreset, setRecurPreset] = useState<RecurPreset>(() => {
    const startGuess = new Date(initial?.startAt ?? Date.now())
    return parseRRule(initial?.rrule ?? null, startGuess).preset
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
        // 초기 본인 토큰: 생성 모드에서 tokens 비어있으면 본인 default (suffix unique 시 짧은 label).
        if (isCreate && tokens.length === 0 && json.myProfile.email && json.myProfile.displayName) {
          const sfxCount = buildSuffixCount(json.users)
          setTokens([{
            kind: 'user',
            key: `user:${json.myProfile.email.toLowerCase()}`,
            label: userShortLabel(json.myProfile.displayName, json.myProfile.email, sfxCount),
            email: json.myProfile.email,
          }])
        }
        // 수정 모드: title의 [토큰들] 부분을 PickerToken[]으로 복원
        if (!isCreate && tokens.length === 0 && initial?.title) {
          // event의 캘린더 division/team 식별 — tag 매칭 점수에 사용
          const evCal = json.calendars.find(c => c.id === initial.calendarId)
          const reconstructed = reconstructTokens(
            initial.title,
            json.users,
            json.tags,
            evCal?.division_id ?? null,
            evCal?.team_id ?? null,
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
    if (scopeIsDivision) {
      // 1) 본부 공용 (team_id null) + 정확 type
      pick = inDiv.find(c => c.team_id === null && c.calendar_type === targetCalType)
      // 2) fallback: 팀 + 정확 type
      if (!pick && targetTeamId) {
        pick = inDiv.find(c => c.team_id === targetTeamId && c.calendar_type === targetCalType)
      }
    } else if (targetTeamId) {
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
    const tokenStr = tokens.map(t => t.label).join(', ')
    return `[${tokenStr}] ${body}`.trim()
  }, [tokens, body])

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

    // RRULE 결정 — 'custom'은 외부에서 들어온 복잡한 RRULE이므로 사용자가 굳이 다시 손대지 않으면
    // 기존 값 유지. 4 preset은 시작 시각 기반으로 본문 재생성. 'none'은 null.
    const rrulePayload: string | null = recurPreset === 'custom'
      ? (initial?.rrule ?? null)
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
    if (!confirm('이 일정을 삭제하시겠습니까? Google Calendar에도 함께 삭제됩니다.')) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/calendar/events/${initial.id}`, { method: 'DELETE', cache: 'no-store' })
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
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-3" onClick={onClose}>
      <div className="bg-surface rounded-[10px] shadow-xl max-w-2xl w-full max-h-[92vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <h2 className="text-base font-semibold text-text-primary">
            {isCreate ? '새 일정 등록' : '일정 수정'}
          </h2>
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
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
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

            {/* 속성 */}
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1">속성</label>
              <div className="inline-flex items-center rounded-[10px] border border-border-strong bg-surface overflow-hidden">
                {(['meeting','vacation','birthday','other'] as CalendarType[]).map(t => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setInferredType(t)}
                    className={`h-9 px-3 text-xs font-medium ${inferredType === t ? 'bg-primary-600 text-white' : 'text-text-secondary hover:bg-surface-muted'}`}
                  >
                    {CALENDAR_TYPE_LABEL[t]}
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
                      onChange={e => setStartDate(e.target.value)}
                      className="block w-full h-9 px-2 rounded-[10px] border border-border-strong bg-surface text-sm"
                    />
                    {!isAllDay && (
                      <TimeSelect
                        value={startTime}
                        onChange={setStartTime}
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

            {/* 반복(RRULE) Simple preset */}
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1">반복</label>
              <div className="inline-flex flex-wrap items-center rounded-[10px] border border-border-strong bg-surface overflow-hidden">
                {(['none','daily','weekly','monthly'] as RecurPreset[]).map(p => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setRecurPreset(p)}
                    className={`h-9 px-3 text-xs font-medium ${recurPreset === p ? 'bg-primary-600 text-white' : 'text-text-secondary hover:bg-surface-muted'}`}
                  >
                    {p === 'none' ? '없음' : p === 'daily' ? '매일' : p === 'weekly' ? '매주' : '매월'}
                  </button>
                ))}
                {recurPreset === 'custom' && (
                  <span className="h-9 inline-flex items-center px-3 text-xs font-medium bg-amber-50 text-amber-800 border-l border-border-strong">
                    사용자 정의 RRULE
                  </span>
                )}
              </div>
              <div className="mt-1 text-[10px] text-text-muted">
                {recurPreset === 'none'
                  ? '한 번만 발생'
                  : `${recurPresetPreview(recurPreset, new Date(startDate ? `${startDate}T00:00:00+09:00` : Date.now()))} — Google Calendar에 반복 일정으로 등록`}
                {recurPreset === 'custom' && initial?.rrule && (
                  <span className="block mt-0.5">원본 RRULE: <code className="text-[10px]">{initial.rrule}</code></span>
                )}
              </div>
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
          {!isCreate ? (
            <button
              type="button"
              onClick={handleDelete}
              disabled={saving}
              className="h-9 px-3 text-sm rounded-[10px] border border-danger-border bg-surface text-danger-text hover:bg-danger-bg disabled:opacity-50 inline-flex items-center gap-1"
            >
              <Trash2 className="h-4 w-4" /> 삭제
            </button>
          ) : <span />}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="h-9 px-3 text-sm rounded-[10px] border border-border-strong bg-surface text-text-secondary hover:bg-surface-muted disabled:opacity-50"
            >
              취소
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={saving || loading || !data}
              className="h-9 px-4 text-sm font-medium rounded-[10px] bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50 inline-flex items-center gap-1"
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {isCreate ? '등록' : '저장'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
