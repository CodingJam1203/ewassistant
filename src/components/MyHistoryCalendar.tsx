'use client'

/**
 * MyHistoryCalendar
 *
 * MY PAGE의 "내 제출 내역 → 캘린더뷰" 탭 본체.
 *
 * 데이터:
 *   - work_log_submissions에서 본인 월 단위 fetch (mine=true, from/to)
 *   - work_logs에서 본인 월 단위 fetch (mine=true, from/to)
 *   - lib/work-logs/unified-times.ts의 pickLatestWorkLogPerDay로 단일 row 추출
 *   - workLogToSubmissionPair 어댑터로 CalendarDayDetailModal 호환 shape 변환
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
import { Button, FilterBar } from '@/components/ui'
import { cn } from '@/lib/utils/cn'
import VacationRegisterModal from '@/components/VacationRegisterModal'
import CalendarDayDetailModal from '@/components/CalendarDayDetailModal'
import EventEditModal, { type EventEditInitial, type CalendarType } from '@/components/calendar/EventEditModal'
import type { SubmissionRow } from '@/components/SubmissionsRawTable'
import type { UserCalendarLookup, CalendarEventChunk } from '@/types/leave-calendar'
import { resolveDisplayLocations, formatChipsArrow } from '@/lib/work-locations-v2'
import type { WorkLocations } from '@/types/work-locations-v2'
import type { LeaveTimeline, LeaveTimelineItem } from '@/types/leave-timeline'
import type { DayStatus, SubmissionStatusResponse } from '@/app/api/my/submission-status/route'
import {
  displayTimeRange,
  pickLatestWorkLogPerDay,
  type WorkLogState,
} from '@/lib/work-logs/unified-times'

interface MyHistoryCalendarProps {
  /** 셀 / 상세 모달의 ✏ 수정 버튼이 트리거하는 콜백 (부모가 WorkLogModal 띄움) */
  onEditWorkLog?: (workLogId: string, scope: 'check_in' | 'check_out', cellDate?: string) => void
  /** 상세 모달의 "출근보고 작성" 버튼 — 부모가 그 날짜로 CheckInModal 띄움 */
  onCreateCheckIn?: (date: string) => void
  /** 상세 모달의 "퇴근보고 작성" 버튼 — 부모가 그 날짜로 WorkLogModal 신규 제출 띄움 */
  onCreateCheckOut?: (date: string) => void
  /** 외부에서 데이터 새로고침 트리거 — 부모의 모달 onSuccess에서 ++ */
  refreshKey?: number
}

interface DayData {
  date: string  // YYYY-MM-DD
  inMonth: boolean
  isToday: boolean
  isWeekend: boolean
  /** SubmissionRow shape으로 어댑트된 출근보고 영역 (모달 호환). row 없으면 null */
  checkIn: SubmissionRow | null
  /** SubmissionRow shape으로 어댑트된 퇴근보고 영역. check_in_done/check_out_done일 때만 */
  checkOut: SubmissionRow | null
  /** 4단계 분류 — buildDisplayItems에서 시각 표시 룰에 사용 */
  state: WorkLogState | null
  /** Google 캘린더 lookup (휴가 + 일정) */
  calendar: UserCalendarLookup | null
}

/** /api/work-logs GET이 돌려주는 row 형태 (필요 필드만 좁힘) */
interface WorkLogRow {
  id: string
  user_email: string
  name: string | null
  division: string | null
  team: string | null
  leave_date: string
  created_at: string
  // SoT (Stage 0-1)
  planned_start_time: string | null
  planned_end_time: string | null
  actual_start_time: string | null
  actual_end_time: string | null
  // Stage 4: 서버 read-time 보정 결과 (출근완료 미사용 팀 자동 보정)
  effective_actual_start_time?: string | null
  // legacy fallback
  start_time: string | null
  end_time: string | null
  break_time: string | null
  actual_work_time: string | null
  // location / content
  work_location: string | null
  work_content: string | null
  expected_work_location: string | null
  expected_work_time: string | null
  expected_start_date: string | null
  actual_work_locations: WorkLocations | null
  planned_work_locations: WorkLocations | null
  work_location_timeline: Array<{ kind?: string; startTime?: string }> | null
  expected_work_location_timeline: Array<{ kind?: string; startTime?: string }> | null
  expected_leave_timeline: LeaveTimeline | null
  leave_timeline: LeaveTimeline | null
  // misc
  ew_value: string | null
  copy_text: string | null
  work_type_label: string | null
  attendance_record_type: string | null
  late_or_attendance_status: string | null
  previous_report_time: string | null
  current_report_time: string | null
  late_reason: string | null
  break_reason: string | null
}

