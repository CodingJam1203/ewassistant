'use client'

/**
 * /calendar — 매트릭스 캘린더 뷰 (Phase 1.3, ABC-217)
 *
 * 행 = 사용자 (division → team → display_order 정렬)
 * 열 = 날짜 (오늘부터 시작, 범위 토글 가능)
 * 셀 = 그 사용자의 그 날 매칭 이벤트들 (시간 + 제목)
 *
 * Apps Script로 채워지던 Google Sheet 매트릭스를 N-Click DB cache로 그대로 reproduce.
 * 데이터 source: org_calendar_events (matched_user_emails로 사용자 매핑).
 *
 * 본부 단위 일정(team_id null인 캘린더 — 회의/생일)은 별도 본부 헤더 행에 표시.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Calendar as CalendarIcon, Loader2, ChevronLeft, ChevronRight, Home } from 'lucide-react'

type CalendarType = 'meeting' | 'vacation' | 'birthday' | 'other'
type RangeView = '1week' | '2weeks' | 'month'

interface ApiEvent {
  id: string
  title: string
  startAt: string
  endAt: string
  isAllDay: boolean
  matchedUserEmails: string[]
  inferredType: CalendarType
  calendarType: CalendarType
  divisionId: string
  divisionName: string
  teamId: string | null
  teamName: string | null
}

interface ApiUser {
  email: string
  displayName: string
  divisionId: string
  divisionName: string
  teamId: string | null
  teamName: string | null
  role: string
}

const TYPE_BG: Record<CalendarType, string> = {
  meeting:  'bg-primary-50 text-primary-700 border-l-2 border-primary-500',
  vacation: 'bg-indigo-50 text-indigo-700 border-l-2 border-indigo-500',
  birthday: 'bg-pink-50 text-pink-700 border-l-2 border-pink-500',
  other:    'bg-surface-muted text-text-secondary border-l-2 border-text-muted',
}

const DIVISION_BG: Record<string, string> = {}  // (생성 시 dynamic)

const RANGE_DAYS: Record<RangeView, number> = { '1week': 7, '2weeks': 14, 'month': 30 }
const RANGE_LABEL: Record<RangeView, string> = { '1week': '1주', '2weeks': '2주', 'month': '한 달' }

function toKstIsoDate(d: Date): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  })
  return fmt.format(d)
}

function kstDateAt(year: number, month: number, day: number): Date {
  // KST 자정을 UTC로 변환
  return new Date(Date.UTC(year, month - 1, day, -9, 0, 0))  // -9시 보정
}

function todayKst(): Date {
  // KST 기준 오늘 자정 (Date 객체로 — 이후 +day 연산 일관성 위해)
  const isoDate = toKstIsoDate(new Date())  // 'YYYY-MM-DD'
  const [y, m, d] = isoDate.split('-').map(Number)
  return kstDateAt(y, m, d)
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86400000)
}

function fmtDayHeader(d: Date): { date: string; dow: string; isToday: boolean; isWeekend: boolean; isSunday: boolean } {
  const dayOfWeek = new Date(d.getTime() + 9 * 3600 * 1000).getUTCDay()  // KST 기준 요일
  const dows = ['일', '월', '화', '수', '목', '금', '토']
  const today = toKstIsoDate(new Date()) === toKstIsoDate(d)
  const md = toKstIsoDate(d).slice(5)  // 'MM-DD'
  return {
    date: md.replace('-', '/'),
    dow: dows[dayOfWeek],
    isToday: today,
    isWeekend: dayOfWeek === 0 || dayOfWeek === 6,
    isSunday: dayOfWeek === 0,
  }
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('ko-KR', {
    timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false,
  })
}

interface EventCellEntry {
  ev: ApiEvent
  displayText: string  // "<종일> 제목" or "<HH:mm~HH:mm> 제목"
}

/** 이벤트가 특정 KST 날짜에 걸치는지 확인 + 표시 텍스트 생성 */
function eventOnDate(ev: ApiEvent, dateIso: string): EventCellEntry | null {
  const dayStartIso = `${dateIso}T00:00:00+09:00`
  const dayEndIso   = `${dateIso}T23:59:59+09:00`
  const dayStart = new Date(dayStartIso).getTime()
  const dayEnd   = new Date(dayEndIso).getTime()
  const evStart = new Date(ev.startAt).getTime()
  const evEnd   = new Date(ev.endAt).getTime()
  // 종일이면 end는 다음 날 자정인 경우 많음 — start ≤ dayEnd && end > dayStart 비교
  if (evStart > dayEnd || evEnd <= dayStart) return null
  const timeLabel = ev.isAllDay
    ? '<종일>'
    : `<${fmtTime(ev.startAt)}~${fmtTime(ev.endAt)}>`
  return {
    ev,
    displayText: `${timeLabel} ${ev.title}`.trim(),
  }
}

