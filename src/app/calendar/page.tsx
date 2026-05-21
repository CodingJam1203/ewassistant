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
import { ArrowLeft, Calendar as CalendarIcon, Loader2, ChevronLeft, ChevronRight, Home, RefreshCw, Plus, Repeat } from 'lucide-react'
import CustomDropdown from '@/components/ui/CustomDropdown'
import EventEditModal, { type EventEditInitial } from '@/components/calendar/EventEditModal'

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
  rrule: string | null
  recurringEventId: string | null
  calendarId: string
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
  vacation: 'bg-warning-bg text-warning-text border-l-2 border-warning-border',
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

/** "최신 14:36" 같은 KST HH:mm 표시 — refresh indicator용 */
function fmtSyncTime(iso: string): string {
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
  // 종일 이벤트는 KST 날짜 문자열 + duration(일수) 기반으로 판정.
  // iCal DTEND는 exclusive(다음 날 자정). DB에 UTC 자정으로 저장됐든 KST 자정으로
  // 저장됐든 duration 일수는 동일하므로 (end - start)/86400000 round로 안전하게 산출.
  // 시각 비교를 그대로 쓰면 UTC 자정 저장 케이스에서 +9h 만큼 다음 날에 잘못 매칭됨.
  if (ev.isAllDay) {
    const startMs = new Date(ev.startAt).getTime()
    const endMs   = new Date(ev.endAt).getTime()
    const durationDays = Math.max(1, Math.round((endMs - startMs) / 86_400_000))
    const startKst = toKstIsoDate(new Date(startMs))
    // 시작 + (duration-1)일까지가 표시 범위. 시작 KST 자정에 day를 더해 안전 비교.
    const [sy, sm, sd] = startKst.split('-').map(Number)
    const lastKst = toKstIsoDate(new Date(Date.UTC(sy, sm - 1, sd + durationDays - 1)))
    if (dateIso < startKst || dateIso > lastKst) return null
    return { ev, timeLabel: '종일', title: ev.title || '(제목 없음)' }
  }

  // 시각 이벤트는 기존 시각 비교 그대로. evEnd <= dayStart는 정확히 자정 종료(24:00 표현)도
  // 다음 날 매칭 안 되게 보장.
  const dayStartIso = `${dateIso}T00:00:00+09:00`
  const dayEndIso   = `${dateIso}T23:59:59+09:00`
  const dayStart = new Date(dayStartIso).getTime()
  const dayEnd   = new Date(dayEndIso).getTime()
  const evStart  = new Date(ev.startAt).getTime()
  const evEnd    = new Date(ev.endAt).getTime()
  if (evStart > dayEnd || evEnd <= dayStart) return null
  const timeLabel = `${fmtTime(ev.startAt)}~${fmtTime(ev.endAt)}`
  return { ev, timeLabel, title: ev.title || '(제목 없음)' }
}

interface ApiDivision { id: string; name: string; sortOrder: number }

const ALL_TEAMS = '__ALL__'

/**
 * 모바일 default 뷰 — Agenda(날짜별 그룹 → 사용자별 events).
 * 매트릭스의 "여러 사람 + 여러 날" 본질 중 모바일은 "여러 사람" 우선.
 * 가로 스크롤 없이 vertical scroll만으로 훑어보기 가능.
 *
 * 데이터: 부모(CalendarMatrixPage)가 본부/팀 필터까지 적용한 users·events·days를 그대로 전달.
 * 정렬: 데스크탑 매트릭스와 동일 (divisionSort → teamSort → displayOrder → name).
 * 빈 날(이벤트 0건)은 카드 자체 생략 — 정보 밀도 우선.
 */
