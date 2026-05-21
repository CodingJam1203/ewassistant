'use client'

/**
 * MonthGridView — /calendar의 "월" 보기방식 (react-big-calendar 기반).
 *
 * 매트릭스 뷰(행=사용자)와 달리, 본부/팀 필터된 이벤트를 구글캘린더식 월 그리드에
 * 풀(pool)로 쌓아 보여준다. 이벤트 클릭 → EventEditModal (부모 onEventClick).
 *
 * 네비게이션은 react-big-calendar 내장 toolbar가 담당 (이전/다음/오늘).
 * 부모는 anchor date(`date`)를 controlled로 넘기고, onNavigate로 월 이동을 받아
 * 이벤트 fetch 범위를 다시 계산한다.
 */

import { useMemo } from 'react'
import { Calendar, dateFnsLocalizer } from 'react-big-calendar'
import { format, parse, startOfWeek, getDay } from 'date-fns'
import { ko } from 'date-fns/locale'
import 'react-big-calendar/lib/css/react-big-calendar.css'

type CalendarType = 'meeting' | 'vacation' | 'birthday' | 'other'

const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek: (date: Date) => startOfWeek(date, { weekStartsOn: 0 }),
  getDay,
  locales: { ko },
})

/** 매트릭스 뷰와 동일한 KST 날짜 문자열 (YYYY-MM-DD) */
function toKstIsoDate(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d)
}

/** 범례와 동일 색 — globals.css 토큰 + pink는 표준 tailwind 값 */
const TYPE_STYLE: Record<CalendarType, { bg: string; fg: string; border: string }> = {
  meeting:  { bg: 'var(--color-primary-50)',    fg: 'var(--color-primary-700)',  border: '#3B82F6' },
  vacation: { bg: 'var(--color-warning-bg)',    fg: 'var(--color-warning-text)', border: 'var(--color-warning-border)' },
  birthday: { bg: '#FDF2F8',                    fg: '#BE185D',                   border: '#EC4899' },
  other:    { bg: 'var(--color-surface-muted)', fg: '#475569',                   border: 'var(--color-text-muted)' },
}

export interface MonthGridEvent {
  id: string
  title: string
  startAt: string
  endAt: string
  isAllDay: boolean
  inferredType: CalendarType
}

interface RbcEvent<T> {
  title: string
  start: Date
  end: Date
  allDay: boolean
  resource: T
}

/** ApiEvent → react-big-calendar 이벤트. 종일은 KST 날짜 기준 local Date로 변환 */
function toRbcEvent<T extends MonthGridEvent>(ev: T): RbcEvent<T> {
  if (ev.isAllDay) {
    const startMs = new Date(ev.startAt).getTime()
    const endMs   = new Date(ev.endAt).getTime()
    const durationDays = Math.max(1, Math.round((endMs - startMs) / 86_400_000))
    const [sy, sm, sd] = toKstIsoDate(new Date(startMs)).split('-').map(Number)
    const start = new Date(sy, sm - 1, sd)
    const end   = new Date(sy, sm - 1, sd + durationDays - 1, 23, 59, 59)
    return { title: ev.title || '(제목 없음)', start, end, allDay: true, resource: ev }
  }
  return {
    title: ev.title || '(제목 없음)',
    start: new Date(ev.startAt),
    end:   new Date(ev.endAt),
    allDay: false,
    resource: ev,
  }
}

export default function MonthGridView<T extends MonthGridEvent>({
  events, date, onNavigate, onEventClick,
}: {
  events: T[]
  date: Date
  onNavigate: (next: Date) => void
  onEventClick: (ev: T) => void
}) {
  const rbcEvents = useMemo(() => events.map(toRbcEvent), [events])

  return (
    <div className="nclick-rbc bg-surface border border-border rounded-[10px] p-2 sm:p-3 overflow-x-auto" style={{ height: 'calc(100vh - 220px)', minHeight: 480 }}>
      {/* 모바일에서 7열이 짓눌려 깨지지 않도록 최소 너비 확보 → 좁은 화면은 가로 스크롤.
          데스크탑은 컨테이너가 이미 넓어 스크롤 없음. */}
      <div className="h-full min-w-[680px]">
      <Calendar<RbcEvent<T>>
        localizer={localizer}
        culture="ko"
        events={rbcEvents}
        date={date}
        onNavigate={onNavigate}
        view="month"
        onView={() => {}}
        views={['month']}
        popup
        onSelectEvent={(e) => onEventClick(e.resource)}
        eventPropGetter={(e) => {
          const s = TYPE_STYLE[e.resource.inferredType] ?? TYPE_STYLE.other
          return {
            style: {
              backgroundColor: s.bg,
              color: s.fg,
              borderLeft: `3px solid ${s.border}`,
              borderRadius: 4,
              fontSize: 12,
              padding: '1px 4px',
            },
          }
        }}
        messages={{
          today: '오늘',
          previous: '이전',
          next: '다음',
          month: '월',
          showMore: (count: number) => `+${count}개 더보기`,
          noEventsInRange: '기간 내 일정이 없습니다.',
        }}
        style={{ height: '100%' }}
      />
      </div>
    </div>
  )
}
