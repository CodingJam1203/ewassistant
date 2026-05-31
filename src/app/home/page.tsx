'use client'

/**
 * 홈 (/home) — 내 업무 처리 허브.
 *
 * 구성:
 *   1) 본인 오늘 상태 헤더 — 출근보고/퇴근보고 작성 버튼
 *   2) 본인 이번 달 근로현황 (compact)
 *   3) 내 제출 내역 (탭: 일자별 최종 / 캘린더뷰 / RAW)
 *
 * 디자인 시스템 — DESIGN.md 참고. ui/ 컴포넌트만 사용.
 */

import { memo, useState, useEffect, useCallback } from 'react'
import dynamic from 'next/dynamic'
import { format, addDays, parseISO } from 'date-fns'
import { LogIn, LogOut, RefreshCw, Clock, MapPin, Coffee, X, Check, LayoutGrid, Calendar as CalendarIcon, ChevronLeft, ChevronRight } from 'lucide-react'
import WorkHoursCard from '@/components/WorkHoursCard'
import SubmissionsRawTable from '@/components/SubmissionsRawTable'
import { Button, Badge, StatusCard, Select, DateInputWithDow } from '@/components/ui'
import type { StatusCardTone, BadgeVariant } from '@/components/ui'
import { cn } from '@/lib/utils/cn'
import type { WorkLog } from '@/types/work-log'
import type { MonthBaselines, UserMonthSummary } from '@/lib/utils/work-hours'
import type { TeamMemberCard } from '@/app/api/team-status/route'
import { computeWorkLogState, buttonsForState } from '@/lib/work-log-state'
import EditableLocationChips from '@/components/EditableLocationChips'
import BreakStartModal from '@/components/BreakStartModal'
import MissingReportsSummary from '@/components/MissingReportsSummary'
import { resolveDisplayLocations, resolvePlannedLocations, formatChipsArrow } from '@/lib/work-locations-v2'
import { useAutoRefetch } from '@/hooks/useAutoRefetch'

// 무거운 컴포넌트는 dynamic import — 초기 번들에서 빠지고 사용 시점에만 로드.
//   - WorkLogModal: 퇴근보고/수정 클릭 시
//   - CheckInModal: 출근보고 작성 클릭 시
//   - MyHistoryCalendar: 캘린더뷰 탭 클릭 시
// 각각 react-hook-form, zod, 다수 sub-component를 끌어들이므로 번들 절감 효과 큼.
const WorkLogModal = dynamic(() => import('@/components/WorkLogModal'), {
  loading: () => null,
})
const CheckInModal = dynamic(() => import('@/components/CheckInModal'), {
  loading: () => null,
})
const MyHistoryCalendar = dynamic(() => import('@/components/MyHistoryCalendar'), {
  loading: () => (
    <div className="py-16 text-center text-sm text-text-muted">캘린더 불러오는 중…</div>
  ),
})

/**
 * 내 제출 내역 위계
 *   - 메인 탭(2단): 'final' (정제된 최종 상태) / 'raw' (이벤트 원본 스트림)
 *   - 'final' 안의 보기 토글: 'list' (일자별) / 'calendar' (월간)
 */
type TabKey = 'final' | 'raw'
type FinalView = 'list' | 'calendar'

/**
 * localStorage 안전 read — SSR에서는 default.
 * 첫 로그인 (localStorage 미설정) default = 'calendar'.
 * 사용자가 'list'를 명시 선택한 적이 있으면 그 값을 유지 — 이후 토글은 기존 방식.
 */
function readFinalView(): FinalView {
  if (typeof window === 'undefined') return 'calendar'
  try {
    const v = localStorage.getItem('home-final-view')
    return v === 'list' ? 'list' : 'calendar'
  } catch {
    return 'calendar'
  }
}

/**
 * ISO timestamp → 'HH:mm' (KST). 30분 단위로 내림.
 * 정책: 모든 시각 입출력은 30분 배수. 일부 레거시/외부 경로로 :15, :45 등이
 *      들어와도 표시 시점에서 정합성 유지 (예: 21:23 → 21:00, 21:45 → 21:30).
 */
function fmtHHmm(iso: string | null | undefined): string {
  if (!iso) return '-'
  try {
    const d = new Date(iso)
    const h = d.getHours()
    const m = d.getMinutes() < 30 ? 0 : 30
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
  } catch { return '-' }
}

/** "HH:mm:ss" 또는 "HH:mm" → "HH:mm" */
function trimToHHmm(t: string | null | undefined): string {
  if (!t) return ''
  return t.slice(0, 5)
}

/** 카드 상태 색 → 디자인 시스템 tone (semantic) */
function colorToTone(color: 'green' | 'yellow' | 'red'): StatusCardTone {
  if (color === 'green') return 'success'
  if (color === 'yellow') return 'warning'
  return 'danger'
}
function colorToBadgeVariant(color: 'green' | 'yellow' | 'red'): BadgeVariant {
  if (color === 'green') return 'success'
  if (color === 'yellow') return 'warning'
  return 'danger'
}