function AgendaView({
  users, events, days, userEmail, onEventClick,
}: {
  users: ApiUser[]
  events: ApiEvent[]
  days: Date[]
  userEmail: string | null
  onEventClick: (ev: ApiEvent) => void
}) {
  const userEmailSet = useMemo(
    () => new Set(users.map(u => u.email.toLowerCase())),
    [users],
  )
  const usersByEmail = useMemo(() => {
    const m = new Map<string, ApiUser>()
    for (const u of users) m.set(u.email.toLowerCase(), u)
    return m
  }, [users])

  // 날짜별 그룹: 본부 일정 / 사용자별 events / 기타(매칭 안 된 팀 events)
  const dayGroups = useMemo(() => {
    return days.map(day => {
      const dateIso = toKstIsoDate(day)
      const hdr = fmtDayHeader(day)

      // 이 날 걸치는 events
      const dayEntries: Array<{ ev: ApiEvent; entry: EventCellEntry }> = []
      for (const ev of events) {
        const entry = eventOnDate(ev, dateIso)
        if (entry) dayEntries.push({ ev, entry })
      }

      const divEntries = dayEntries.filter(x => x.ev.teamId === null)

      const userMap = new Map<string, EventCellEntry[]>()
      for (const x of dayEntries) {
        if (x.ev.teamId === null) continue
        for (const em of x.ev.matchedUserEmails) {
          const k = em.toLowerCase()
          if (!userEmailSet.has(k)) continue
          const list = userMap.get(k) ?? []
          list.push(x.entry)
          userMap.set(k, list)
        }
      }

      const otherEntries = dayEntries.filter(x =>
        x.ev.teamId !== null &&
        !x.ev.matchedUserEmails.some(em => userEmailSet.has(em.toLowerCase())),
      )

      // userMap key를 매트릭스 정렬 정책으로 정렬
      const sortedUserEmails = Array.from(userMap.keys())
        .map(em => usersByEmail.get(em))
        .filter((u): u is ApiUser => !!u)
        .sort((a, b) => {
          if (a.divisionSort !== b.divisionSort) return a.divisionSort - b.divisionSort
          if (a.teamSort !== b.teamSort) return a.teamSort - b.teamSort
          if (a.displayOrder !== b.displayOrder) return a.displayOrder - b.displayOrder
          return a.displayName.localeCompare(b.displayName, 'ko')
        })
        .map(u => u.email.toLowerCase())

      return {
        day,
        dateIso,
        hdr,
        divEntries,
        userMap,
        sortedUserEmails,
        otherEntries,
        total: dayEntries.length,
      }
    })
  }, [events, days, userEmailSet, usersByEmail])

  const allEmpty = dayGroups.every(g => g.total === 0)

  return (
    <div className="space-y-3">
      {allEmpty && (
        <div className="rounded-[10px] border border-border bg-surface p-8 text-center text-sm text-text-muted">
          기간 내 일정이 없습니다.
        </div>
      )}
      {dayGroups.map(g => {
        if (g.total === 0) return null
        return (
          <div key={g.dateIso} className="rounded-[10px] border border-border bg-surface overflow-hidden">
            {/* 날짜 헤더 */}
            <div className={`px-3 py-2 text-sm font-semibold border-b border-border flex items-center gap-2 ${
              g.hdr.isToday  ? 'bg-primary-50 text-primary-700' :
              g.hdr.isSunday ? 'bg-surface-muted text-danger-text' :
              g.hdr.isWeekend? 'bg-surface-muted text-text-secondary' :
                               'bg-surface-muted text-text-primary'
            }`}>
              <span>{g.hdr.date} ({g.hdr.dow})</span>
              {g.hdr.isToday && <span className="text-[10px] font-medium">오늘</span>}
            </div>

            <div className="p-3 space-y-3">
              {/* 본부 일정 */}
              {g.divEntries.length > 0 && (
                <section>
                  <div className="text-[11px] font-semibold text-purple-700 mb-1">본부 일정</div>
                  <div className="space-y-1">
                    {g.divEntries.map((x, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => onEventClick(x.entry.ev)}
                        className={`w-full text-left px-2 py-1 rounded leading-tight hover:ring-1 hover:ring-primary-300 ${TYPE_BG[x.entry.ev.inferredType]}`}
                      >
                        <div className="text-[10px] tabular-nums opacity-80 flex items-center gap-1">
                          {x.entry.ev.rrule && <Repeat className="h-3 w-3 shrink-0" />}
                          <span>{x.entry.timeLabel}</span>
                        </div>
                        <div className="text-[13px]">{x.entry.title}</div>
                      </button>
                    ))}
                  </div>
                </section>
              )}

              {/* 사용자별 events */}
              {g.sortedUserEmails.map(em => {
                const u = usersByEmail.get(em)
                if (!u) return null
                const evs = g.userMap.get(em) ?? []
                if (evs.length === 0) return null
                const isMe = userEmail && em === userEmail.toLowerCase()
                return (
                  <section key={em}>
                    <div className={`text-[12px] mb-1 flex items-center gap-1.5 ${isMe ? 'font-bold text-primary-700' : 'font-medium text-text-primary'}`}>
                      <span>{u.displayName}</span>
                      {isMe && <span className="text-[10px] text-primary-600">(나)</span>}
                      <span className="text-[10px] text-text-muted">· {u.teamName ?? u.divisionName}</span>
                    </div>
                    <div className="space-y-1">
                      {evs.map((e, i) => (
                        <button
                          key={i}
                          type="button"
                          onClick={() => onEventClick(e.ev)}
                          className={`w-full text-left px-2 py-1 rounded leading-tight hover:ring-1 hover:ring-primary-300 ${TYPE_BG[e.ev.inferredType]}`}
                        >
                          <div className="text-[10px] tabular-nums opacity-80 flex items-center gap-1">
                            {e.ev.rrule && <Repeat className="h-3 w-3 shrink-0" />}
                            <span>{e.timeLabel}</span>
                          </div>
                          <div className="text-[13px]">{e.title}</div>
                        </button>
                      ))}
                    </div>
                  </section>
                )
              })}

              {/* 기타 — 사용자 매칭 안 된 팀 events */}
              {g.otherEntries.length > 0 && (
                <section>
                  <div className="text-[11px] font-semibold text-amber-700 mb-1">기타</div>
                  <div className="space-y-1">
                    {g.otherEntries.map((x, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => onEventClick(x.entry.ev)}
                        className={`w-full text-left px-2 py-1 rounded leading-tight hover:ring-1 hover:ring-primary-300 ${TYPE_BG[x.entry.ev.inferredType]}`}
                      >
                        <div className="text-[10px] tabular-nums opacity-80 flex items-center gap-1">
                          {x.entry.ev.rrule && <Repeat className="h-3 w-3 shrink-0" />}
                          <span>{x.entry.timeLabel}</span>
                        </div>
                        <div className="text-[13px]">{x.entry.title}</div>
                      </button>
                    ))}
                  </div>
                </section>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

/**
 * 매트릭스 캘린더 뷰 본체.
 *
 * - default export `CalendarMatrixPage`는 /calendar 라우트 진입점 (직접 접근).
 * - named export `CalendarMatrixView`는 다른 페이지(예: /home '일정관리' 탭)에서
 *   동일 매트릭스를 임베드할 때 사용. `embedded=true`면 상단 "← 홈" 링크 hide.
 */
export function CalendarMatrixView({ embedded = false }: { embedded?: boolean } = {}) {
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

  // 실시간성 — /api/calendar/refresh 호출 상태. mount 시 1회 silent refresh,
  // 사용자 수동 새로고침 버튼은 force=true로 throttle(5분) 우회.
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  // mount 시 silent refresh 1회만 실행하도록 가드
  const didMountSyncRef = useRef(false)

  // Phase 4.3 — 등록/수정 모달
  const [modalState, setModalState] = useState<
    | { mode: 'create'; initial: EventEditInitial }
    | { mode: 'edit'; initial: EventEditInitial }
    | null
  >(null)

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

  /**
   * /api/calendar/refresh 호출.
   *   - force=false (mount/silent): throttle(5분) 안이면 즉시 throttled 응답. UI 그대로.
   *   - force=true (수동 새로고침 버튼): throttle 무시 강제 sync. 완료 후 events 재load.
   * 어느 쪽이든 응답에서 lastSyncedAt 갱신.
   */
  const refresh = useCallback(async (force: boolean) => {
    setSyncing(true)
    try {
      const res = await fetch('/api/calendar/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force }),
        cache: 'no-store',
      })
      const data: { status?: string; lastSyncedAt?: string | null } = await res.json().catch(() => ({}))
      if (data.lastSyncedAt) setLastSyncedAt(data.lastSyncedAt)
      // 실제 sync가 일어났을 때만 events 재load (throttled면 DB 변경 없음)
      if (data.status === 'synced') {
        await load()
      }
    } catch (err) {
      // refresh 실패는 silent — 캘린더 자체 read는 별개로 동작
      console.error('[calendar/refresh] failed:', err)
    } finally {
      setSyncing(false)
    }
  }, [load])

  // mount 시 1회 silent refresh
  useEffect(() => {
    if (didMountSyncRef.current) return
    didMountSyncRef.current = true
    refresh(false)
  }, [refresh])

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

  /** "+ 일정 등록" 버튼 — 오늘 10:00~11:00 prefill */
  const handleCreateClick = useCallback(() => {
    const now = new Date()
    const baseDate = todayKst()
    // baseDate는 KST 자정. UI에서 KST 10:00로 설정하기 위해 ISO 변환
    const [y, m, d] = toKstIsoDate(baseDate).split('-').map(Number)
    const startIso = new Date(Date.UTC(y, m - 1, d, 1, 0, 0)).toISOString()  // 10:00 KST = 01:00 UTC
    const endIso   = new Date(Date.UTC(y, m - 1, d, 2, 0, 0)).toISOString()  // 11:00 KST = 02:00 UTC
    void now
    setModalState({
      mode: 'create',
      initial: {
        startAt: startIso,
        endAt: endIso,
        isAllDay: false,
        inferredType: 'meeting',
      },
    })
  }, [])

  /** chip(이벤트) 클릭 — 수정 모드. 셀 click(날짜 prefill)은 후속 작업으로 남겨둠. */
  const handleEventClick = useCallback((ev: ApiEvent) => {
    setModalState({
      mode: 'edit',
      initial: {
        id: ev.id,
        title: ev.title,
        startAt: ev.startAt,
        endAt: ev.endAt,
        isAllDay: ev.isAllDay,
        inferredType: ev.inferredType,
        calendarId: ev.calendarId,
        rrule: ev.rrule,
        recurringEventId: ev.recurringEventId,
      },
    })
  }, [])

  /** 모달에서 저장/삭제 성공 시 — 모달 닫고 force refresh */
  const handleModalSaved = useCallback(() => {
    setModalState(null)
    void refresh(true)
  }, [refresh])

  return (
    <div className="max-w-[120rem] mx-auto p-3 sm:p-4 space-y-3">
      {!embedded && (
        <div className="flex items-center gap-3">
          <Link href="/home" className="inline-flex items-center gap-1 text-sm text-text-secondary hover:text-text-primary">
            <ArrowLeft className="h-4 w-4" />
            홈
          </Link>
        </div>
      )}

      {/* 헤더 + 범위 컨트롤 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <h1 className="text-xl font-semibold text-text-primary flex items-center gap-2">
              <CalendarIcon className="h-5 w-5" /> 일정관리
            </h1>
            <p className="mt-0.5 text-[11px] text-text-muted">
              해당 캘린더는 구글캘린더와 실시간 양방향 동기화 됩니다
            </p>
          </div>
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
          {/* + 일정 등록 — Phase 4.3 */}
          <button
            type="button"
            onClick={handleCreateClick}
            className="inline-flex items-center gap-1 h-8 px-3 rounded-[10px] bg-primary-600 text-white text-xs font-medium hover:bg-primary-700"
          >
            <Plus className="h-3.5 w-3.5" /> 일정 등록
          </button>
          {/* sync indicator + 수동 새로고침 — 마지막 동기화 KST HH:mm. force=true로 throttle 우회 */}
          <div className="inline-flex items-center gap-1 text-[11px] text-text-muted">
            {syncing ? (
              <>
                <Loader2 className="h-3 w-3 animate-spin" />
                <span>동기화 중…</span>
              </>
            ) : lastSyncedAt ? (
              <>
                <span className="tabular-nums">최신 {fmtSyncTime(lastSyncedAt)}</span>
                <button
                  type="button"
                  onClick={() => refresh(true)}
                  className="ml-1 inline-flex items-center gap-0.5 text-primary-600 hover:text-primary-700 hover:underline"
                  aria-label="지금 새로고침"
                  title="지금 새로고침 (Google 캘린더 즉시 fetch)"
                >
                  <RefreshCw className="h-3 w-3" />
                  <span>새로고침</span>
                </button>
              </>
            ) : null}
          </div>
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
      <>
      {/* 모바일 default — Agenda(날짜별 그룹). sm 이상에서는 숨김 */}
      <div className="block sm:hidden">
        <AgendaView
          users={filteredUsers}
          events={filteredEvents}
          days={days}
          userEmail={userEmail}
          onEventClick={handleEventClick}
        />
      </div>

      {/* sm 이상 default — 매트릭스. sticky thead가 동작하려면 외곽 컨테이너가 양방향
          overflow-auto + 고정 max-height여야 함. inner div(overflow-x-auto) 분리 구조는
          sticky containing block이 body 스크롤 시 함께 빠지므로 단일 wrapper로 통합. */}
      <div className="hidden sm:block">
        <div
          className="bg-surface border border-border rounded-[10px] overflow-auto"
          style={{ maxHeight: 'calc(100vh - 200px)', minHeight: '400px' }}
        >
          <table className="w-full border-collapse text-[13px]">
              <thead>
                {/* 날짜 헤더 — 페이지 세로 스크롤 시 상단 고정. 좌측 sticky 컬럼과 교차하는
                    셀은 z를 더 높여 본문 sticky 셀(z-[5]) 위에 떠 있도록. */}
                <tr className="bg-surface-muted">
                  <th className="sticky left-0 top-0 z-30 bg-surface-muted px-2 sm:px-3 py-2.5 text-left text-xs sm:text-[13px] font-semibold text-text-secondary border-r border-b border-border min-w-[60px] sm:min-w-[90px]">구분</th>
                  <th className="sticky left-[60px] sm:left-[90px] top-0 z-30 bg-surface-muted px-2 sm:px-3 py-2.5 text-left text-xs sm:text-[13px] font-semibold text-text-secondary border-r border-b border-border min-w-[80px] sm:min-w-[100px]">인원</th>
                  {days.map(d => {
                    const h = fmtDayHeader(d)
                    return (
                      <th
                        key={d.toISOString()}
                        className={`sticky top-0 z-20 px-1 sm:px-2 py-2 text-center text-xs sm:text-[13px] font-semibold border-r border-b border-border min-w-[90px] sm:min-w-[130px] ${
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
                        <td className="sticky left-0 z-[5] bg-purple-50/80 px-2 sm:px-3 py-2 text-xs sm:text-[13px] font-semibold text-purple-900 border-r border-border align-top">{grp.divisionName}</td>
                        <td className="sticky left-[60px] sm:left-[90px] z-[5] bg-purple-50/80 px-2 sm:px-3 py-2 text-xs sm:text-[13px] text-purple-900 font-semibold border-r border-border align-top">본부 일정</td>
                        {days.map(d => {
                          const dateIso = toKstIsoDate(d)
                          const cell = divisionMatrix.get(grp.id)?.get(dateIso) ?? []
                          return (
                            <td key={dateIso} className="px-1 py-1 border-r border-border align-top">
                              <div className="space-y-0.5">
                                {cell.map((e, i) => (
                                  <button
                                    key={i}
                                    type="button"
                                    title={`${e.timeLabel} · ${e.title}`}
                                    onClick={(ev) => { ev.stopPropagation(); handleEventClick(e.ev) }}
                                    className={`w-full text-left px-1.5 py-1 rounded leading-tight cursor-pointer hover:ring-1 hover:ring-primary-300 ${TYPE_BG[e.ev.inferredType]}`}
                                  >
                                    <div className="text-[10px] tabular-nums opacity-80 truncate">{e.timeLabel}</div>
                                    <div className="text-xs truncate">{e.title}</div>
                                  </button>
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
                                <td className="sticky left-0 z-[5] bg-surface px-2 sm:px-3 py-2 text-xs sm:text-[13px] text-text-secondary border-r border-border align-top">
                                  {team.teamName ?? grp.divisionName}
                                </td>
                                <td className={`sticky left-[60px] sm:left-[90px] z-[5] bg-surface px-2 sm:px-3 py-2 text-xs sm:text-[13px] border-r border-border align-top ${isMe ? 'font-bold text-primary-700' : 'font-medium text-text-primary'}`}>
                                  {u.displayName}
                                  {isMe && <span className="ml-1 text-[10px] text-primary-600">(나)</span>}
                                </td>
                                {days.map(d => {
                                  const dateIso = toKstIsoDate(d)
                                  const cell = userMatrix.get(u.email.toLowerCase())?.get(dateIso) ?? []
                                  return (
                                    <td key={dateIso} className="px-1 py-1 border-r border-border align-top">
                                      <div className="space-y-0.5">
                                        {cell.map((e, i) => (
                                          <button
                                            key={i}
                                            type="button"
                                            title={`${e.timeLabel} · ${e.title}`}
                                            onClick={(ev) => { ev.stopPropagation(); handleEventClick(e.ev) }}
                                            className={`w-full text-left px-1.5 py-1 rounded leading-tight cursor-pointer hover:ring-1 hover:ring-primary-300 ${TYPE_BG[e.ev.inferredType]}`}
                                          >
                                            <div className="text-[10px] tabular-nums opacity-80 truncate flex items-center gap-0.5">
                                              {e.ev.rrule && <Repeat className="h-2.5 w-2.5 shrink-0" />}
                                              <span className="truncate">{e.timeLabel}</span>
                                            </div>
                                            <div className="text-xs truncate">{e.title}</div>
                                          </button>
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
                              <td className="sticky left-0 z-[5] bg-amber-50/90 px-2 sm:px-3 py-2 text-xs sm:text-[13px] text-text-secondary border-r border-border align-top">{team.teamName ?? grp.divisionName}</td>
                              <td className="sticky left-[60px] sm:left-[90px] z-[5] bg-amber-50/90 px-2 sm:px-3 py-2 text-xs sm:text-[13px] italic font-medium text-text-secondary border-r border-border align-top">기타</td>
                              {days.map(d => {
                                const dateIso = toKstIsoDate(d)
                                const cell = otherInfo.cells.get(dateIso) ?? []
                                return (
                                  <td key={dateIso} className="px-1 py-1 border-r border-border align-top">
                                    <div className="space-y-0.5">
                                      {cell.map((e, i) => (
                                        <button
                                          key={i}
                                          type="button"
                                          title={`${e.timeLabel} · ${e.title}`}
                                          onClick={(ev) => { ev.stopPropagation(); handleEventClick(e.ev) }}
                                          className={`w-full text-left px-1.5 py-1 rounded leading-tight cursor-pointer hover:ring-1 hover:ring-primary-300 ${TYPE_BG[e.ev.inferredType]}`}
                                        >
                                          <div className="text-[10px] tabular-nums opacity-80 truncate flex items-center gap-0.5">
                                            {e.ev.rrule && <Repeat className="h-2.5 w-2.5 shrink-0" />}
                                            <span className="truncate">{e.timeLabel}</span>
                                          </div>
                                          <div className="text-xs truncate">{e.title}</div>
                                        </button>
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
      </>
      )}

      {/* 범례 */}
      <div className="flex flex-wrap items-center gap-3 text-[11px] text-text-secondary px-1">
        <span className="font-semibold">범례:</span>
        <span className="inline-flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded-sm bg-primary-50 border-l-2 border-primary-500" />회의</span>
        <span className="inline-flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded-sm bg-warning-bg border-l-2 border-warning-border" />휴가</span>
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

      {/* Phase 4.3 등록/수정 모달 */}
      {modalState && (
        <EventEditModal
          isCreate={modalState.mode === 'create'}
          initial={modalState.initial}
          onClose={() => setModalState(null)}
          onSaved={handleModalSaved}
        />
      )}
    </div>
  )
}

export default function CalendarMatrixPage() {
  return <CalendarMatrixView />
}
