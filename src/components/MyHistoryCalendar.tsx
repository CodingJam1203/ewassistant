'use client'

/**
 * MyHistoryCalendar
 *
 * MY PAGE의 "내 제출 내역 → 캘린더뷰" 탭 본체.
 *
 * 데이터:
 *   - work_log_submissions에서 본인 월 단위 fetch (mine=true, from/to)
 *   - lib/submissions/finalize-by-day.ts의 indexFinalsByDate로 날짜별 최종 상태 산출
 *     → 일자별 최종 보고 탭과 동일한 정의 공유
 *   - /api/calendar/range로 Google 캘린더 휴가/일정 같이 fetch (옵션)
 *
 * 표시:
 *   - 월간 그리드 (PC) / 리스트 (모바일)
 *   - 각 셀에 핵심 정보 2~3 라인 + 더보기 +N
 *   - 셀 클릭 → CalendarDayDetailModal에서 상세 + 수정 트리거
 *   - 우상단: 월 이동 / 오늘 / 새로고침 / 휴가 등록
 *
 * 시각 구분:
 *   - N-Click 출퇴근 보고: primary chip
 *   - N-Click 휴가 (leave_timeline 있음): warning chip
 *   - Google 일정: info chip (얇은 outline)
 *   - Google 휴가 라벨: warning chip (다른 outline 스타일)
 */

import { useEffect, useMemo, useState, useCallback } from 'react'
import {
  ChevronLeft, ChevronRight, RefreshCw, CalendarPlus, Plane, Clock,
} from 'lucide-react'
import { format, addMonths, subMonths, startOfMonth, endOfMonth, getDay, getDate, isSameDay } from 'date-fns'
import { ko } from 'date-fns/locale'
import { Button, Badge, FilterBar } from '@/components/ui'
import { cn } from '@/lib/utils/cn'
import { indexFinalsByDate } from '@/lib/submissions/finalize-by-day'
import VacationRegisterModal from '@/components/VacationRegisterModal'
import CalendarDayDetailModal from '@/components/CalendarDayDetailModal'
import type { SubmissionRow } from '@/components/SubmissionsRawTable'
import type { UserCalendarLookup } from '@/types/leave-calendar'
import { resolveDisplayLocations, formatChipsArrow } from '@/lib/work-locations-v2'
import type { LeaveTimeline, LeaveTimelineItem } from '@/types/leave-timeline'
import type { DayStatus, SubmissionStatusResponse } from '@/app/api/my/submission-status/route'

interface MyHistoryCalendarProps {
  /** 셀 / 상세 모달의 ✏ 수정 버튼이 트리거하는 콜백 (부모가 WorkLogModal 띄움) */
  onEditWorkLog?: (workLogId: string, scope: 'check_in' | 'check_out') => void
  /** 상세 모달의 "출근보고 작성" 버튼 — 부모가 그 날짜로 CheckInModal 띄움 */
  onCreateCheckIn?: (date: string) => void
  /** 상세 모달의 "퇴근보고 작성" 버튼 — 부모가 그 날짜로 WorkLogModal 신규 제출 띄움 */
  onCreateCheckOut?: (date: string) => void
}

interface DayData {
  date: string  // YYYY-MM-DD
  inMonth: boolean
  isToday: boolean
  isWeekend: boolean
  checkIn: SubmissionRow | null
  checkOut: SubmissionRow | null
  /** Google 캘린더 lookup (휴가 + 일정) */
  calendar: UserCalendarLookup | null
}

/** YYYY-MM-DD format helpers (KST 기반 today) */
function fmtDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

/** "HH:mm:ss" / "HH:mm" → "HH:mm" */
function trimToHHmm(s: string | null | undefined): string {
  if (!s) return ''
  return s.slice(0, 5)
}

/** SubmissionRow에서 표시용 근무장소 (v2 chips 우선, fallback 단일) */
function extractWorkLocation(row: SubmissionRow | null): string | null {
  if (!row) return null
  const chips = resolveDisplayLocations({
    actual: row.actual_work_locations,
    planned: row.planned_work_locations,
    legacyActualTimeline: row.work_location_timeline as unknown as never,
    legacyExpectedTimeline: row.expected_work_location_timeline as unknown as never,
    legacyWorkLocation: row.work_location,
    legacyExpectedWorkLocation: row.expected_work_location,
  })
  if (chips && chips.length > 0) return formatChipsArrow(chips)
  if (row.work_location) return row.work_location
  if (row.expected_work_location) return row.expected_work_location
  return null
}