/** 상단 시각 요약 칩 */
const StatChip = memo(function StatChip({
  icon, label, value,
}: {
  icon: React.ReactNode
  label: string
  value: string
}) {
  return (
    <div className="flex items-center gap-2.5 bg-surface-muted rounded-[10px] px-3 py-2 min-w-0 flex-1">
      <div className="shrink-0 w-7 h-7 rounded-md flex items-center justify-center bg-surface text-text-secondary border border-border">
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-[11px] text-text-muted leading-tight">{label}</div>
        <div className="text-sm font-semibold text-text-primary leading-tight tabular-nums truncate">
          {value}
        </div>
      </div>
    </div>
  )
})

const LOCATION_OPTIONS = ['사무실', '재택', '외근', '기타'] as const

function LocationSelectInline({
  current, date, onChange,
}: {
  current: string | null
  date: string
  onChange: () => void
}) {
  const [custom, setCustom] = useState('')
  const [showCustom, setShowCustom] = useState(false)
  const [saving, setSaving] = useState(false)

  const save = async (loc: string) => {
    setSaving(true)
    try {
      await fetch('/api/team-status/location', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, location: loc }),
      })
      onChange()
    } finally {
      setSaving(false)
    }
  }

  const handleSelect = async (val: string) => {
    if (val === '기타') { setShowCustom(true); return }
    setShowCustom(false)
    await save(val)
  }
  const handleCustomConfirm = async () => {
    const v = custom.trim()
    if (!v) return
    await save(v)
    setShowCustom(false)
    setCustom('')
  }

  const isStandard = LOCATION_OPTIONS.includes(current as typeof LOCATION_OPTIONS[number])
  return (
    <div className="flex items-center gap-2">
      <MapPin className="h-4 w-4 text-text-muted shrink-0" aria-hidden />
      <span className="text-[12px] text-text-secondary">근무지</span>
      {showCustom ? (
        <>
          <input
            value={custom}
            onChange={e => setCustom(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleCustomConfirm() }}
            placeholder="장소 입력"
            className="h-8 w-28 rounded-[8px] border border-border-strong bg-surface px-2 text-[13px] focus:outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20"
            autoFocus
          />
          <button
            onClick={handleCustomConfirm}
            disabled={saving}
            className="inline-flex items-center justify-center h-8 w-8 rounded-[8px] text-primary-600 hover:bg-primary-50 disabled:opacity-50"
            aria-label="저장"
          >
            <Check className="h-4 w-4" aria-hidden />
          </button>
          <button
            onClick={() => setShowCustom(false)}
            className="inline-flex items-center justify-center h-8 w-8 rounded-[8px] text-text-muted hover:bg-surface-muted hover:text-text-primary"
            aria-label="취소"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </>
      ) : (
        <Select
          selectSize="sm"
          value={isStandard ? current ?? '사무실' : '기타'}
          onChange={e => handleSelect(e.target.value)}
          disabled={saving}
          className="w-28 disabled:opacity-50"
        >
          {LOCATION_OPTIONS.map(l => <option key={l} value={l}>{l}</option>)}
          {current && !isStandard && <option value={current}>{current}</option>}
        </Select>
      )}
    </div>
  )
}