export default function CalendarMatrixPage() {
  const [users, setUsers] = useState<ApiUser[]>([])
  const [events, setEvents] = useState<ApiEvent[]>([])
  const [userEmail, setUserEmail] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // 좌측 시작일 (KST 자정). default = 오늘
  const [startDate, setStartDate] = useState<Date>(() => todayKst())
  const [rangeView, setRangeView] = useState<RangeView>('2weeks')

  const days = useMemo(() => {
    const n = RANGE_DAYS[rangeView]
    return Array.from({ length: n }, (_, i) => addDays(startDate, i))
  }, [startDate, rangeView])

  // 이벤트 범위 — 시작일 ~ 종료일
  const range = useMemo(() => ({
    from: toKstIsoDate(days[0]),
    to:   toKstIsoDate(days[days.length - 1]),
  }), [days])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [usersRes, eventsRes] = await Promise.all([
        fetch('/api/calendar/users', { cache: 'no-store' }),
        fetch(`/api/calendar/events?from=${range.from}&to=${range.to}`, { cache: 'no-store' }),
      ])
      if (!usersRes.ok)  throw new Error(`users: HTTP ${usersRes.status}`)
      if (!eventsRes.ok) throw new Error(`events: HTTP ${eventsRes.status}`)
      const usersData  = await usersRes.json()
      const eventsData = await eventsRes.json()
      setUsers(usersData.users ?? [])
      setEvents(eventsData.events ?? [])
      setUserEmail(usersData.userEmail ?? eventsData.userEmail ?? null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [range.from, range.to])

  useEffect(() => { load() }, [load])

  // events를 (user_email + date)로 그룹화 + division 단위 이벤트는 division별 그룹
  const userMatrix = useMemo(() => {
    // map[email][dateIso] = events
    const m = new Map<string, Map<string, EventCellEntry[]>>()
    for (const u of users) {
      m.set(u.email.toLowerCase(), new Map())
    }
    for (const ev of events) {
      for (const day of days) {
        const dateIso = toKstIsoDate(day)
        const entry = eventOnDate(ev, dateIso)
        if (!entry) continue
        for (const em of ev.matchedUserEmails) {
          const userMap = m.get(em.toLowerCase())
          if (!userMap) continue
          const cell = userMap.get(dateIso) ?? []
          cell.push(entry)
          userMap.set(dateIso, cell)
        }
      }
    }
    return m
  }, [users, events, days])

  // 본부 단위 이벤트 (teamId == null인 캘린더의 이벤트) — division별 그룹
  const divisionMatrix = useMemo(() => {
    const m = new Map<string, Map<string, EventCellEntry[]>>()
    for (const ev of events) {
      if (ev.teamId !== null) continue  // 본부 단위만
      for (const day of days) {
        const dateIso = toKstIsoDate(day)
        const entry = eventOnDate(ev, dateIso)
        if (!entry) continue
        const divMap = m.get(ev.divisionId) ?? new Map()
        const cell = divMap.get(dateIso) ?? []
        cell.push(entry)
        divMap.set(dateIso, cell)
        m.set(ev.divisionId, divMap)
      }
    }
    return m
  }, [events, days])

  // 본부별 그룹화 (헤더 + 사용자들)
  const divisionGroups = useMemo(() => {
    const groups = new Map<string, { divisionName: string; users: ApiUser[] }>()
    for (const u of users) {
      const key = u.divisionId || '__none__'
      const g = groups.get(key) ?? { divisionName: u.divisionName, users: [] }
      g.users.push(u)
      groups.set(key, g)
    }
    return Array.from(groups.entries()).map(([id, g]) => ({
      id,
      divisionName: g.divisionName,
      users: g.users,
    }))
  }, [users])

  const handlePrev = () => setStartDate(d => addDays(d, -RANGE_DAYS[rangeView]))
  const handleNext = () => setStartDate(d => addDays(d, +RANGE_DAYS[rangeView]))
  const handleToday = () => setStartDate(todayKst())

  return (
    <div className="max-w-[120rem] mx-auto p-3 sm:p-4 space-y-3">
      <div className="flex items-center gap-3">
        <Link href="/home" className="inline-flex items-center gap-1 text-sm text-text-secondary hover:text-text-primary">
          <ArrowLeft className="h-4 w-4" />
          홈
        </Link>
      </div>

      {/* 헤더 + 범위 컨트롤 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-text-primary flex items-center gap-2">
          <CalendarIcon className="h-5 w-5" /> 본부 캘린더
        </h1>
        <div className="flex flex-wrap items-center gap-2">
          {/* 범위 토글 */}
          <div className="inline-flex items-center rounded-[10px] border border-border-strong bg-surface overflow-hidden">
            {(['1week', '2weeks', 'month'] as RangeView[]).map(r => (
              <button
                key={r}
                type="button"
                onClick={() => setRangeView(r)}
                className={`h-8 px-3 text-xs font-medium transition-colors ${
                  rangeView === r
                    ? 'bg-primary-600 text-white'
                    : 'text-text-secondary hover:bg-surface-muted'
                }`}
              >
                {RANGE_LABEL[r]}
              </button>
            ))}
          </div>
          {/* 날짜 nav */}
          <div className="inline-flex items-center gap-1">
            <button type="button" onClick={handlePrev} className="h-8 w-8 inline-flex items-center justify-center rounded-[10px] border border-border-strong bg-surface hover:bg-surface-muted">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button type="button" onClick={handleToday} className="h-8 px-3 text-xs font-medium inline-flex items-center gap-1 rounded-[10px] border border-border-strong bg-surface hover:bg-surface-muted">
              <Home className="h-3.5 w-3.5" />
              오늘
            </button>
            <button type="button" onClick={handleNext} className="h-8 w-8 inline-flex items-center justify-center rounded-[10px] border border-border-strong bg-surface hover:bg-surface-muted">
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-[10px] border border-danger-border bg-danger-bg p-4 text-sm text-danger-text">
          {error}
        </div>
      )}

      {loading ? (
        <div className="rounded-[10px] border border-border bg-surface p-8 text-center text-sm text-text-muted">
          <Loader2 className="h-5 w-5 animate-spin inline mr-2" />
          불러오는 중…
        </div>
      ) : (
        <div className="bg-surface border border-border rounded-[10px] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[11px]">
              <thead>
                <tr className="bg-surface-muted">
                  <th className="sticky left-0 z-10 bg-surface-muted px-2 py-2 text-left font-semibold text-text-secondary border-r border-border min-w-[70px]">구분</th>
                  <th className="sticky left-[70px] z-10 bg-surface-muted px-2 py-2 text-left font-semibold text-text-secondary border-r border-border min-w-[80px]">인원</th>
                  <th className="sticky left-[150px] z-10 bg-surface-muted px-2 py-2 text-left font-semibold text-text-secondary border-r border-border min-w-[80px]">직급/직책</th>
                  {days.map(d => {
                    const h = fmtDayHeader(d)
                    return (
                      <th
                        key={d.toISOString()}
                        className={`px-2 py-2 text-center font-semibold border-r border-border min-w-[130px] ${
                          h.isToday ? 'bg-primary-50 text-primary-700' :
                          h.isSunday ? 'text-danger-text' :
                          h.isWeekend ? 'text-text-secondary' :
                          'text-text-primary'
                        }`}
                      >
                        {h.date} ({h.dow})
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody>
                {divisionGroups.map((grp, gi) => (
                  <>
                    {/* 본부 단위 이벤트 행 (있을 때만) */}
                    {divisionMatrix.get(grp.id) && (
                      <tr key={`${grp.id}-div`} className="bg-purple-50/40 border-t-2 border-purple-300">
                        <td className="sticky left-0 z-[5] bg-purple-50/80 px-2 py-1.5 font-semibold text-purple-900 border-r border-border align-top">{grp.divisionName}</td>
                        <td className="sticky left-[70px] z-[5] bg-purple-50/80 px-2 py-1.5 text-purple-900 font-semibold border-r border-border align-top">본부</td>
                        <td className="sticky left-[150px] z-[5] bg-purple-50/80 px-2 py-1.5 text-purple-900 border-r border-border align-top">본부 일정</td>
                        {days.map(d => {
                          const dateIso = toKstIsoDate(d)
                          const cell = divisionMatrix.get(grp.id)?.get(dateIso) ?? []
                          return (
                            <td key={dateIso} className="px-1 py-1 border-r border-border align-top">
                              <div className="space-y-0.5">
                                {cell.map((e, i) => (
                                  <div
                                    key={i}
                                    title={e.displayText}
                                    className={`px-1 py-0.5 rounded text-[10px] truncate cursor-default ${TYPE_BG[e.ev.inferredType]}`}
                                  >
                                    {e.displayText}
                                  </div>
                                ))}
                              </div>
                            </td>
                          )
                        })}
                      </tr>
                    )}
                    {/* 사용자 행 */}
                    {grp.users.map((u, ui) => {
                      const isFirstOfTeam = ui === 0 || grp.users[ui - 1].teamId !== u.teamId
                      const isMe = userEmail && u.email.toLowerCase() === userEmail.toLowerCase()
                      return (
                        <tr
                          key={u.email}
                          className={`${gi % 2 === 0 ? 'bg-surface' : 'bg-surface-muted/30'} ${isFirstOfTeam ? 'border-t border-border' : ''}`}
                        >
                          <td className="sticky left-0 z-[5] bg-inherit px-2 py-1 text-text-secondary border-r border-border align-top">
                            {u.teamName ?? grp.divisionName}
                          </td>
                          <td className={`sticky left-[70px] z-[5] bg-inherit px-2 py-1 border-r border-border align-top ${isMe ? 'font-bold text-primary-700' : 'font-medium text-text-primary'}`}>
                            {u.displayName}
                            {isMe && <span className="ml-1 text-[9px] text-primary-600">(나)</span>}
                          </td>
                          <td className="sticky left-[150px] z-[5] bg-inherit px-2 py-1 text-text-secondary border-r border-border align-top text-[10px]">
                            {u.role === 'admin' ? '관리자' : u.role === 'leader' ? '리더' : ''}
                          </td>
                          {days.map(d => {
                            const dateIso = toKstIsoDate(d)
                            const cell = userMatrix.get(u.email.toLowerCase())?.get(dateIso) ?? []
                            return (
                              <td key={dateIso} className="px-1 py-1 border-r border-border align-top">
                                <div className="space-y-0.5">
                                  {cell.map((e, i) => (
                                    <div
                                      key={i}
                                      title={e.displayText}
                                      className={`px-1 py-0.5 rounded text-[10px] truncate cursor-default ${TYPE_BG[e.ev.inferredType]}`}
                                    >
                                      {e.displayText}
                                    </div>
                                  ))}
                                </div>
                              </td>
                            )
                          })}
                        </tr>
                      )
                    })}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 범례 */}
      <div className="flex flex-wrap items-center gap-3 text-[11px] text-text-secondary px-1">
        <span className="font-semibold">범례:</span>
        <span className="inline-flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded-sm bg-primary-50 border-l-2 border-primary-500" />회의</span>
        <span className="inline-flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded-sm bg-indigo-50 border-l-2 border-indigo-500" />휴가</span>
        <span className="inline-flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded-sm bg-pink-50 border-l-2 border-pink-500" />생일·기념일</span>
        <span className="inline-flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded-sm bg-surface-muted border-l-2 border-text-muted" />기타</span>
        <span className="ml-2 text-text-muted">· 오늘 컬럼은 파란 헤더 · 본부 일정은 별도 보라 행 · 셀 호버 시 전체 텍스트</span>
      </div>

      {!loading && !error && (
        <div className="text-xs text-text-muted px-1">
          범위 {range.from} ~ {range.to} · 사용자 {users.length}명 · 이벤트 {events.length}건
        </div>
      )}
    </div>
  )
}