/** SubmissionRow의 leave_timeline에서 첫 휴가 항목 라벨 (있으면) */
function extractLeaveLabel(row: SubmissionRow | null): string | null {
  if (!row) return null
  const tl = row.leave_timeline as LeaveTimeline | null | undefined
  if (!Array.isArray(tl) || tl.length === 0) return null
  const item = tl[0] as LeaveTimelineItem
  return item?.label ?? null
}

/**
 * expected_work_location_timeline 또는 work_location_timeline의 마지막 항목에서
 * 퇴근(예정) 시각을 추출한다. 마지막 kind가 'expected_checkout' 또는 'checkout'일 때만 인정.
 */
function extractCheckoutTime(
  tl: Array<{ kind?: string; startTime?: string }> | null | undefined,
): string | null {
  if (!Array.isArray(tl) || tl.length === 0) return null
  const last = tl[tl.length - 1]
  if (last?.kind === 'expected_checkout' || last?.kind === 'checkout') {
    return last.startTime ?? null
  }
  return null
}

export default function MyHistoryCalendar({ onEditWorkLog, onCreateCheckIn, onCreateCheckOut }: MyHistoryCalendarProps) {
  // 현재 보고 있는 월 (그 월의 1일 기준 Date 객체)
  const [cursor, setCursor] = useState<Date>(() => startOfMonth(new Date()))
  const [rows, setRows] = useState<SubmissionRow[]>([])
  const [calendar, setCalendar] = useState<Record<string, UserCalendarLookup>>({})
  const [statusMap, setStatusMap] = useState<Map<string, DayStatus>>(new Map())
  const [statusSummary, setStatusSummary] = useState<SubmissionStatusResponse['summary'] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [vacationOpen, setVacationOpen] = useState(false)
  const [selectedDate, setSelectedDate] = useState<string | null>(null)

  // useMemo로 안정화 — 매 렌더마다 새 Date 객체가 만들어지면
  // fetchAll의 useCallback이 재생성되어 useEffect가 무한 재실행됨.
  const monthStart = useMemo(() => startOfMonth(cursor), [cursor])
  const monthEnd   = useMemo(() => endOfMonth(cursor),   [cursor])
  const monthLabel = format(cursor, 'yyyy년 M월', { locale: ko })

  // 그리드: 월 시작 일요일부터 월 종료 토요일까지 (보통 35~42칸)
  const gridStart = useMemo(() => {
    const d = new Date(monthStart)
    const dow = getDay(d) // 0=Sun
    d.setDate(d.getDate() - dow)
    return d
  }, [monthStart])
  const gridEnd = useMemo(() => {
    const d = new Date(monthEnd)
    const dow = getDay(d)
    d.setDate(d.getDate() + (6 - dow))
    return d
  }, [monthEnd])

  /**
   * 데이터 fetch — submissions와 calendar를 독립적으로 처리.
   *
   * - submissions(필수): 실패 시 에러 배너. 단, **이미 데이터가 있으면 silent**
   *   (이전 성공 fetch의 결과 + 새 시도 실패 → 배너 띄우면 사용자 혼란).
   * - calendar(선택): 실패 시 조용히 무시.
   * - Promise.all 안 씀 — 한쪽 실패가 다른 쪽 fetch를 막지 않게.
   */
  const fetchAll = useCallback(async () => {
    setLoading(true)
    setError(null)
    const from = fmtDate(monthStart)
    const to   = fmtDate(monthEnd)

    // 1) 본인 제출 이력 (필수)
    try {
      const res = await fetch(
        `/api/work-log-submissions?mine=true&from=${from}&to=${to}&limit=1000`,
        { credentials: 'same-origin' },
      )
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data?.error ?? `제출 이력 조회 실패 (${res.status})`)
      } else {
        setRows((data?.rows ?? []) as SubmissionRow[])
      }
    } catch (err: unknown) {
      const m = err instanceof Error ? err.message : String(err)
      console.warn('[calendar] submissions fetch failed:', m)
      // 이미 데이터를 한 번 가져왔다면 새 fetch 실패는 silent — 기존 화면 그대로 유지.
      // (Vercel cold start, 일시적 세션 갱신 등에서 transient하게 실패할 수 있어 사용자한테
      //  굳이 알리지 않음. 진짜로 데이터 0건이면 배너 노출.)
      setRows(prev => {
        if (prev.length === 0) {
          setError(`제출 이력 조회 실패 — 네트워크/세션 상태를 확인해주세요. (${m})`)
        }
        return prev
      })
    }

    // 1.5) 본인 일자별 보고 상태 (미보고 가시화용 — best-effort, 실패해도 무시)
    try {
      const res = await fetch(
        `/api/my/submission-status?from=${from}&to=${to}`,
        { credentials: 'same-origin' },
      )
      if (res.ok) {
        const data = await res.json().catch(() => null) as SubmissionStatusResponse | null
        if (data && Array.isArray(data.days)) {
          const map = new Map<string, DayStatus>()
          for (const d of data.days) map.set(d.date, d.status)
          setStatusMap(map)
          setStatusSummary(data.summary)
        }
      }
    } catch (err) {
      console.warn('[calendar] submission-status fetch failed (ignored):', err)
    }

    // 2) Google 캘린더 일정 (best-effort)
    try {
      const res = await fetch(
        `/api/calendar/range?from=${fmtDate(gridStart)}&to=${fmtDate(gridEnd)}`,
        { credentials: 'same-origin' },
      )
      if (res.ok) {
        const data = await res.json().catch(() => ({}))
        if (data?.byDate && typeof data.byDate === 'object') {
          setCalendar(data.byDate as Record<string, UserCalendarLookup>)
        }
      }
    } catch (err: unknown) {
      const m = err instanceof Error ? err.message : String(err)
      console.warn('[calendar] google calendar fetch failed (ignored):', m)
    }

    setLoading(false)
  }, [monthStart, monthEnd, gridStart, gridEnd])

  useEffect(() => { fetchAll() }, [fetchAll])

  /** rows → date → finals 인덱스 */
  const finalsByDate = useMemo(() => indexFinalsByDate(rows), [rows])

  /** 그리드 칸별 데이터 빌드 */
  const days: DayData[] = useMemo(() => {
    const out: DayData[] = []
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const cur = new Date(gridStart)
    while (cur <= gridEnd) {
      const date = fmtDate(cur)
      const dow = getDay(cur)
      const inMonth = cur.getMonth() === cursor.getMonth() && cur.getFullYear() === cursor.getFullYear()
      const slot = finalsByDate.get(date)
      out.push({
        date,
        inMonth,
        isToday: isSameDay(cur, today),
        isWeekend: dow === 0 || dow === 6,
        checkIn:  slot?.checkIn  ?? null,
        checkOut: slot?.checkOut ?? null,
        calendar: calendar[date] ?? null,
      })
      cur.setDate(cur.getDate() + 1)
    }
    return out
  }, [gridStart, gridEnd, cursor, finalsByDate, calendar])

  return (
    <div className="space-y-3">
      {/* 툴바: 월 이동 + 오늘 + 휴가 등록 */}
      <FilterBar>
        <FilterBar.Field label="월">
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" iconOnly onClick={() => setCursor(c => subMonths(c, 1))} aria-label="이전 달">
              <ChevronLeft className="h-4 w-4" aria-hidden />
            </Button>
            <div className="min-w-[110px] text-center font-semibold text-text-primary">{monthLabel}</div>
            <Button variant="ghost" size="sm" iconOnly onClick={() => setCursor(c => addMonths(c, 1))} aria-label="다음 달">
              <ChevronRight className="h-4 w-4" aria-hidden />
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setCursor(startOfMonth(new Date()))}>
              오늘
            </Button>
          </div>
        </FilterBar.Field>

        {statusSummary && (
          <FilterBar.Field label="이번 달">
            <div className="flex items-center gap-1.5 flex-wrap text-[12px]">
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-success-bg text-success-text border border-success-border">
                ✓ <span className="tabular-nums font-semibold">{statusSummary.complete}</span>
              </span>
              {statusSummary.missingCheckout > 0 && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-warning-bg text-warning-text border border-warning-border">
                  ⚠ 퇴근누락 <span className="tabular-nums font-semibold">{statusSummary.missingCheckout}</span>
                </span>
              )}
              {statusSummary.missingAll > 0 && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-danger-bg text-danger-text border border-danger-border">
                  🚫 미보고 <span className="tabular-nums font-semibold">{statusSummary.missingAll}</span>
                </span>
              )}
              {statusSummary.onLeave > 0 && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-info-bg text-info-text border border-info-border">
                  🛬 휴가 <span className="tabular-nums font-semibold">{statusSummary.onLeave}</span>
                </span>
              )}
            </div>
          </FilterBar.Field>
        )}

        <div className="ml-auto flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={fetchAll}>
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} aria-hidden />
            새로고침
          </Button>
          <Button variant="primary" size="sm" onClick={() => setVacationOpen(true)}>
            <CalendarPlus className="h-4 w-4" aria-hidden />
            휴가 등록
          </Button>
        </div>
      </FilterBar>

      {error && (
        <div className="rounded-[10px] bg-danger-bg border border-danger-border p-3 text-sm text-danger-text">
          {error}
        </div>
      )}

      {/* PC: 월간 그리드 */}
      <div className="hidden md:block bg-surface border border-border rounded-2xl shadow-[var(--shadow-card)] overflow-hidden">
        {/* 요일 헤더 */}
        <div className="grid grid-cols-7 bg-background border-b border-border">
          {['일', '월', '화', '수', '목', '금', '토'].map((d, i) => (
            <div
              key={d}
              className={cn(
                'px-3 py-2 text-center text-[12px] font-semibold',
                i === 0 ? 'text-danger-text' : i === 6 ? 'text-info-text' : 'text-text-secondary',
              )}
            >
              {d}
            </div>
          ))}
        </div>
        {/* 날짜 그리드 */}
        <div className="grid grid-cols-7 auto-rows-[minmax(112px,auto)]">
          {days.map(day => (
            <DayCell
              key={day.date}
              data={day}
              status={statusMap.get(day.date) ?? null}
              onClick={() => setSelectedDate(day.date)}
            />
          ))}
        </div>
      </div>

      {/* 모바일: 리스트 fallback */}
      <div className="md:hidden space-y-2">
        {days.filter(d => d.inMonth).map(day => (
          <DayListItem
            key={day.date}
            data={day}
            status={statusMap.get(day.date) ?? null}
            onClick={() => setSelectedDate(day.date)}
          />
        ))}
      </div>

      {/* 모달은 상호 배타 — vacationOpen이면 상세 모달 숨김 (둘 겹쳐 보이는 문제 방지).
          상세 → "이 날 휴가 등록" 클릭 시 selectedDate는 그대로 둬서 prefill에 사용,
          휴가 취소 시 상세 모달이 자연스럽게 다시 나타나고,
          휴가 등록 성공 시 selectedDate도 함께 초기화해서 모두 닫는다. */}

      {/* 휴가 등록 모달 (우선) */}
      {vacationOpen && (
        <VacationRegisterModal
          initialStartDate={selectedDate ?? undefined}
          initialEndDate={selectedDate ?? undefined}
          onClose={() => setVacationOpen(false)}
          onSuccess={() => {
            setVacationOpen(false)
            setSelectedDate(null)
            fetchAll()
          }}
        />
      )}

      {/* 날짜 상세 모달 — 휴가 모달이 떠 있을 때는 가린다 */}
      {selectedDate && !vacationOpen && (
        <CalendarDayDetailModal
          date={selectedDate}
          checkIn={finalsByDate.get(selectedDate)?.checkIn ?? null}
          checkOut={finalsByDate.get(selectedDate)?.checkOut ?? null}
          calendar={calendar[selectedDate] ?? null}
          onClose={() => setSelectedDate(null)}
          // ✏ 수정 누르면 상세 모달 먼저 닫고 부모(home)의 WorkLogModal로 전환.
          // 그렇지 않으면 두 모달이 겹쳐 보임.
          onEditWorkLog={(workLogId, scope) => {
            setSelectedDate(null)
            onEditWorkLog?.(workLogId, scope)
          }}
          onRegisterVacation={() => {
            // 상세 모달에서 "이 날 휴가 등록" 클릭 시 휴가 모달로 전환
            // (selectedDate는 유지 — 휴가 모달의 시작/종료일 prefill에 쓰임)
            setVacationOpen(true)
          }}
          onCreateCheckIn={onCreateCheckIn ? () => {
            // 상세 모달 먼저 닫고 부모의 CheckInModal로 전환
            const d = selectedDate
            setSelectedDate(null)
            if (d) onCreateCheckIn(d)
          } : undefined}
          onCreateCheckOut={onCreateCheckOut ? () => {
            // 상세 모달 먼저 닫고 부모의 WorkLogModal(신규)로 전환
            const d = selectedDate
            setSelectedDate(null)
            if (d) onCreateCheckOut(d)
          } : undefined}
        />
      )}
    </div>
  )
}

