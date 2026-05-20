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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Calendar as CalendarIcon, Loader2, ChevronLeft, ChevronRight, Home } from 'lucide-react'
import CustomDropdown from '@/components/ui/CustomDropdown'

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
  divisionSort: number
  teamId: string | null
  teamName: string | null
  teamSort: number
  displayOrder: number
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
  timeLabel: string  // "종일" or "HH:mm~HH:mm" — chip 1번째 줄
  title: string      // 이벤트 제목 — chip 2번째 줄 (truncate 대상)
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
    ? '종일'
    : `${fmtTime(ev.startAt)}~${fmtTime(ev.endAt)}`
  return {
    ev,
    timeLabel,
    title: ev.title || '(제목 없음)',
  }
}

interface ApiDivision { id: string; name: string; sortOrder: number }

const ALL_TEAMS = '__ALL__'

export default function CalendarMatrixPage() {
  const [users, setUsers] = useState<ApiUser[]>([])
  const [divisions, setDivisions] = useState<ApiDivision[]>([])
  const [events, setEvents] = useState<ApiEvent[]>([])
  const [userEmail, setUserEmail] = useState<string | null>(null)
  const [myTeamName, setMyTeamName] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // 좌측 시작일 (KST 자정). default = 오늘
  const [startDate, setStartDate] = useState<Date>(() => todayKst())
  const [rangeView, setRangeView] = useState<RangeView>('2weeks')

  // 본부 dropdown — 단일 선택. default = 사용자 본부 (load 응답에서 set)
  const [selectedDivisionId, setSelectedDivisionId] = useState<string>('')
  // 팀 dropdown — 단일 선택. ALL_TEAMS 또는 teamId.
  const [selectedTeamId, setSelectedTeamId] = useState<string>(ALL_TEAMS)
  // 사용자가 직접 팀 dropdown을 변경했는지 추적. true면 자동 default 적용 차단.
  // (본부가 바뀌면 false로 reset — 새 본부에서는 다시 default 적용)
  const userTouchedTeamRef = useRef(false)

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
      setDivisions(usersData.divisions ?? [])
      setEvents(eventsData.events ?? [])
      setUserEmail(usersData.userEmail ?? eventsData.userEmail ?? null)
      setMyTeamName(usersData.myTeamName ?? null)
      // 첫 load 시에만 사용자 본부를 default로 설정. 이후 사용자가 dropdown으로 바꿔도 유지.
      setSelectedDivisionId(prev => {
        if (prev) return prev
        const myDiv = usersData.myDivisionId
        if (myDiv) return myDiv
        // 사용자 본부 정보 없으면 첫 번째 division 선택
        return usersData.divisions?.[0]?.id ?? ''
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [range.from, range.to])

  useEffect(() => { load() }, [load])

  // 선택된 본부의 users / events 1차 필터
  const divUsers = useMemo(() => {
    if (!selectedDivisionId) return users
    return users.filter(u => u.divisionId === selectedDivisionId)
  }, [users, selectedDivisionId])

  const divEvents = useMemo(() => {
    if (!selectedDivisionId) return events
    return events.filter(ev => ev.divisionId === selectedDivisionId)
  }, [events, selectedDivisionId])

  // 팀 dropdown 옵션 — 선택된 본부 안의 teams. users + events 둘 다에서 distinct
  // (사용자 0명일 수도 있어 events도 봐서 팀 추출).
  const teamOptions = useMemo(() => {
    const map = new Map<string, string>()  // teamId → teamName
    for (const u of divUsers) {
      if (u.teamId && u.teamName) map.set(u.teamId, u.teamName)
    }
    for (const ev of divEvents) {
      if (ev.teamId && ev.teamName) map.set(ev.teamId, ev.teamName)
    }
    return Array.from(map.entries()).map(([id, name]) => ({ value: id, label: name }))
  }, [divUsers, divEvents])

  // 본부 dropdown 변경 시 — 그 본부에 내 팀이 속해있으면 그걸로, 아니면 '전체' 자동.
  // (default 정책: 첫 load 시 사용자 본인 본부 + 본인 팀)
  // userTouchedTeamRef.current === true 면 사용자가 의도적으로 팀을 골랐다는 뜻이라
  // 자동 reset 건너뜀 — '전체 팀' 선택이 즉시 내 팀으로 되돌아가던 버그 차단.
  useEffect(() => {
    if (userTouchedTeamRef.current) return
    if (teamOptions.length === 0) {
      setSelectedTeamId(ALL_TEAMS)
      return
    }
    // 내 팀이 이 본부 안에 있으면 자동 선택
    if (myTeamName) {
      const mine = teamOptions.find(t => t.label === myTeamName)
      if (mine) {
        setSelectedTeamId(mine.value)
        return
      }
    }
    // 그 외엔 전체
    setSelectedTeamId(ALL_TEAMS)
  }, [teamOptions, myTeamName])

  // 2차 필터 — selectedTeamId 적용. 본부 단위(team_id null) 이벤트는 항상 포함.
  const filteredUsers = useMemo(() => {
    if (selectedTeamId === ALL_TEAMS) return divUsers
    return divUsers.filter(u => u.teamId === selectedTeamId)
  }, [divUsers, selectedTeamId])

  const filteredEvents = useMemo(() => {
    if (selectedTeamId === ALL_TEAMS) return divEvents
    return divEvents.filter(ev => ev.teamId === selectedTeamId || ev.teamId === null)
  }, [divEvents, selectedTeamId])

  // events를 (user_email + date)로 그룹화 + division 단위 이벤트는 division별 그룹
  const userMatrix = useMemo(() => {
    // map[email][dateIso] = events
    const m = new Map<string, Map<string, EventCellEntry[]>>()
    for (const u of filteredUsers) {
      m.set(u.email.toLowerCase(), new Map())
    }
    for (const ev of filteredEvents) {
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
  }, [filteredUsers, filteredEvents, days])

  // 본부 단위 이벤트 (teamId == null인 캘린더의 이벤트) — division별 그룹
  const divisionMatrix = useMemo(() => {
    const m = new Map<string, Map<string, EventCellEntry[]>>()
    for (const ev of filteredEvents) {
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
  }, [filteredEvents, days])

  // "기타" 행 먼저 정의 — divisionGroups가 이걸 참조
  // 사용자에 매칭 안 된 events. 팀 단위로 1행씩.
  // 본부 단위(team_id null) 일정은 별도 본부 헤더 행에서 처리되므로 여기서는 제외.
  const otherTeamMatrix = useMemo(() => {
    const m = new Map<string, { teamName: string | null; divisionId: string; cells: Map<string, EventCellEntry[]> }>()
    const filteredUserEmails = new Set(filteredUsers.map(u => u.email.toLowerCase()))
    for (const ev of filteredEvents) {
      if (ev.teamId === null) continue
      const matchedHere = ev.matchedUserEmails.some(em => filteredUserEmails.has(em.toLowerCase()))
      if (matchedHere) continue
      for (const day of days) {
        const dateIso = toKstIsoDate(day)
        const entry = eventOnDate(ev, dateIso)
        if (!entry) continue
        const g = m.get(ev.teamId) ?? { teamName: ev.teamName, divisionId: ev.divisionId, cells: new Map<string, EventCellEntry[]>() }
        const cell = g.cells.get(dateIso) ?? []
        cell.push(entry)
        g.cells.set(dateIso, cell)
        m.set(ev.teamId, g)
      }
    }
    return m
  }, [filteredEvents, filteredUsers, days])

  // 본부별 그룹화 → 그 안에서 다시 팀별 sub-group. 캡처 패턴(둘러보기 정렬과 동일):
  //   본부 헤더
  //   팀A: 사용자들 + 기타
  //   ━━ (굵은 구분선)
  //   팀B: 사용자들 + 기타
  // 사용자 0명 본부도 selectedDivisionId 기반 강제 추가 + 기타 행만 노출.
  interface TeamSubGroup {
    teamId: string | null
    teamName: string | null
    users: ApiUser[]
    hasOther: boolean
  }
  interface DivisionGroup {
    id: string
    divisionName: string
    teams: TeamSubGroup[]
  }

  const divisionGroups: DivisionGroup[] = useMemo(() => {
    const map = new Map<string, Map<string | null, ApiUser[]>>()
    const divNames = new Map<string, string>()
    for (const u of filteredUsers) {
      const dKey = u.divisionId || '__none__'
      if (!map.has(dKey)) {
        map.set(dKey, new Map())
        divNames.set(dKey, u.divisionName)
      }
      const teamMap = map.get(dKey)!
      const tKey = u.teamId
      const list = teamMap.get(tKey) ?? []
      list.push(u)
      teamMap.set(tKey, list)
    }
    // selectedDivisionId 본부 그룹이 없으면 추가
    if (selectedDivisionId && !map.has(selectedDivisionId)) {
      const d = divisions.find(dd => dd.id === selectedDivisionId)
      if (d) {
        map.set(selectedDivisionId, new Map())
        divNames.set(selectedDivisionId, d.name)
      }
    }

    // 기타 행이 있는 팀도 본부 그룹에 합쳐 (사용자 없는 팀도 노출)
    for (const [teamId, info] of otherTeamMatrix.entries()) {
      const dKey = info.divisionId
      if (!map.has(dKey)) {
        map.set(dKey, new Map())
        const d = divisions.find(dd => dd.id === dKey)
        if (d) divNames.set(dKey, d.name)
      }
      const teamMap = map.get(dKey)!
      if (!teamMap.has(teamId)) teamMap.set(teamId, [])
    }

    return Array.from(map.entries()).map(([id, teamMap]) => {
      // 팀 정렬: 첫 사용자의 teamSort → teamName. 사용자 0명 팀은 teamName으로
      const teams: TeamSubGroup[] = Array.from(teamMap.entries()).map(([teamId, users]) => ({
        teamId,
        teamName: users[0]?.teamName ?? otherTeamMatrix.get(teamId ?? '')?.teamName ?? null,
        users: users.slice().sort((a, b) => {
          if (a.displayOrder !== b.displayOrder) return a.displayOrder - b.displayOrder
          return a.displayName.localeCompare(b.displayName, 'ko')
        }),
        hasOther: teamId ? otherTeamMatrix.has(teamId) : false,
      }))
      // 팀 정렬 — sort_order(첫 사용자의 teamSort) → teamName
      teams.sort((a, b) => {
        const aSort = a.users[0]?.teamSort ?? 999
        const bSort = b.users[0]?.teamSort ?? 999
        if (aSort !== bSort) return aSort - bSort
        return (a.teamName ?? '').localeCompare(b.teamName ?? '', 'ko')
      })
      return {
        id,
        divisionName: divNames.get(id) ?? '',
        teams,
      }
    })
  }, [filteredUsers, selectedDivisionId, divisions, otherTeamMatrix])

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
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold text-text-primary flex items-center gap-2">
            <CalendarIcon className="h-5 w-5" /> 본부 캘린더
          </h1>
          {/* 본부 dropdown — 1본부만 선택. default = 사용자 본부 */}
          {divisions.length > 0 && (
            <div className="w-44">
              <CustomDropdown
                value={selectedDivisionId}
                onChange={(next) => {
                  setSelectedDivisionId(next)
                  // 본부가 바뀌면 팀 default 재적용 가능하도록 ref 초기화
                  userTouchedTeamRef.current = false
                }}
                ariaLabel="본부 선택"
                placeholder="본부 선택"
                options={divisions.map(d => ({ value: d.id, label: d.name }))}
              />
            </div>
          )}
          {/* 팀 dropdown — 선택된 본부 안의 팀들 + '전체'. default = 사용자 본인 팀 */}
          {teamOptions.length > 0 && (
            <div className="w-44">
              <CustomDropdown
                value={selectedTeamId}
                onChange={(next) => {
                  setSelectedTeamId(next)
                  // 사용자가 직접 골랐다는 신호 — 이후 자동 default 차단
                  userTouchedTeamRef.current = true
                }}
                ariaLabel="팀 선택"
                placeholder="팀 선택"
                options={[
                  { value: ALL_TEAMS, label: '전체 팀' },
                  ...teamOptions,
                ]}
              />
            </div>
          )}
        </div>
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
            <table className="w-full border-collapse text-[13px]">
              <thead>
                {/* 날짜 헤더 — 페이지 세로 스크롤 시 상단 고정. 좌측 sticky 컬럼과 교차하는
                    셀은 z를 더 높여 본문 sticky 셀(z-[5]) 위에 떠 있도록. */}
                <tr className="bg-surface-muted">
                  <th className="sticky left-0 top-0 z-30 bg-surface-muted px-3 py-2.5 text-left font-semibold text-text-secondary border-r border-b border-border min-w-[90px]">구분</th>
                  <th className="sticky left-[90px] top-0 z-30 bg-surface-muted px-3 py-2.5 text-left font-semibold text-text-secondary border-r border-b border-border min-w-[100px]">인원</th>
                  <th className="sticky left-[190px] top-0 z-30 bg-surface-muted px-3 py-2.5 text-left font-semibold text-text-secondary border-r border-b border-border min-w-[100px]">직급/직책</th>
                  {days.map(d => {
                    const h = fmtDayHeader(d)
                    return (
                      <th
                        key={d.toISOString()}
                        className={`sticky top-0 z-20 px-2 py-2 text-center font-semibold border-r border-b border-border min-w-[130px] ${
                          h.isToday ? 'bg-primary-50 text-primary-700' :
                          h.isSunday ? 'bg-surface-muted text-danger-text' :
                          h.isWeekend ? 'bg-surface-muted text-text-secondary' :
                          'bg-surface-muted text-text-primary'
                        }`}
                      >
                        {h.date} ({h.dow})
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody>
                {divisionGroups.map((grp) => (
                  <>
                    {/* 본부 단위 이벤트 행 (있을 때만) */}
                    {divisionMatrix.get(grp.id) && (
                      <tr key={`${grp.id}-div`} className="bg-purple-50/40 border-t-4 border-purple-400">
                        <td className="sticky left-0 z-[5] bg-purple-50/80 px-3 py-2 font-semibold text-purple-900 border-r border-border align-top">{grp.divisionName}</td>
                        <td className="sticky left-[90px] z-[5] bg-purple-50/80 px-3 py-2 text-purple-900 font-semibold border-r border-border align-top">본부</td>
                        <td className="sticky left-[190px] z-[5] bg-purple-50/80 px-3 py-2 text-purple-900 border-r border-border align-top">본부 일정</td>
                        {days.map(d => {
                          const dateIso = toKstIsoDate(d)
                          const cell = divisionMatrix.get(grp.id)?.get(dateIso) ?? []
                          return (
                            <td key={dateIso} className="px-1 py-1 border-r border-border align-top">
                              <div className="space-y-0.5">
                                {cell.map((e, i) => (
                                  <div
                                    key={i}
                                    title={`${e.timeLabel} · ${e.title}`}
                                    className={`px-1.5 py-1 rounded leading-tight cursor-default ${TYPE_BG[e.ev.inferredType]}`}
                                  >
                                    <div className="text-[10px] tabular-nums opacity-80 truncate">{e.timeLabel}</div>
                                    <div className="text-xs truncate">{e.title}</div>
                                  </div>
                                ))}
                              </div>
                            </td>
                          )
                        })}
                      </tr>
                    )}
                    {/* 팀별 sub-group: 사용자들 + 기타 행. 팀 사이 굵은 구분선(border-t-4) */}
                    {grp.teams.map((team, ti) => {
                      const teamBorder = ti === 0 ? 'border-t-2 border-border-strong' : 'border-t-4 border-border-strong'
                      const otherInfo = team.teamId ? otherTeamMatrix.get(team.teamId) : null
                      return (
                        <>
                          {team.users.map((u, ui) => {
                            const isMe = userEmail && u.email.toLowerCase() === userEmail.toLowerCase()
                            const rowBorder = ui === 0 ? teamBorder : 'border-t border-border'
                            return (
                              <tr
                                key={u.email}
                                className={`bg-surface hover:bg-primary-50/30 transition-colors ${rowBorder}`}
                              >
                                <td className="sticky left-0 z-[5] bg-surface px-3 py-2 text-text-secondary border-r border-border align-top">
                                  {team.teamName ?? grp.divisionName}
                                </td>
                                <td className={`sticky left-[90px] z-[5] bg-surface px-3 py-2 border-r border-border align-top ${isMe ? 'font-bold text-primary-700' : 'font-medium text-text-primary'}`}>
                                  {u.displayName}
                                  {isMe && <span className="ml-1 text-[10px] text-primary-600">(나)</span>}
                                </td>
                                <td className="sticky left-[190px] z-[5] bg-surface px-3 py-2 text-text-secondary border-r border-border align-top text-xs">
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
                                            className={`px-1.5 py-0.5 rounded text-xs leading-tight truncate cursor-default ${TYPE_BG[e.ev.inferredType]}`}
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
                          {/* 팀의 "기타" 행 — 그 팀 사용자들 아래에 바로 붙음 */}
                          {otherInfo && (
                            <tr key={`${grp.id}-${team.teamId}-other`} className={`bg-amber-50/50 ${team.users.length === 0 ? teamBorder : 'border-t border-amber-200'}`}>
                              <td className="sticky left-0 z-[5] bg-amber-50/90 px-3 py-2 text-text-secondary border-r border-border align-top">{team.teamName ?? grp.divisionName}</td>
                              <td className="sticky left-[90px] z-[5] bg-amber-50/90 px-3 py-2 italic font-medium text-text-secondary border-r border-border align-top">기타</td>
                              <td className="sticky left-[190px] z-[5] bg-amber-50/90 px-3 py-2 text-text-muted border-r border-border align-top text-xs">공통</td>
                              {days.map(d => {
                                const dateIso = toKstIsoDate(d)
                                const cell = otherInfo.cells.get(dateIso) ?? []
                                return (
                                  <td key={dateIso} className="px-1 py-1 border-r border-border align-top">
                                    <div className="space-y-0.5">
                                      {cell.map((e, i) => (
                                        <div
                                          key={i}
                                          title={e.displayText}
                                          className={`px-1.5 py-0.5 rounded text-xs leading-tight truncate cursor-default ${TYPE_BG[e.ev.inferredType]}`}
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
                        </>
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
          범위 {range.from} ~ {range.to} · 사용자 {filteredUsers.length}명 · 이벤트 {filteredEvents.length}건
          {selectedDivisionId && users.length !== filteredUsers.length && (
            <span> (필터링됨, 전체 {users.length}명)</span>
          )}
        </div>
      )}
    </div>
  )
}
