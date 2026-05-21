'use client'

/**
 * MonthGridView — /calendar의 "월" 보기방식 (react-big-calendar 기반).
 *
 * 매트릭스 뷰(행=사용자)와 달리, 본부/팀 필터된 이벤트를 구글캘린더식 월 그리드에
 * 풀(pool)로 쌓아 보여준다.
 *
 * 인터랙션:
 *   - 이벤트 칩 클릭 → EventEditModal (부모 onEventClick)
 *   - 셀(빈 영역)·날짜 숫자·"⋯ 더보기" 클릭 → 그날 일정 목록 팝업(DayPopup)
 *     팝업 안 일정 클릭 → EventEditModal
 *   - 한 화면 안에 월 전체. 칸을 넘치는 텍스트는 ...로 truncate (셀 밖으로 안 나감)
 *
 * 네비게이션은 react-big-calendar 내장 toolbar(이전/다음/오늘)가 담당.
 * 부모는 anchor date(`date`)를 controlled로 넘기고, onNavigate로 월 이동을 받아
 * 이벤트 fetch 범위를 다시 계산한다.
 */

import { useMemo, useState } from 'react'
import { Calendar, dateFnsLocalizer } from 'react-big-calendar'
import { format, parse, startOfWeek, getDay } from 'date-fns'
import { ko } from 'date-fns/locale'
import { X } from 'lucide-react'
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

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('ko-KR', {
    timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false,
  })
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

/** 이벤트가 특정 KST 날짜(YYYY-MM-DD)에 걸치는지 — DayPopup 목록 산출용 */
function eventOccursOn(ev: MonthGridEvent, dateIso: string): boolean {
  if (ev.isAllDay) {
    const startMs = new Date(ev.startAt).getTime()
    const endMs   = new Date(ev.endAt).getTime()
    const durationDays = Math.max(1, Math.round((endMs - startMs) / 86_400_000))
    const [sy, sm, sd] = toKstIsoDate(new Date(startMs)).split('-').map(Number)
    const startKst = toKstIsoDate(new Date(sy, sm - 1, sd))
    const lastKst  = toKstIsoDate(new Date(sy, sm - 1, sd + durationDays - 1))
    return dateIso >= startKst && dateIso <= lastKst
  }
  const dayStart = new Date(`${dateIso}T00:00:00+09:00`).getTime()
  const dayEnd   = new Date(`${dateIso}T23:59:59+09:00`).getTime()
  const s = new Date(ev.startAt).getTime()
  const e = new Date(ev.endAt).getTime()
  return !(s > dayEnd || e <= dayStart)
}

/** dateIso(YYYY-MM-DD) → "5월 21일 (목)" */
function fmtPopupHeader(dateIso: string): string {
  const [y, m, d] = dateIso.split('-').map(Number)
  return format(new Date(y, m - 1, d), 'M월 d일 (eee)', { locale: ko })
}

/** 셀/더보기 클릭 시 뜨는 그날 일정 목록 팝업 */
function DayPopup<T extends MonthGridEvent>({
  dateIso, events, onEventClick, onClose,
}: {
  dateIso: string
  events: T[]
  onEventClick: (ev: T) => void
  onClose: () => void
}) {
  const dayEvents = useMemo(() => {
    return events
      .filter(ev => eventOccursOn(ev, dateIso))
      .sort((a, b) => {
        if (a.isAllDay !== b.isAllDay) return a.isAllDay ? -1 : 1
        return new Date(a.startAt).getTime() - new Date(b.startAt).getTime()
      })
  }, [events, dateIso])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm max-h-[70vh] overflow-y-auto rounded-[12px] bg-surface shadow-popover border border-border"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 flex items-center justify-between px-4 py-3 border-b border-border bg-surface">
          <h3 className="text-sm font-semibold text-text-primary">{fmtPopupHeader(dateIso)}</h3>
          <button type="button" onClick={onClose} className="text-text-muted hover:text-text-primary" aria-label="닫기">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-3 space-y-1.5">
          {dayEvents.length === 0 ? (
            <p className="py-6 text-center text-sm text-text-muted">일정이 없습니다.</p>
          ) : dayEvents.map(ev => {
            const s = TYPE_STYLE[ev.inferredType] ?? TYPE_STYLE.other
            return (
              <button
                key={ev.id}
                type="button"
                onClick={() => onEventClick(ev)}
                className="w-full text-left px-2.5 py-1.5 rounded-[8px] leading-tight hover:ring-1 hover:ring-primary-300"
                style={{ backgroundColor: s.bg, color: s.fg, borderLeft: `3px solid ${s.border}` }}
              >
                <div className="text-[10px] tabular-nums opacity-80 flex items-center gap-1">
                  <span>{ev.isAllDay ? '종일' : `${fmtTime(ev.startAt)}~${fmtTime(ev.endAt)}`}</span>
                </div>
                <div className="text-[13px]">{ev.title || '(제목 없음)'}</div>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
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
  // 셀/더보기 클릭 시 그날 일정 목록 팝업의 대상 날짜 (YYYY-MM-DD)
  const [popupDate, setPopupDate] = useState<string | null>(null)

  const handleEventPick = (ev: T) => {
    setPopupDate(null)
    onEventClick(ev)
  }

  return (
    <div className="nclick-rbc bg-surface border border-border rounded-[10px] p-2 sm:p-3" style={{ height: 'calc(100vh - 220px)', minHeight: 480 }}>
      <Calendar<RbcEvent<T>>
        localizer={localizer}
        culture="ko"
        events={rbcEvents}
        date={date}
        onNavigate={onNavigate}
        view="month"
        onView={() => {}}
        views={['month']}
        selectable="ignoreEvents"
        onSelectEvent={(e) => onEventClick(e.resource)}
        onSelectSlot={(slot) => setPopupDate(toKstIsoDate(slot.start))}
        onDrillDown={(d) => setPopupDate(toKstIsoDate(d))}
        onShowMore={(_evts, d) => setPopupDate(toKstIsoDate(d))}
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
          showMore: (count: number) => `⋯ ${count}`,
          noEventsInRange: '기간 내 일정이 없습니다.',
        }}
        style={{ height: '100%' }}
      />

      {popupDate && (
        <DayPopup
          dateIso={popupDate}
          events={events}
          onEventClick={handleEventPick}
          onClose={() => setPopupDate(null)}
        />
      )}
    </div>
  )
}