// ─── 날짜 셀 (PC) ──────────────────────────────────────────────────────────────

const STATUS_BAR_COLOR: Record<DayStatus, string> = {
  complete:         'bg-success-text',
  missing_checkout: 'bg-warning-text',
  missing_all:      'bg-danger-text',
  leave:            'bg-info-text',
  weekend:          'bg-transparent',
  holiday:          'bg-transparent',
  pre_signup:       'bg-transparent',
  future:           'bg-transparent',
}

function DayCell({ data, status, onClick }: { data: DayData; status: DayStatus | null; onClick: () => void }) {
  const items = buildDisplayItems(data)
  const dayNum = getDate(new Date(data.date + 'T00:00:00'))

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group relative text-left px-2 pt-2 pb-1.5 border-r border-b border-border last:border-r-0',
        'flex flex-col gap-1 min-h-[112px]',
        'transition-colors hover:bg-primary-50/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:z-10',
        !data.inMonth && 'bg-background/40',
      )}
    >
      {data.inMonth && status && status !== 'weekend' && status !== 'holiday' && status !== 'pre_signup' && status !== 'future' && (
        <span
          className={cn('absolute left-0 top-0 bottom-0 w-1', STATUS_BAR_COLOR[status])}
          aria-hidden
        />
      )}
      <div className="flex items-center justify-between gap-1">
        <span
          className={cn(
            'inline-flex items-center justify-center text-[12px] font-semibold tabular-nums',
            !data.inMonth && 'text-text-disabled',
            data.inMonth && data.isWeekend && getDay(new Date(data.date + 'T00:00:00')) === 0 && 'text-danger-text',
            data.inMonth && data.isWeekend && getDay(new Date(data.date + 'T00:00:00')) === 6 && 'text-info-text',
            data.inMonth && !data.isWeekend && 'text-text-primary',
            data.isToday && 'h-6 min-w-[24px] rounded-full bg-primary-600 !text-white px-1.5',
          )}
        >
          {dayNum}
        </span>
        {/* 미보고 상태 칩 — 좌측 컬러바와 같은 색을 텍스트 형태로 명시 표기 */}
        {data.inMonth && (status === 'missing_all' || status === 'missing_checkout') && (
          <span
            className={cn(
              'inline-flex items-center text-[10px] font-semibold px-1.5 rounded-full leading-[16px] shrink-0',
              status === 'missing_all'
                ? 'bg-danger-text text-white'
                : 'bg-warning-text text-white',
            )}
          >
            {status === 'missing_all' ? '미보고' : '퇴근누락'}
          </span>
        )}
      </div>
      <div className="flex flex-col gap-0.5">
        {items.slice(0, 3).map((it, i) => (
          <span
            key={i}
            className={cn(
              'inline-flex items-center gap-1 text-[11px] leading-tight px-1.5 py-0.5 rounded-md truncate max-w-full',
              ITEM_STYLE[it.tone],
            )}
            title={it.title ?? it.text}
          >
            {it.icon}
            <span className="truncate">{it.text}</span>
          </span>
        ))}
        {items.length > 3 && (
          <span className="text-[10px] text-text-muted ml-1">+{items.length - 3}</span>
        )}
      </div>
    </button>
  )
}

