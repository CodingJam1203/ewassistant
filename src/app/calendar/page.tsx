'use client'

/**
 * /calendar — 본부 통합 캘린더 뷰 (Phase 1.3, ABC-217)
 *
 * - react-big-calendar 기반 일/주/월/agenda 뷰
 * - 본부 필터 (multi-select, 사용자 권한 내)
 * - 이벤트 색상 — 회의(파랑) / 휴가(보라) / 생일(분홍) / 기타(회색)
 * - 본인 매칭 이벤트 강조 (border + bold)
 *
 * 데이터 source: GET /api/calendar/events?from=&to=&divisionIds=
 * — DB cache(org_calendar_events) read만. Google API 직접 호출 X.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Calendar as BigCalendar, dateFnsLocalizer, Views, type View } from 'react-big-calendar'
import { format, parse, startOfWeek, getDay, addMonths, subMonths } from 'date-fns'
import { ko } from 'date-fns/locale'
import { ArrowLeft, Calendar as CalendarIcon, Loader2 } from 'lucide-react'
import 'react-big-calendar/lib/css/react-big-calendar.css'

const locales = { ko }
const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek: (date: Date) => startOfWeek(date, { weekStartsOn: 0 }),
  getDay,
  locales,
})

type CalendarType = 'meeting' | 'vacation' | 'birthday' | 'other'

interface ApiEvent {
  id: string
  title: string
  description: string | null
  location: string | null
  startAt: string
  endAt: string
  isAllDay: boolean
  matchedUserEmails: string[]
  inferredType: CalendarType
  calendarId: string
  calendarLabel: string
  calendarType: CalendarType
  divisionId: string
  divisionName: string
  teamId: string | null
  teamName: string | null
}

interface BigCalEvent {
  id: string
  title: string
  start: Date
  end: Date
  allDay: boolean
  resource: ApiEvent
}

const TYPE_COLOR: Record<CalendarType, { bg: string; border: string; text: string }> = {
  meeting:  { bg: '#DBEAFE', border: '#2563EB', text: '#1E40AF' },  // primary
  vacation: { bg: '#E0E7FF', border: '#7C3AED', text: '#5B21B6' },  // 보라
  birthday: { bg: '#FCE7F3', border: '#DB2777', text: '#9D174D' },  // 분홍
  other:    { bg: '#F1F5F9', border: '#64748B', text: '#334155' },  // 회색
}

const TYPE_LABEL: Record<CalendarType, string> = {
  meeting: '회의', vacation: '휴가', birthday: '생일·기념일', other: '기타',
}

function toIsoDate(d: Date): string {
  // KST 기준 yyyy-MM-dd
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  })
  return fmt.format(d)
}

export default function CalendarPage() {
  const [view, setView] = useState<View>(Views.MONTH)
  const [date, setDate] = useState<Date>(new Date())
  const [events, setEvents] = useState<ApiEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [userEmail, setUserEmail] = useState<string | null>(null)
  // 본부 필터 — 빈 Set이면 전체. 사용자가 토글하면 Set 안에 division id 들어감
  const [divisionFilter, setDivisionFilter] = useState<Set<string>>(new Set())

  // 뷰별 범위 — 월 뷰는 ±1개월 (월 경계 셀의 이전/다음 달 일정 표시)
  const range = useMemo(() => {
    const from = subMonths(date, 1)
    const to   = addMonths(date, 1)
    return { from: toIsoDate(from), to: toIsoDate(to) }
  }, [date])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ from: range.from, to: range.to })
      const res = await fetch(`/api/calendar/events?${params}`, { cache: 'no-store' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError(body.error || `HTTP ${res.status}`)
        return
      }
      const data = await res.json()
      setEvents(data.events ?? [])
      setUserEmail(data.userEmail ?? null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [range.from, range.to])

  useEffect(() => { load() }, [load])

  // 본부 목록 (events에서 distinct)
  const divisions = useMemo(() => {
    const map = new Map<string, string>()
    for (const ev of events) {
      if (ev.divisionId) map.set(ev.divisionId, ev.divisionName)
    }
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }))
  }, [events])

  const filtered = useMemo(() => {
    if (divisionFilter.size === 0) return events
    return events.filter(ev => divisionFilter.has(ev.divisionId))
  }, [events, divisionFilter])

  const bigCalEvents: BigCalEvent[] = useMemo(() => filtered.map(ev => ({
    id: ev.id,
    title: ev.title || '(제목 없음)',
    start: new Date(ev.startAt),
    end:   new Date(ev.endAt),
    allDay: ev.isAllDay,
    resource: ev,
  })), [filtered])

  const eventPropGetter = useCallback((event: BigCalEvent) => {
    const t = event.resource.inferredType
    const c = TYPE_COLOR[t]
    const isMine = !!userEmail && event.resource.matchedUserEmails.includes(userEmail.toLowerCase())
    return {
      style: {
        backgroundColor: c.bg,
        borderLeft: `3px solid ${c.border}`,
        color: c.text,
        fontWeight: isMine ? 700 : 500,
        fontSize: '11px',
        padding: '1px 4px',
        borderRadius: 4,
        outline: isMine ? `2px solid ${c.border}` : 'none',
      },
    }
  }, [userEmail])

  const toggleDivision = (id: string) => {
    setDivisionFilter(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="max-w-7xl mx-auto p-4 sm:p-6 space-y-4">
      <div className="flex items-center gap-3">
        <Link href="/home" className="inline-flex items-center gap-1 text-sm text-text-secondary hover:text-text-primary">
          <ArrowLeft className="h-4 w-4" />
          홈
        </Link>
      </div>

      <header>
        <h1 className="text-2xl font-semibold text-text-primary flex items-center gap-2">
          <CalendarIcon className="h-6 w-6" /> 캘린더
        </h1>
        <p className="mt-1 text-sm text-text-secondary">
          본부별 회의·휴가·생일 일정 (read-only) · 본인 매칭 일정은 굵게 강조됩니다
        </p>
      </header>

      {/* 필터 + 범례 */}
      <div className="bg-surface border border-border rounded-[10px] p-3 space-y-2">
        {divisions.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-text-secondary">본부 필터:</span>
            <button
              type="button"
              onClick={() => setDivisionFilter(new Set())}
              className={`h-7 px-2.5 rounded-full text-[11px] font-medium border transition-colors ${
                divisionFilter.size === 0
                  ? 'bg-primary-600 text-white border-primary-600'
                  : 'bg-surface text-text-secondary border-border-strong hover:bg-surface-muted'
              }`}
            >
              전체
            </button>
            {divisions.map(d => {
              const on = divisionFilter.has(d.id)
              return (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => toggleDivision(d.id)}
                  className={`h-7 px-2.5 rounded-full text-[11px] font-medium border transition-colors ${
                    on
                      ? 'bg-primary-600 text-white border-primary-600'
                      : 'bg-surface text-text-secondary border-border-strong hover:bg-surface-muted'
                  }`}
                >
                  {d.name}
                </button>
              )
            })}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3 text-[11px] text-text-secondary">
          <span className="font-semibold">범례:</span>
          {(Object.keys(TYPE_LABEL) as CalendarType[]).map(t => (
            <span key={t} className="inline-flex items-center gap-1.5">
              <span
                className="inline-block w-3 h-3 rounded-sm border-l-[3px]"
                style={{ backgroundColor: TYPE_COLOR[t].bg, borderColor: TYPE_COLOR[t].border }}
              />
              {TYPE_LABEL[t]}
            </span>
          ))}
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 rounded-sm bg-surface-muted outline outline-2 outline-primary-600" />
            <span className="font-semibold">본인 매칭</span>
          </span>
        </div>
      </div>

      {/* 에러 */}
      {error && (
        <div className="rounded-[10px] border border-danger-border bg-danger-bg p-4 text-sm text-danger-text">
          {error}
        </div>
      )}

      {/* 로딩 */}
      {loading && (
        <div className="rounded-[10px] border border-border bg-surface p-8 text-center text-sm text-text-muted">
          <Loader2 className="h-5 w-5 animate-spin inline mr-2" />
          불러오는 중…
        </div>
      )}

      {/* 캘린더 본체 */}
      {!loading && (
        <div className="bg-surface border border-border rounded-[12px] p-3" style={{ height: '70vh' }}>
          <BigCalendar
            localizer={localizer}
            culture="ko"
            events={bigCalEvents}
            view={view}
            onView={(v) => setView(v)}
            date={date}
            onNavigate={(d) => setDate(d)}
            views={[Views.MONTH, Views.WEEK, Views.DAY, Views.AGENDA]}
            eventPropGetter={eventPropGetter}
            popup
            style={{ height: '100%' }}
            messages={{
              today:     '오늘',
              previous:  '이전',
              next:      '다음',
              month:     '월',
              week:      '주',
              day:       '일',
              agenda:    '목록',
              date:      '날짜',
              time:      '시간',
              event:     '일정',
              noEventsInRange: '이 기간에 일정이 없습니다.',
              showMore: (count) => `+${count}개 더보기`,
            }}
            formats={{
              monthHeaderFormat: (d) => format(d, 'yyyy년 M월', { locale: ko }),
              dayHeaderFormat: (d) => format(d, 'M월 d일 (E)', { locale: ko }),
              dayRangeHeaderFormat: ({ start, end }) =>
                `${format(start, 'M월 d일', { locale: ko })} - ${format(end, 'M월 d일', { locale: ko })}`,
            }}
          />
        </div>
      )}

      {/* 통계 */}
      {!loading && !error && (
        <div className="text-xs text-text-muted">
          현재 범위 {range.from} ~ {range.to} · 총 {filtered.length}건 표시
          {divisionFilter.size > 0 && <span> (필터링됨, 전체 {events.length}건)</span>}
        </div>
      )}
    </div>
  )
}
