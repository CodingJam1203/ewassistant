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
import MultiTagPicker, { type PickerToken, type PickerUser, type PickerTag } from './MultiTagPicker'

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

/** title에서 "[토큰들] 본문" 분리. 토큰들 매핑해서 PickerToken[] 만들기 어려우니 본문만 잘라냄. */
function splitTitleBody(title: string): string {
  const m = title.match(/^\s*\[[^\]]+\]\s*(.*)$/)
  return m ? m[1] : title
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

  // picker data fetch
  useEffect(() => {
    const ac = new AbortController()
    ;(async () => {
      try {
        const res = await fetch('/api/calendar/picker-data', { cache: 'no-store', signal: ac.signal })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const json = await res.json() as PickerData
        setData(json)
        // 초기 본인 토큰: 생성 모드에서 toekns 비어있으면 본인 default
        if (isCreate && tokens.length === 0 && json.myProfile.email && json.myProfile.displayName) {
          setTokens([{
            kind: 'user',
            key: `user:${json.myProfile.email.toLowerCase()}`,
            label: json.myProfile.displayName,
            email: json.myProfile.email,
          }])
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

  // calendar prefill 자동 — type + tokens의 첫 tag/user 팀 기준
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

    // 매칭 우선순위: division+team+type → division+team(any type) → division+공용+type → 첫 활성 캘린더
    const pickType = inferredType === 'birthday' ? 'birthday' : inferredType
    const candidates = data.calendars.filter(c => c.division_id === targetDivisionId)
    const pick =
      candidates.find(c => c.team_id === targetTeamId && c.calendar_type === pickType) ??
      candidates.find(c => c.team_id === null && c.calendar_type === pickType) ??
      candidates.find(c => c.team_id === targetTeamId) ??
      candidates[0] ??
      data.calendars[0]
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
                myProfile={data.myProfile}
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
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <div className="text-[10px] text-text-muted mb-0.5">시작</div>
                  <div className="flex items-center gap-1">
                    <input
                      type="date"
                      value={startDate}
                      onChange={e => setStartDate(e.target.value)}
                      className="block w-full h-9 px-2 rounded-[10px] border border-border-strong bg-surface text-sm"
                    />
                    {!isAllDay && (
                      <input
                        type="time"
                        value={startTime}
                        onChange={e => setStartTime(e.target.value)}
                        step={1800}
                        className="block w-28 h-9 px-2 rounded-[10px] border border-border-strong bg-surface text-sm tabular-nums"
                      />
                    )}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-text-muted mb-0.5">종료</div>
                  <div className="flex items-center gap-1">
                    <input
                      type="date"
                      value={endDate}
                      onChange={e => setEndDate(e.target.value)}
                      className="block w-full h-9 px-2 rounded-[10px] border border-border-strong bg-surface text-sm"
                    />
                    {!isAllDay && (
                      <input
                        type="time"
                        value={endTime}
                        onChange={e => setEndTime(e.target.value)}
                        step={1800}
                        className="block w-28 h-9 px-2 rounded-[10px] border border-border-strong bg-surface text-sm tabular-nums"
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