// ─── 날짜 리스트 항목 (모바일) ────────────────────────────────────────────────

function DayListItem({
  data, status, onClick,
}: { data: DayData; status: DayStatus | null; onClick: () => void }) {
  const items = buildDisplayItems(data)
  const dayDate = new Date(data.date + 'T00:00:00')
  const showMissingChip = status === 'missing_all' || status === 'missing_checkout'

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'relative w-full text-left bg-surface border border-border rounded-2xl p-3 overflow-hidden',
        'flex items-start gap-3',
        'transition-colors hover:bg-surface-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
      )}
    >
      {/* 좌측 컬러바 — PC 셀과 동일한 시각 신호 */}
      {status && status !== 'weekend' && status !== 'holiday' && status !== 'pre_signup' && status !== 'future' && (
        <span
          className={cn('absolute left-0 top-0 bottom-0 w-1', STATUS_BAR_COLOR[status])}
          aria-hidden
        />
      )}
      <div
        className={cn(
          'shrink-0 w-12 text-center',
          data.isToday ? 'text-primary-600' : 'text-text-primary',
        )}
      >
        <div className="text-[10px] font-medium text-text-muted">
          {format(dayDate, 'EEE', { locale: ko })}
        </div>
        <div className={cn(
          'text-lg font-bold tabular-nums',
          getDay(dayDate) === 0 && !data.isToday && 'text-danger-text',
          getDay(dayDate) === 6 && !data.isToday && 'text-info-text',
        )}>
          {getDate(dayDate)}
        </div>
      </div>
      <div className="flex-1 min-w-0 flex flex-col gap-1">
        {showMissingChip && (
          <span
            className={cn(
              'inline-flex items-center text-[11px] font-semibold px-2 py-0.5 rounded-full self-start',
              status === 'missing_all'
                ? 'bg-danger-text text-white'
                : 'bg-warning-text text-white',
            )}
          >
            {status === 'missing_all' ? '미보고' : '퇴근 누락'}
          </span>
        )}
        {items.length === 0 && !showMissingChip ? (
          <span className="text-[12px] text-text-muted">기록 없음</span>
        ) : items.map((it, i) => (
          <span
            key={i}
            className={cn(
              'inline-flex items-center gap-1 text-[12px] px-2 py-0.5 rounded-md self-start max-w-full',
              ITEM_STYLE[it.tone],
            )}
            title={it.title ?? it.text}
          >
            {it.icon}
            <span className="truncate">{it.text}</span>
          </span>
        ))}
      </div>
    </button>
  )
}