export default function HomePage() {
  const todayKst = format(new Date(), 'yyyy-MM-dd')
  // 사용자가 선택한 작업 일자 — 기본값: 오늘. 새벽 근무 후 어제 보고 등을 위해 변경 가능.
  const [selectedDate, setSelectedDate] = useState(todayKst)
  const today = selectedDate  // 기존 today 사용처 호환 (오늘 → 선택일자)
  const isToday = selectedDate === todayKst

  const [logs, setLogs] = useState<WorkLog[]>([])
  const [editingLog, setEditingLog] = useState<WorkLog | null>(null)
  const [editScope, setEditScope] = useState<'check_in' | 'check_out' | undefined>(undefined)
  // 캘린더뷰 외부 새로고침 트리거 — 모달 onSuccess에서 ++ 하면 MyHistoryCalendar가 재fetch
  const [calendarRefreshTick, setCalendarRefreshTick] = useState(0)

  const [tab, setTab] = useState<TabKey>('final')
  const [finalView, setFinalView] = useState<FinalView>(readFinalView)
  const [filterDate, setFilterDate] = useState('')

  // finalView 변경 시 localStorage 저장
  useEffect(() => {
    if (typeof window === 'undefined') return
    try { localStorage.setItem('home-final-view', finalView) } catch {}
  }, [finalView])

  // 본인 이번 달 근로현황
  const [hoursSummary, setHoursSummary] = useState<{
    baselines: MonthBaselines
    me: UserMonthSummary | null
  } | null>(null)

  // 본인 오늘 카드 (status header용)
  const [myCard, setMyCard] = useState<TeamMemberCard | null>(null)

  // CheckInModal / WorkLogModal 트리거 (헤더용)
  const [showCheckIn, setShowCheckIn] = useState(false)
  const [checkInMode, setCheckInMode] = useState<'create' | 'edit' | 'complete' | undefined>(undefined)
  const [checkOutTarget, setCheckOutTarget] = useState<TeamMemberCard | null>(null)

  // 캘린더뷰 → 상세 모달 → 작성 버튼 — 임의 날짜로 신규 작성
  const [calendarCheckInDate, setCalendarCheckInDate] = useState<string | null>(null)
  const [calendarCheckOutDate, setCalendarCheckOutDate] = useState<string | null>(null)

  // 미완료 퇴근보고 알림 — 가장 최근 미완료 1건
  const [missedCheckoutDate, setMissedCheckoutDate] = useState<string | null>(null)
  // 팝업의 "더이상 물어보지 않기" 체크박스 — 기본 false (열 때마다 reset)
  const [missedDontAskAgain, setMissedDontAskAgain] = useState(false)

  // ─── 본인 이번 달 근로현황 ──────────────────────────────────────
  useEffect(() => {
    const now = new Date()
    fetch(`/api/work-hours?year=${now.getFullYear()}&month=${now.getMonth() + 1}&mine=true`)
      .then(r => r.ok ? r.json() : null)
      .then((d: { baselines: MonthBaselines; users: UserMonthSummary[] } | null) => {
        if (!d) return
        setHoursSummary({
          baselines: d.baselines,
          me: d.users[0] ?? null,
        })
      })
      .catch(() => {})
  }, [])

  // ─── 미완료 퇴근보고 알림 (가장 최근 1건) ────────────────────────
  // localStorage에 마지막으로 [더이상 묻지 않기]한 일자(YYYY-MM-DD) 기록.
  // 새 미보고 targetDate가 그 일자 이하면 팝업 skip — 1~3일 미보고 시 3일을 dismiss하면
  // 1·2일도 자동으로 안 뜸 (사용자 의도: "거기까지는 안 보겠다").
  // 그 일자보다 더 미래 미보고가 새로 생기면 다시 뜸.
  useEffect(() => {
    fetch('/api/my/missed-checkout')
      .then(r => r.ok ? r.json() : null)
      .then((d: { targetDate: string | null } | null) => {
        if (!d?.targetDate) return
        try {
          const dismissedUntil = localStorage.getItem('missed-checkout-dismissed-until')
          if (dismissedUntil && d.targetDate <= dismissedUntil) return
        } catch { /* SSR / private mode 등 */ }
        setMissedCheckoutDate(d.targetDate)
      })
      .catch(() => {})
  }, [])

  // 새벽(00:00~07:00) 근무 연장으로 "전날(달력)" 미보고가 잡힌 케이스 — 누락 톤 대신 부드러운 안내.
  // (이 시간대엔 아직 근무 중일 수 있어 "미완료/누락" 단정이 이름. 단 진짜 지난 누락일은 표준 문구 유지)
  const missedIsOvernightGrace = (() => {
    if (!missedCheckoutDate) return false
    const now = new Date()
    const kstHour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', hour12: false, hour: '2-digit' }).format(now)) % 24
    if (kstHour >= 7) return false
    const kstToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
    const [y, m, d] = kstToday.split('-').map(Number)
    const kstYesterday = new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10)
    return missedCheckoutDate === kstYesterday
  })()

  // ─── 본인 오늘 카드 ─────────────────────────────────────────────
  const fetchMyCard = useCallback(async () => {
    try {
      const res = await fetch(`/api/team-status?date=${today}&mine=true`)
      const data = await res.json()
      if (Array.isArray(data) && data.length > 0) {
        setMyCard(data[0])
      } else {
        setMyCard(null)
      }
    } catch {
      setMyCard(null)
    }
  }, [today])

  useEffect(() => { fetchMyCard() }, [fetchMyCard])

  // Stage 4: 자동 새로고침 — 60s 기본, 출근예정 ±10분이면 30s. 모달 열림/탭 비활성 시 일시정지.
  useAutoRefetch({
    plannedStartHHmm: myCard?.start_time?.slice(0, 5) ?? null,
    onTick: fetchMyCard,
  })

  // 내 work_logs 캐시는 첫 로드에 굳이 필요 없음 — edit 클릭 시점에 단건 fetch만 해도
  // 충분하다 (openEditByWorkLogId 안의 /api/work-logs/{id} fallback). 첫 페이지 로드에서
  // 무거운 list fetch 1개를 제거해서 LCP 빠르게.

  // ─── 수정 모달 진입 ─────────────────────────────────────────────
  /**
   * cellDate가 있고 scope='check_in'이면 — 캘린더에서 셀 클릭한 출근보고 수정 흐름.
   * 한 work_log row가 D-day 본문(start_time)과 D+1 출근예정(expected_*) 둘 다 담을
   * 수 있어, cellDate와 row의 leave_date / expected_start_date를 비교해 어느 영역이
   * 사용자가 수정하려는 데이터인지 판정한다.
   *
   *   cellDate == row.leave_date            → D-day 본문 출근 수정 (CheckInModal로 라우팅)
   *   cellDate == row.expected_start_date   → D+1 출근예정 수정 (WorkLogModal editScope='check_in')
   *
   * cellDate 없는 호출(SubmissionsRawTable의 ✏ 버튼 등)은 기존 흐름 유지.
   */
  const openEditByWorkLogId = async (
    workLogId: string,
    scope: 'check_in' | 'check_out',
    cellDate?: string,
  ) => {
    const routeAfterFetch = (log: WorkLog) => {
      if (scope === 'check_in' && cellDate) {
        const leaveDate = log.leave_date ?? null
        const expectedStartDate = log.expected_start_date ?? null
        if (cellDate === leaveDate && cellDate !== expectedStartDate) {
          // D-day 본문 출근 수정 — CheckInModal이 자동으로 prefill
          setCalendarCheckInDate(cellDate)
          return
        }
      }
      setEditScope(scope)
      setEditingLog(log)
    }

    // 항상 fresh fetch — `logs` 캐시는 stale 위험 큼 (편집 모달에서 닫기만 했거나
    // 다른 흐름에서 row UPDATE된 경우 캐시가 옛 actual_*_time을 가짐).
    // 단건 fetch 비용은 무시 가능 수준.
    try {
      const res = await fetch(`/api/work-logs/${workLogId}`, { cache: 'no-store' })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        alert('해당 보고를 불러오지 못했습니다: ' + (err.error ?? res.statusText))
        return
      }
      const fresh = (await res.json()) as WorkLog
      setLogs(prev => [fresh, ...prev.filter(l => l.id !== fresh.id)])  // 디버그/추적용 (read 안 함)
      routeAfterFetch(fresh)
    } catch {
      alert('해당 보고를 불러오는 중 오류가 발생했습니다.')
    }
  }

  const handleEditSuccess = () => {
    // 캐시된 logs에서 방금 수정한 row 제거 — 다음 [수정] 클릭 시 fresh fetch.
    // (안 그러면 캐시된 옛 값으로 form prefill되어 사용자가 본 값과 안 맞음)
    const editedId = editingLog?.id
    if (editedId) {
      setLogs(prev => prev.filter(l => l.id !== editedId))
    }
    setEditingLog(null)
    fetchMyCard()
  }

  // ─── 헤더 액션 핸들러 ─────────────────────────────────────────────
  const openCheckInFlow = () => setShowCheckIn(true)
  const openCheckOutFlow = () => {
    if (myCard) setCheckOutTarget(myCard)
  }
  /**
   * [퇴근보고 수정] 버튼 — 이미 작성된 work_log row를 editingLog로 라우팅해
   * WorkLogForm이 work_content/break_time 등 모든 컬럼을 prefill하도록.
   * (openCheckOutFlow는 신규 작성 용도라 editingLog를 안 넘겨서 prefill 누락됐음)
   */
  const openCheckOutEditFlow = () => {
    if (myCard?.work_log_id) {
      openEditByWorkLogId(myCard.work_log_id, 'check_out')
    } else {
      openCheckOutFlow()
    }
  }

  // v1.44 — 휴게 시작 모달 토글. false로 바꾸면 기존 즉시 시작 흐름(triggerBreak('break-start'))으로 즉시 롤백.
  const USE_BREAK_MODAL_FLOW = true
  const [showBreakStartModal, setShowBreakStartModal] = useState(false)

  /** 휴게 시작/종료 — endpoint 호출 후 카드 다시 fetch */
  const [breakBusy, setBreakBusy] = useState(false)
  const triggerBreak = async (endpoint: 'break-start' | 'break-end') => {
    if (breakBusy) return
    setBreakBusy(true)
    try {
      await fetch(`/api/team-status/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: today }),
      })
      await fetchMyCard()
    } finally {
      setBreakBusy(false)
    }
  }

  // ── 렌더 ─────────────────────────────────────────────────────────
  const userName = myCard?.display_name ?? null
  const isCheckedIn = !!(myCard?.daily_status_id && !myCard?.checked_out_at)
  const checkInDone = !!myCard?.checked_in_at
  const checkOutDone = !!myCard?.checked_out_at
  const showBreakBtn = isCheckedIn
  const showLocationSelect = isCheckedIn

  const headerTone: StatusCardTone = myCard ? colorToTone(myCard.color) : 'neutral'

  return (
    <div className="space-y-6">
      {/* 수정 모달 */}
      {editingLog && (
        <WorkLogModal
          date={editingLog.leave_date}
          userName={editingLog.name}
          editingLog={editingLog}
          editScope={editScope}
          onClose={() => { setEditingLog(null); setEditScope(undefined) }}
          onSuccess={() => { handleEditSuccess(); setEditScope(undefined); setCalendarRefreshTick(t => t + 1) }}
        />
      )}

      {/* 출근보고 작성/수정/출근완료 모달 */}
      {showCheckIn && (
        <CheckInModal
          date={today}
          userName={userName}
          mode={checkInMode}
          useCheckInComplete={myCard?.use_check_in_complete ?? true}
          onClose={() => { setShowCheckIn(false); setCheckInMode(undefined) }}
          onSuccess={() => { setShowCheckIn(false); setCheckInMode(undefined); fetchMyCard(); setCalendarRefreshTick(t => t + 1) }}
        />
      )}

      {/* 퇴근보고 작성 모달 */}
      {checkOutTarget && (
        <WorkLogModal
          date={today}
          userName={userName}
          initialTimeline={checkOutTarget.work_location_timeline ?? null}
          initialActualLocations={checkOutTarget.actual_work_locations ?? null}
          initialPlannedLocations={checkOutTarget.planned_work_locations ?? null}
          initialLeaveTimeline={checkOutTarget.leave_timeline ?? null}
          initialBreakAutoActualMinutes={checkOutTarget.break_auto_actual_minutes ?? null}
          initialStartTime={
            checkOutTarget.checked_in_at
              ? fmtHHmm(checkOutTarget.checked_in_at)
              : trimToHHmm(checkOutTarget.start_time) || undefined
          }
          initialEndTime={trimToHHmm(checkOutTarget.end_time) || undefined}
          initialWorkContent={checkOutTarget.work_content ?? null}
          resubmitWorkLogId={checkOutTarget.work_log_id ?? null}
          onClose={() => setCheckOutTarget(null)}
          onSuccess={() => { setCheckOutTarget(null); fetchMyCard(); setCalendarRefreshTick(t => t + 1) }}
        />
      )}

      {/* v1.44 — 휴게 시작 모달 (USE_BREAK_MODAL_FLOW=true일 때만) */}
      {showBreakStartModal && myCard && (() => {
        const plannedChips = resolvePlannedLocations({
          planned: myCard.planned_work_locations,
          legacyExpectedTimeline: myCard.work_location_timeline,
          legacyExpectedWorkLocation: myCard.work_location,
        })
        const actualChips = resolveDisplayLocations({
          actual: myCard.actual_work_locations,
          planned: myCard.planned_work_locations,
          legacyActualTimeline: myCard.work_location_timeline,
          legacyWorkLocation: myCard.current_location,
        })
        const initialChips = (actualChips && actualChips.length > 0) ? actualChips : (plannedChips ?? [])
        return (
          <BreakStartModal
            date={today}
            userName={userName}
            currentLocations={initialChips}
            currentLocationLabel={myCard.current_location ?? null}
            currentLocationIndex={myCard.current_location_index ?? null}
            plannedHint={plannedChips ? formatChipsArrow(plannedChips) : null}
            currentMemo={myCard.work_content ?? null}
            onClose={() => setShowBreakStartModal(false)}
            onSuccess={() => { setShowBreakStartModal(false); fetchMyCard() }}
            onLocationChange={fetchMyCard}
          />
        )
      })()}

      {/* 캘린더 → 출근보고 작성 (임의 날짜) */}
      {calendarCheckInDate && (
        <CheckInModal
          date={calendarCheckInDate}
          userName={userName}
          useCheckInComplete={myCard?.use_check_in_complete ?? true}
          onClose={() => setCalendarCheckInDate(null)}
          onSuccess={() => { setCalendarCheckInDate(null); fetchMyCard(); setCalendarRefreshTick(t => t + 1) }}
        />
      )}

      {/* 캘린더 → 퇴근보고 작성 (임의 날짜, 신규 제출) */}
      {calendarCheckOutDate && (
        <WorkLogModal
          date={calendarCheckOutDate}
          userName={userName}
          onClose={() => setCalendarCheckOutDate(null)}
          onSuccess={() => { setCalendarCheckOutDate(null); fetchMyCard(); setCalendarRefreshTick(t => t + 1) }}
        />
      )}

      {/* 미완료 퇴근보고 알림 팝업 — 가장 최근 미완료 1건 */}
      {missedCheckoutDate && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="missed-checkout-title"
        >
          <div className="bg-surface rounded-2xl shadow-[var(--shadow-popover)] w-full max-w-md p-5 space-y-4">
            <div className="flex items-start gap-3">
              <div className="shrink-0 inline-flex h-9 w-9 items-center justify-center rounded-full bg-warning-bg text-warning-text">
                <ChevronRight className="h-5 w-5 rotate-180" aria-hidden />
              </div>
              <div className="min-w-0">
                <h3 id="missed-checkout-title" className="text-base font-semibold text-text-primary">
                  {missedIsOvernightGrace ? '퇴근보고 안내' : '퇴근보고 미완료'}
                </h3>
                <p className="mt-1 text-[13px] text-text-secondary leading-relaxed">
                  {missedIsOvernightGrace ? (
                    <>
                      <span className="font-semibold text-text-primary">{missedCheckoutDate}</span> 근무에 대한
                      퇴근보고가 아직 진행되지 않았습니다.
                      <br />
                      새벽 근무 중이시면 퇴근하실 때 보고해 주세요. 지금 진행하시겠어요?
                    </>
                  ) : (
                    <>
                      <span className="font-semibold text-text-primary">{missedCheckoutDate}</span> 일자의
                      퇴근보고가 아직 진행되지 않았습니다.
                      <br />
                      퇴근보고 및 EW 상신을 진행하시겠어요?
                    </>
                  )}
                </p>
              </div>
            </div>
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={missedDontAskAgain}
                onChange={e => setMissedDontAskAgain(e.target.checked)}
                className="h-4 w-4 rounded border-border-strong text-primary-600 focus:ring-primary-500"
              />
              <span className="text-[12px] text-text-secondary">해당 일자에 대해서 더이상 물어보지 않기</span>
            </label>
            <div className="flex items-center justify-end gap-2 pt-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  // 체크박스 켜진 경우에만 dismissed-until 누적 — 그 일자까지의 모든 미보고 팝업 skip
                  if (missedDontAskAgain && missedCheckoutDate) {
                    try {
                      const prev = localStorage.getItem('missed-checkout-dismissed-until') ?? ''
                      // 더 최신 dismiss는 덮어쓰기, 과거 dismiss는 무시 (단조증가)
                      if (!prev || missedCheckoutDate > prev) {
                        localStorage.setItem('missed-checkout-dismissed-until', missedCheckoutDate)
                      }
                    } catch { /* ignore */ }
                  }
                  setMissedCheckoutDate(null)
                  setMissedDontAskAgain(false)
                }}
              >
                나중에
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  const date = missedCheckoutDate
                  setMissedCheckoutDate(null)
                  // 기존 calendarCheckOutDate 흐름 재사용 → WorkLogModal이 그 날짜로 자동 prefill
                  setCalendarCheckOutDate(date)
                }}
              >
                퇴근보고 진행
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ─── 본인 오늘 상태 헤더 ────────────────────────────────────── */}
      <StatusCard tone={headerTone} padding="lg">
        {/* 1행: 이름 + 상태 배지 / 날짜 + 새로고침 */}
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div className="min-w-0">
            <div className="text-[11px] font-semibold tracking-[0.08em] text-text-muted uppercase">
              MY PAGE
            </div>
            <div className="flex items-center gap-2.5 min-w-0">
              <h2 className="text-xl sm:text-2xl font-bold text-text-primary leading-tight truncate">
                {userName ? `${userName}님` : '내 업무'}
              </h2>
              {myCard && (
                <Badge
                  variant={colorToBadgeVariant(myCard.color)}
                  dot
                  className="h-7 px-3 text-[13px] shrink-0"
                >
                  {myCard.status_text}
                </Badge>
              )}
            </div>
          </div>
          {/* 날짜 이동 + 강조 영역 */}
          <div className="flex items-center gap-1.5">
            <Button
              variant="ghost" size="sm" iconOnly
              onClick={() => setSelectedDate(format(addDays(parseISO(selectedDate), -1), 'yyyy-MM-dd'))}
              title="이전 날짜" aria-label="이전 날짜"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden />
            </Button>
            {/* 선택 일자 — 강조 표시 + 클릭 시 picker */}
            <DateInputWithDow
              size="md"
              value={selectedDate}
              onChange={v => v && setSelectedDate(v)}
              max={todayKst}
              className={cn(
                'min-w-[150px] !text-base !font-semibold',
                isToday
                  ? '!border-primary-500 !bg-primary-50 !text-primary-700'
                  : '!border-warning-text !bg-warning-bg !text-warning-text',
              )}
            />
            <Button
              variant="ghost" size="sm" iconOnly
              onClick={() => {
                const next = format(addDays(parseISO(selectedDate), 1), 'yyyy-MM-dd')
                if (next <= todayKst) setSelectedDate(next)
              }}
              disabled={selectedDate >= todayKst}
              title="다음 날짜" aria-label="다음 날짜"
            >
              <ChevronRight className="h-4 w-4" aria-hidden />
            </Button>
            {!isToday && (
              <Button variant="ghost" size="sm" onClick={() => setSelectedDate(todayKst)}>
                오늘
              </Button>
            )}
            <Button
              variant="ghost" size="sm" iconOnly
              onClick={() => { fetchMyCard() }}
              title="새로고침" aria-label="새로고침"
            >
              <RefreshCw className="h-4 w-4" aria-hidden />
            </Button>
          </div>
        </div>

        {/* 2행: 시각 정보 4개 칩 */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
          <StatChip
            icon={<Clock className="h-4 w-4" aria-hidden />}
            label="출근예정"
            value={trimToHHmm(myCard?.start_time) || '-'}
          />
          <StatChip
            icon={<Clock className="h-4 w-4" aria-hidden />}
            label="퇴근예정"
            value={trimToHHmm(myCard?.end_time) || '-'}
          />
          <StatChip
            icon={<LogIn className="h-4 w-4" aria-hidden />}
            label="실제 출근"
            value={fmtHHmm(myCard?.checked_in_at)}
          />
          <StatChip
            icon={<LogOut className="h-4 w-4" aria-hidden />}
            label="실제 퇴근"
            value={fmtHHmm(myCard?.checked_out_at)}
          />
        </div>

        {/* 3행: 액션 버튼 + 근무지 — 5상태 분기 */}
        {(() => {
          const state = computeWorkLogState({
            hasWorkLog: !!myCard?.work_log_id,
            checkedInAt: myCard?.checked_in_at ?? null,
            checkedOutAt: myCard?.checked_out_at ?? null,
            isOnBreak: !!myCard?.is_on_break,
            // v1.63 — 출근완료 미사용 팀 read-time 보정값 fallback. lazy write 전이라도 즉시 C 판정.
            effectiveActualStart: myCard?.effective_actual_start_time ?? null,
          })
          const buttons = buttonsForState(state, { useCheckInComplete: myCard?.use_check_in_complete ?? true })
          return (
            <div className="flex flex-wrap items-center gap-2">
              {/* 출근보고 작성 (A 상태) */}
              {buttons.showCheckInCreate && (
                <Button
                  variant="primary"
                  onClick={() => { setCheckInMode('create'); setShowCheckIn(true) }}
                >
                  <LogIn className="h-4 w-4" aria-hidden />
                  출근보고 작성
                </Button>
              )}

              {/* 출근보고 수정 + 출근 완료 (B 상태) — 이어진 버튼 디자인 */}
              {buttons.showCheckInEdit && buttons.showCheckInComplete && (
                <div className="inline-flex rounded-[10px] overflow-hidden border border-border-strong shadow-[var(--shadow-card)]">
                  <button
                    type="button"
                    onClick={() => { setCheckInMode('edit'); setShowCheckIn(true) }}
                    className="inline-flex items-center gap-1.5 h-10 px-4 text-sm font-medium text-text-primary bg-surface hover:bg-surface-muted transition-colors border-r border-border-strong"
                  >
                    <Check className="h-4 w-4 text-success-text" aria-hidden />
                    출근보고 수정
                  </button>
                  <button
                    type="button"
                    onClick={() => { setCheckInMode('complete'); setShowCheckIn(true) }}
                    className="inline-flex items-center gap-1.5 h-10 px-4 text-sm font-semibold text-white bg-primary-600 hover:bg-primary-700 transition-colors"
                  >
                    <LogIn className="h-4 w-4" aria-hidden />
                    출근 완료
                  </button>
                </div>
              )}

              {/* 출근보고 수정 단독 (C/D/E 상태) */}
              {buttons.showCheckInEdit && !buttons.showCheckInComplete && (
                <Button
                  variant="secondary"
                  onClick={() => { setCheckInMode('edit'); setShowCheckIn(true) }}
                >
                  <Check className="h-4 w-4" aria-hidden />
                  출근보고 수정
                </Button>
              )}

              {/* 퇴근보고 작성 (A/B/C/D 상태) — 항상 primary로 강조 */}
              {buttons.showCheckOutCreate && (
                <Button
                  variant="primary"
                  onClick={openCheckOutFlow}
                >
                  <LogOut className="h-4 w-4" aria-hidden />
                  퇴근보고 작성
                </Button>
              )}

              {/* 퇴근보고 수정 (E 상태) */}
              {buttons.showCheckOutEdit && (
                <Button
                  variant="secondary"
                  onClick={openCheckOutEditFlow}
                >
                  <Check className="h-4 w-4" aria-hidden />
                  퇴근보고 수정
                </Button>
              )}

              {/* 휴게 시작 (C 상태) — v1.44: 모달 흐름 / 토글 OFF면 기존 즉시 시작 */}
              {buttons.showBreakStart && (
                <Button
                  variant="secondary"
                  onClick={() => USE_BREAK_MODAL_FLOW ? setShowBreakStartModal(true) : triggerBreak('break-start')}
                  disabled={breakBusy}
                >
                  <Coffee className="h-4 w-4" aria-hidden />
                  휴게 시작
                </Button>
              )}

              {/* 휴게 종료 (D 상태) */}
              {buttons.showBreakEnd && (
                <Button
                  variant="warning-soft"
                  onClick={() => triggerBreak('break-end')}
                  disabled={breakBusy}
                >
                  <Coffee className="h-4 w-4" aria-hidden />
                  휴게 종료
                </Button>
              )}

              {/* 실제 근무지 chips 편집기 + ★ 현재 위치 (출근 후) */}
              {(state === 'C' || state === 'D') && myCard && (() => {
                const plannedChips = resolvePlannedLocations({
                  planned: myCard.planned_work_locations,
                  legacyExpectedTimeline: myCard.work_location_timeline,
                  legacyExpectedWorkLocation: myCard.work_location,
                })
                const actualChips = resolveDisplayLocations({
                  actual: myCard.actual_work_locations,
                  planned: myCard.planned_work_locations,
                  legacyActualTimeline: myCard.work_location_timeline,
                  legacyWorkLocation: myCard.current_location,
                })
                const initialChips = (actualChips && actualChips.length > 0)
                  ? actualChips
                  : (plannedChips ?? [])
                return (
                  <div className="basis-full">
                    <EditableLocationChips
                      value={initialChips}
                      currentLabel={myCard.current_location ?? null}
                      currentIndex={myCard.current_location_index ?? null}
                      plannedHint={plannedChips ? formatChipsArrow(plannedChips) : null}
                      date={today}
                      onChange={fetchMyCard}
                    />
                  </div>
                )
              })()}
            </div>
          )
        })()}

        {/* 휴게 중일 때 안내 라인 */}
        {myCard?.is_on_break && (
          <div className="mt-3 flex items-center gap-2 text-[12px] text-warning-text">
            <Coffee className="h-3.5 w-3.5" aria-hidden />
            <span>휴게 시작 {fmtHHmm(myCard.break_started_at)} — 종료 시 [휴게 종료] 버튼 클릭</span>
          </div>
        )}
      </StatusCard>

      {/* ─── 본인 이번 달 근로현황 ──────────────────────────────────
          데이터 도착 전엔 같은 높이 skeleton — layout shift 방지 + 체감 로딩 빠르게.
      */}
      {hoursSummary?.me ? (
        <WorkHoursCard
          baselines={hoursSummary.baselines}
          summary={hoursSummary.me}
          compact
        />
      ) : (
        <div
          className="rounded-2xl bg-surface border border-border shadow-[var(--shadow-card)] p-4 space-y-3 animate-pulse"
          aria-hidden
        >
          <div className="h-4 w-40 bg-surface-muted rounded" />
          <div className="h-2 w-full bg-surface-muted rounded-full" />
          <div className="flex gap-4">
            <div className="h-3 w-20 bg-surface-muted rounded" />
            <div className="h-3 w-20 bg-surface-muted rounded" />
            <div className="h-3 w-20 bg-surface-muted rounded" />
          </div>
        </div>
      )}

      {/* ─── 내 제출 내역 ───────────────────────────────────────────
          위계 1단: 메인 탭(최종 보고 / RAW) — 데이터 종류 구분
          위계 2단: 보기 토글(일자별 / 캘린더) — '최종 보고' 안의 표현 방식
      */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-6">
        <h3 className="text-lg font-bold text-text-primary">내 제출 내역</h3>
        {tab === 'final' && finalView === 'list' && (
          <div className="flex items-center gap-2">
            <DateInputWithDow size="sm" value={filterDate} onChange={setFilterDate} />
            {filterDate && (
              <Button variant="ghost" size="sm" onClick={() => setFilterDate('')}>
                초기화
              </Button>
            )}
          </div>
        )}
      </div>

      {/* 메인 탭 (위계 1) */}
      <div className="border-b border-border">
        <nav className="-mb-px flex gap-6" aria-label="탭">
          {[
            { key: 'final' as TabKey, label: '최종 보고' },
            { key: 'raw'   as TabKey, label: 'RAW 제출 내역' },
          ].map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                'py-2.5 px-1 border-b-2 text-sm transition-colors',
                tab === t.key
                  ? 'border-primary-600 text-primary-600 font-semibold'
                  : 'border-transparent text-text-secondary hover:text-text-primary hover:border-border-strong font-medium',
              )}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </div>

      {/* 최종 보고 — 보기 토글 (위계 2) + 본문 */}
      {tab === 'final' && (
        <>
          <div className="flex items-center justify-between gap-2">
            <div
              role="group"
              aria-label="보기 방식"
              className="inline-flex rounded-[10px] border border-border-strong bg-surface p-0.5"
            >
              <button
                type="button"
                onClick={() => setFinalView('calendar')}
                className={cn(
                  'inline-flex items-center gap-1 h-8 px-2.5 rounded-[8px] text-[12px] font-medium transition-colors',
                  finalView === 'calendar'
                    ? 'bg-surface-muted text-text-primary'
                    : 'text-text-muted hover:text-text-primary',
                )}
                aria-pressed={finalView === 'calendar'}
              >
                <CalendarIcon className="h-3.5 w-3.5" aria-hidden />
                캘린더
              </button>
              <button
                type="button"
                onClick={() => setFinalView('list')}
                className={cn(
                  'inline-flex items-center gap-1 h-8 px-2.5 rounded-[8px] text-[12px] font-medium transition-colors',
                  finalView === 'list'
                    ? 'bg-surface-muted text-text-primary'
                    : 'text-text-muted hover:text-text-primary',
                )}
                aria-pressed={finalView === 'list'}
              >
                <LayoutGrid className="h-3.5 w-3.5" aria-hidden />
                리스트
              </button>
            </div>
          </div>

          {finalView === 'list' ? (
            <div className="space-y-3">
              <MissingReportsSummary
                from={(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01` })()}
                to={(() => { const d = new Date(); const last = new Date(d.getFullYear(), d.getMonth()+1, 0); return `${last.getFullYear()}-${String(last.getMonth()+1).padStart(2,'0')}-${String(last.getDate()).padStart(2,'0')}` })()}
                onOpenCheckIn={(date) => setCalendarCheckInDate(date)}
                onOpenCheckOut={(date) => setCalendarCheckOutDate(date)}
              />
              <SubmissionsRawTable
                mine mode="final"
                onEditWorkLog={openEditByWorkLogId}
              />
            </div>
          ) : (
            <MyHistoryCalendar
              onEditWorkLog={openEditByWorkLogId}
              onCreateCheckIn={(date) => setCalendarCheckInDate(date)}
              onCreateCheckOut={(date) => setCalendarCheckOutDate(date)}
              refreshKey={calendarRefreshTick}
            />
          )}
        </>
      )}

      {/* RAW */}
      {tab === 'raw' && (
        <SubmissionsRawTable
          mine mode="raw"
          onEditWorkLog={openEditByWorkLogId}
        />
      )}
    </div>
  )
}