/**
 * Stage 0-4c: work_logs row → SubmissionRow 한 쌍 어댑터.
 *
 * 정책서 "한 (user, date) row" 모델이라 출근보고/퇴근보고 영역 모두 한 row에서
 * 나옴. CalendarDayDetailModal과 4단계 표시 룰 buildDisplayItems가 기존
 * SubmissionRow shape을 받도록 그대로 두고, 어댑터에서 두 view로 펼친다.
 *
 *   checkIn  : planned_*  + 공통 필드 (항상 non-null when row exists)
 *   checkOut : actual_*   + 공통 필드 (check_in_done/check_out_done일 때만)
 */
function workLogToSubmissionPair(row: WorkLogRow): {
  checkIn: SubmissionRow
  checkOut: SubmissionRow | null
  state: WorkLogState
} {
  const { state, start, end } = displayTimeRange(row)
  // Stage 5: effective_actual_start_time이 있으면 보정값 사용
  const effectiveActualStart = row.effective_actual_start_time ?? row.actual_start_time
  const baseCommon = {
    id: row.id,
    user_email: row.user_email,
    name: row.name,
    division: row.division,
    team: row.team,
    target_date: row.leave_date,
    submitted_at: row.created_at,
    work_log_id: row.id,
    break_time: row.break_time,
    actual_work_time: row.actual_work_time,
    work_location: row.work_location,
    work_content: row.work_content,
    ew_value: row.ew_value,
    copy_text: row.copy_text,
    late_or_attendance_status: row.late_or_attendance_status,
    previous_report_time: row.previous_report_time,
    current_report_time: row.current_report_time,
    late_reason: row.late_reason,
    break_reason: row.break_reason,
    expected_start_date: row.expected_start_date,
    expected_work_time: row.expected_work_time,
    expected_work_location: row.expected_work_location,
    expected_work_location_timeline: row.expected_work_location_timeline,
    work_location_timeline: row.work_location_timeline,
    actual_work_locations: row.actual_work_locations,
    planned_work_locations: row.planned_work_locations,
    leave_timeline: row.leave_timeline,
    expected_leave_timeline: row.expected_leave_timeline,
    changed_fields: null,
    work_type_label: row.work_type_label,
    attendance_record_type: row.attendance_record_type,
  } satisfies Omit<SubmissionRow, 'report_type' | 'start_time' | 'end_time'>

  // checkIn 영역 — planned 시각 노출
  const checkIn: SubmissionRow = {
    ...baseCommon,
    report_type: 'check_in',
    start_time: row.planned_start_time ?? row.start_time,
    end_time:   row.planned_end_time   ?? row.end_time,
  }

  // checkOut 영역 — actual_start_time 이상 진행됐을 때만.
  // start = displayTimeRange의 start (check_in_done이면 actual_start, check_out_done이면 actual_start)
  // end   = displayTimeRange의 end   (check_in_done이면 planned_end, check_out_done이면 actual_end)
  const checkOut: SubmissionRow | null =
    state === 'check_in_done' || state === 'check_out_done'
      ? {
          ...baseCommon,
          report_type: 'check_out',
          // 실제 출근 시각 — Stage 4 보정값 우선
          start_time: effectiveActualStart,
          // 실제 퇴근 시각 — check_out_done일 때만, check_in_done이면 null
          end_time: state === 'check_out_done' ? row.actual_end_time : null,
        }
      : null

  // start/end는 buildDisplayItems가 displayTimeRange로 따로 처리하므로
  // 여기서 만든 checkIn/checkOut의 start/end는 모달 표시용으로만 쓰임.
  void start; void end
  return { checkIn, checkOut, state }
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

export default function MyHistoryCalendar({
  onEditWorkLog, onCreateCheckIn, onCreateCheckOut, refreshKey = 0,
}: MyHistoryCalendarProps) {
  // 현재 보고 있는 월 (그 월의 1일 기준 Date 객체)
  const [cursor, setCursor] = useState<Date>(() => startOfMonth(new Date()))
  const [workLogs, setWorkLogs] = useState<WorkLogRow[]>([])
  const [calendar, setCalendar] = useState<Record<string, UserCalendarLookup>>({})
  const [statusMap, setStatusMap] = useState<Map<string, DayStatus>>(new Map())
  const [statusSummary, setStatusSummary] = useState<SubmissionStatusResponse['summary'] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [vacationOpen, setVacationOpen] = useState(false)
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  // Phase 1.5e — EventEditModal 통합
  //   - { isCreate: true, initial: { ... default date prefill ... } } → 신규 등록
  //   - { isCreate: false, initial: { id, ...row } } → 수정
  const [eventModal, setEventModal] = useState<{ isCreate: boolean; initial: EventEditInitial | null } | null>(null)

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

    // 1) Stage 0-4c: work_logs 단일 row 모델로 fetch (정책서 SoT)
    try {
      const res = await fetch(
        `/api/work-logs?mine=true&from=${from}&to=${to}&limit=500`,
        { credentials: 'same-origin' },
      )
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        setError((data && (data as { error?: string }).error) ?? `근무로그 조회 실패 (${res.status})`)
      } else {
        // /api/work-logs GET은 array를 반환 (mine/filter)
        const arr = (Array.isArray(data) ? data : []) as WorkLogRow[]
        setWorkLogs(arr)
      }
    } catch (err: unknown) {
      const m = err instanceof Error ? err.message : String(err)
      console.warn('[calendar] work-logs fetch failed:', m)
      // 이미 데이터를 한 번 가져왔다면 새 fetch 실패는 silent — 기존 화면 그대로 유지.
      setWorkLogs(prev => {
        if (prev.length === 0) {
          setError(`근무로그 조회 실패 — 네트워크/세션 상태를 확인해주세요. (${m})`)
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

  useEffect(() => { fetchAll() }, [fetchAll, refreshKey])

  /** workLogs → date 별 단일 row → 어댑트된 (checkIn, checkOut) 쌍. */
  const pairsByDate = useMemo(() => {
    const latest = pickLatestWorkLogPerDay(workLogs)
    const map = new Map<string, ReturnType<typeof workLogToSubmissionPair>>()
    for (const r of latest) {
      map.set(r.leave_date, workLogToSubmissionPair(r))
    }
    return map
  }, [workLogs])

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
      const pair = pairsByDate.get(date)
      out.push({
        date,
        inMonth,
        isToday: isSameDay(cur, today),
        isWeekend: dow === 0 || dow === 6,
        checkIn:  pair?.checkIn  ?? null,
        checkOut: pair?.checkOut ?? null,
        state:    pair?.state    ?? null,
        calendar: calendar[date] ?? null,
      })
      cur.setDate(cur.getDate() + 1)
    }
    return out
  }, [gridStart, gridEnd, cursor, pairsByDate, calendar])

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
      {selectedDate && !vacationOpen && !eventModal && (
        <CalendarDayDetailModal
          date={selectedDate}
          checkIn={pairsByDate.get(selectedDate)?.checkIn ?? null}
          checkOut={pairsByDate.get(selectedDate)?.checkOut ?? null}
          calendar={calendar[selectedDate] ?? null}
          onClose={() => setSelectedDate(null)}
          // ✏ 수정 누르면 상세 모달 먼저 닫고 부모(home)의 WorkLogModal로 전환.
          // 그렇지 않으면 두 모달이 겹쳐 보임.
          onEditWorkLog={(workLogId, scope, cellDate) => {
            setSelectedDate(null)
            onEditWorkLog?.(workLogId, scope, cellDate)
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
          // Phase 1.5e — Google 캘린더 일정 chip 클릭 → EventEditModal 수정 모드
          onEditEvent={(ev: CalendarEventChunk) => {
            if (!ev.id) return
            setEventModal({
              isCreate: false,
              initial: {
                id: ev.id,
                title: ev.title,
                startAt: ev.startAt,
                endAt: ev.endAt,
                isAllDay: ev.isAllDay ?? false,
                inferredType: (ev.inferredType ?? 'other') as CalendarType,
                calendarId: ev.orgCalendarId,
                rrule: ev.rrule ?? null,
                recurringEventId: ev.recurringEventId ?? null,
              },
            })
          }}
          // Phase 1.5e — "+ 일정 등록" → EventEditModal 신규 모드, 해당 date prefill
          onCreateEvent={() => {
            const d = selectedDate
            if (!d) return
            // ISO 09:00 KST 시작 + 10:00 종료 default (EventEditModal 안에서 수정 가능)
            const startIso = new Date(`${d}T09:00:00+09:00`).toISOString()
            const endIso   = new Date(`${d}T10:00:00+09:00`).toISOString()
            setEventModal({
              isCreate: true,
              initial: { startAt: startIso, endAt: endIso, isAllDay: false },
            })
          }}
        />
      )}

      {/* Phase 1.5e — EventEditModal (수정/신규) */}
      {eventModal && (
        <EventEditModal
          isCreate={eventModal.isCreate}
          initial={eventModal.initial}
          onClose={() => setEventModal(null)}
          onSaved={() => {
            setEventModal(null)
            setSelectedDate(null)
            fetchAll()
          }}
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
 *
 * 정책서 캘린더 4단계 시각 표시 룰 (Stage 0-4c):
 *   - check_out_done : actual_start ~ actual_end       → primary chip
 *   - check_in_done  : actual_start → 예정 planned_end  → primary chip
 *   - planned_only   : planned_start ~ planned_end     → planned chip (점선)
 *   - no_data        : 표시 X (셀 layer의 미보고 칩이 책임)
 *
 * 추가 우선순위:
 *   1) N-Click 휴가 (warning chip) — leave_timeline 있는 경우
 *   2) 4단계 시각/장소 chip
 *   3) Google 휴가 라벨 / Google 일정
 */
function buildDisplayItems(data: DayData): DisplayItem[] {
  const out: DisplayItem[] = []
  const co = data.checkOut
  const ci = data.checkIn
  const state = data.state

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

  // 2) 4단계 시각 chip — 장소는 actual 우선 fallback planned
  const loc = extractWorkLocation(co) ?? extractWorkLocation(ci)
  if (state === 'check_out_done') {
    const s = trimToHHmm(co?.start_time)
    const e = trimToHHmm(co?.end_time)
    out.push({
      tone: 'primary',
      icon: <Clock className="h-3 w-3" aria-hidden />,
      text: `${s}~${e}${loc ? ' ' + loc : ''}`,
      title: '퇴근완료',
    })
  } else if (state === 'check_in_done') {
    const sa = trimToHHmm(co?.start_time)
    const pe = trimToHHmm(ci?.end_time)
    out.push({
      tone: 'primary',
      icon: <Clock className="h-3 w-3" aria-hidden />,
      text: `출근 ${sa} → 예정 ${pe}${loc ? ' ' + loc : ''}`,
      title: '출근완료, 퇴근 전',
    })
  } else if (state === 'planned_only') {
    const ps = trimToHHmm(ci?.start_time)
    const pe = trimToHHmm(ci?.end_time)
    out.push({
      tone: 'planned',
      icon: <Clock className="h-3 w-3" aria-hidden />,
      text: `예정 ${ps}~${pe}${loc ? ' ' + loc : ''}`,
      title: '출근예정',
    })
  }
  // state === 'no_data' or null: 표시 X — 미보고 칩은 셀 layer가 처리

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