// ─── 셀 표시 항목 빌드 ────────────────────────────────────────────────────────

type ItemTone = 'primary' | 'planned' | 'success' | 'warning' | 'info' | 'neutral'

interface DisplayItem {
  tone: ItemTone
  icon?: React.ReactNode
  text: string
  title?: string
}

/**
 * tone별 chip 스타일.
 *
 * 시각적 위계 (사용자가 한 눈에 구분되도록 채움/외곽선/배경 톤 차별화):
 *   - primary  : 솔리드 채움 + 진한 텍스트  → "확정된 실제 데이터" (실제 출퇴근)
 *   - planned  : 점선 외곽선 + 옅은 텍스트  → "아직 예정만" (출근예정)
 *   - warning  : 솔리드 노랑              → N-Click 휴가
 *   - info     : 솔리드 옅은 파랑          → Google 캘린더 일정
 *   - success  : 솔리드 초록              → 향후 확장용
 *   - neutral  : 회색                    → 정보 없음
 */
const ITEM_STYLE: Record<ItemTone, string> = {
  primary: 'bg-primary-50 text-primary-700 border border-primary-200',
  planned: 'bg-transparent text-text-secondary border border-dashed border-border-strong',
  success: 'bg-success-bg text-success-text border border-success-border',
  warning: 'bg-warning-bg text-warning-text border border-warning-border',
  info:    'bg-info-bg text-info-text border border-info-border',
  neutral: 'bg-surface-muted text-text-secondary border border-border',
}

/**
 * DayData → 셀에 표시할 chip 목록.
 * 우선순위:
 *   1) N-Click 휴가 (warning chip) — leave_timeline 있는 경우
 *   2) 실제 출퇴근 — checked_in_at + checked_out_at (primary chip)
 *      또는 출근만 (warning chip)
 *   3) 출근예정만 (info chip)
 *   4) Google 휴가 라벨 (warning chip, outline 스타일)
 *   5) Google 일정 (info chip)
 *
 * 너무 길어지지 않게 핵심 1~2건만 + 나머지는 +N.
 */
function buildDisplayItems(data: DayData): DisplayItem[] {
  const out: DisplayItem[] = []
  const co = data.checkOut
  const ci = data.checkIn

  // 1) N-Click 휴가 (퇴근보고에 leave_timeline 있는 케이스)
  const leaveLabel = extractLeaveLabel(co) ?? extractLeaveLabel(ci)
  if (leaveLabel) {
    out.push({
      tone: 'warning',
      icon: <Plane className="h-3 w-3" aria-hidden />,
      text: leaveLabel,
      title: `N-Click 휴가: ${leaveLabel}`,
    })
  }

  // 2) 실제 출퇴근
  const startActual = trimToHHmm(co?.start_time)
  const endActual   = trimToHHmm(co?.end_time)
  const loc = extractWorkLocation(co)
  if (startActual && endActual) {
    out.push({
      tone: 'primary',
      icon: <Clock className="h-3 w-3" aria-hidden />,
      text: `${startActual}~${endActual}${loc ? ' ' + loc : ''}`,
      title: '실제 출퇴근',
    })
  } else if (startActual) {
    out.push({
      tone: 'primary',
      icon: <Clock className="h-3 w-3" aria-hidden />,
      text: `출근 ${startActual}${loc ? ' / ' + loc : ''}`,
      title: '출근만 작성됨',
    })
  } else if (ci) {
    // 3) 출근보고만 있는 케이스 (D+1 사전 보고 또는 D-day 출근 전)
    //    새 모델: ci.start_time/end_time/work_location 직접 사용
    //    legacy fallback: expected_work_time/expected_work_location
    const eStart = trimToHHmm(ci.start_time ?? '')
                || trimToHHmm(ci.expected_work_time ?? '')
    const eEnd   = trimToHHmm(ci.end_time ?? '')
                || trimToHHmm(extractCheckoutTime(ci.expected_work_location_timeline) ?? '')
    const eLoc   = extractWorkLocation(ci)
                ?? ci.expected_work_location
                ?? null
    if (eStart || eEnd || eLoc) {
      const range = eStart && eEnd
        ? `${eStart}~${eEnd}`
        : (eStart || eEnd || '-')
      out.push({
        tone: 'planned',
        icon: <Clock className="h-3 w-3" aria-hidden />,
        text: `예정 ${range}${eLoc ? ' ' + eLoc : ''}`,
        title: '출근예정',
      })
    }
  }

  // 4) Google 휴가 라벨 (별개로 표시 — N-Click 휴가와 시각적 구분).
  //    과거 날짜 + work_log 없음 → "(자동인정)" 라벨 추가:
  //    /api/work-hours에서 시간 계산에 자동 합산되는 케이스 명시.
  const cal = data.calendar
  if (cal?.leaveLabel && !leaveLabel) {
    const todayStr = format(new Date(), 'yyyy-MM-dd')
    const isPast = data.date < todayStr
    const noWorkLog = !data.checkIn && !data.checkOut
    const isAutoRecognized = isPast && noWorkLog
    out.push({
      tone: 'warning',
      icon: <Plane className="h-3 w-3" aria-hidden />,
      text: `Google: ${cal.leaveLabel}${isAutoRecognized ? ' (자동인정)' : ''}`,
      title: isAutoRecognized
        ? 'Google 캘린더 휴가 — 시간 계산 자동 인정'
        : 'Google 캘린더 휴가',
    })
  }

  // 5) Google 일정 (휴가 아닌)
  if (cal?.events && cal.events.length > 0) {
    for (const ev of cal.events) {
      const t = ev.startTime && ev.endTime
        ? `${ev.startTime}~${ev.endTime} ${ev.title}`
        : ev.startTime
          ? `${ev.startTime}~ ${ev.title}`
          : `(종일) ${ev.title}`
      out.push({ tone: 'info', text: t, title: 'Google 일정' })
    }
  }

  return out
}
