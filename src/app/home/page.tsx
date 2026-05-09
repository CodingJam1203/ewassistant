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

import { useState, useEffect, useCallback } from 'react'
import dynamic from 'next/dynamic'
import { format } from 'date-fns'
import { ko } from 'date-fns/locale'
import { LogIn, LogOut, RefreshCw, Clock, MapPin, Coffee, X, Check, LayoutGrid, Calendar as CalendarIcon } from 'lucide-react'
import WorkHoursCard from '@/components/WorkHoursCard'
import SubmissionsRawTable from '@/components/SubmissionsRawTable'
import { Button, Badge, StatusCard, Select } from '@/components/ui'
import type { StatusCardTone, BadgeVariant } from '@/components/ui'
import { cn } from '@/lib/utils/cn'
import type { WorkLog } from '@/types/work-log'
import type { MonthBaselines, UserMonthSummary } from '@/lib/utils/work-hours'
import type { TeamMemberCard } from '@/app/api/team-status/route'

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

/** localStorage 안전 read — SSR에서는 default. */
function readFinalView(): FinalView {
  if (typeof window === 'undefined') return 'list'
  try {
    const v = localStorage.getItem('home-final-view')
    return v === 'calendar' ? 'calendar' : 'list'
  } catch {
    return 'list'
  }
}

/** ISO timestamp → 'HH:mm' (KST 사용자 브라우저 기준) */
function fmtHHmm(iso: string | null | undefined): string {
  if (!iso) return '-'
  try { return format(new Date(iso), 'HH:mm') } catch { return '-' }
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
function StatChip({
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
}

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
  const today = format(new Date(), 'yyyy-MM-dd')
  const todayLabel = format(new Date(), 'M월 d일 (EEE)', { locale: ko })

  const [logs, setLogs] = useState<WorkLog[]>([])
  const [editingLog, setEditingLog] = useState<WorkLog | null>(null)
  const [editScope, setEditScope] = useState<'check_in' | 'check_out' | undefined>(undefined)

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
  const [checkOutTarget, setCheckOutTarget] = useState<TeamMemberCard | null>(null)

  // 캘린더뷰 → 상세 모달 → 작성 버튼 — 임의 날짜로 신규 작성
  const [calendarCheckInDate, setCalendarCheckInDate] = useState<string | null>(null)
  const [calendarCheckOutDate, setCalendarCheckOutDate] = useState<string | null>(null)

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

  // 내 work_logs 캐시는 첫 로드에 굳이 필요 없음 — edit 클릭 시점에 단건 fetch만 해도
  // 충분하다 (openEditByWorkLogId 안의 /api/work-logs/{id} fallback). 첫 페이지 로드에서
  // 무거운 list fetch 1개를 제거해서 LCP 빠르게.

  // ─── 수정 모달 진입 ─────────────────────────────────────────────
  const openEditByWorkLogId = async (
    workLogId: string,
    scope: 'check_in' | 'check_out',
  ) => {
    const cached = logs.find(l => l.id === workLogId)
    if (cached) {
      setEditScope(scope)
      setEditingLog(cached)
      return
    }
    try {
      const res = await fetch(`/api/work-logs/${workLogId}`)
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        alert('해당 보고를 불러오지 못했습니다: ' + (err.error ?? res.statusText))
        return
      }
      const fresh = (await res.json()) as WorkLog
      setLogs(prev => [fresh, ...prev.filter(l => l.id !== fresh.id)])  // 메모리에 캐시
      setEditScope(scope)
      setEditingLog(fresh)
    } catch {
      alert('해당 보고를 불러오는 중 오류가 발생했습니다.')
    }
  }

  const handleEditSuccess = () => {
    setEditingLog(null)
    fetchMyCard()
  }

  // ─── 헤더 액션 핸들러 ─────────────────────────────────────────────
  const openCheckInFlow = () => setShowCheckIn(true)
  const openCheckOutFlow = () => {
    if (myCard) setCheckOutTarget(myCard)
  }

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
          onSuccess={() => { handleEditSuccess(); setEditScope(undefined) }}
        />
      )}

      {/* 출근보고 작성 모달 */}
      {showCheckIn && (
        <CheckInModal
          date={today}
          userName={userName}
          onClose={() => setShowCheckIn(false)}
          onSuccess={() => { setShowCheckIn(false); fetchMyCard() }}
        />
      )}

      {/* 퇴근보고 작성 모달 */}
      {checkOutTarget && (
        <WorkLogModal
          date={today}
          userName={userName}
          initialTimeline={checkOutTarget.work_location_timeline ?? null}
          initialLeaveTimeline={checkOutTarget.leave_timeline ?? null}
          initialBreakAutoActualMinutes={checkOutTarget.break_auto_actual_minutes ?? null}
          initialStartTime={
            checkOutTarget.checked_in_at
              ? fmtHHmm(checkOutTarget.checked_in_at)
              : trimToHHmm(checkOutTarget.start_time) || undefined
          }
          initialEndTime={trimToHHmm(checkOutTarget.end_time) || undefined}
          resubmitWorkLogId={checkOutTarget.work_log_id ?? null}
          onClose={() => setCheckOutTarget(null)}
          onSuccess={() => { setCheckOutTarget(null); fetchMyCard() }}
        />
      )}

      {/* 캘린더 → 출근보고 작성 (임의 날짜) */}
      {calendarCheckInDate && (
        <CheckInModal
          date={calendarCheckInDate}
          userName={userName}
          onClose={() => setCalendarCheckInDate(null)}
          onSuccess={() => { setCalendarCheckInDate(null); fetchMyCard() }}
        />
      )}

      {/* 캘린더 → 퇴근보고 작성 (임의 날짜, 신규 제출) */}
      {calendarCheckOutDate && (
        <WorkLogModal
          date={calendarCheckOutDate}
          userName={userName}
          onClose={() => setCalendarCheckOutDate(null)}
          onSuccess={() => { setCalendarCheckOutDate(null); fetchMyCard() }}
        />
      )}

      {/* ─── 본인 오늘 상태 헤더 ────────────────────────────────────── */}
      <StatusCard tone={headerTone} padding="lg">
        {/* 1행: 이름 + 상태 배지 / 날짜 + 새로고침 */}
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="min-w-0">
              <div className="text-[11px] font-semibold tracking-[0.08em] text-text-muted uppercase">
                MY PAGE
              </div>
              <h2 className="text-xl sm:text-2xl font-bold text-text-primary leading-tight truncate">
                {userName ? `${userName}님` : '내 업무'}
              </h2>
            </div>
            {myCard && (
              <Badge variant={colorToBadgeVariant(myCard.color)} dot>
                {myCard.status_text}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-text-secondary">{todayLabel}</span>
            <Button
              variant="ghost"
              size="sm"
              iconOnly
              onClick={() => { fetchMyCard() }}
              title="새로고침"
              aria-label="새로고침"
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

        {/* 3행: 액션 버튼 + 근무지 */}
        <div className="flex flex-wrap items-center gap-2">
          {/* 출근보고 — 완료 시 secondary, 미완료 시 secondary (퇴근보고만 primary) */}
          <Button
            variant="secondary"
            onClick={openCheckInFlow}
            title={checkInDone ? '이미 작성됨 — 재제출/수정 가능' : undefined}
          >
            {checkInDone ? <Check className="h-4 w-4" aria-hidden /> : <LogIn className="h-4 w-4" aria-hidden />}
            출근보고 작성
            {checkInDone && (
              <span className="text-[12px] font-normal text-text-muted">(완료)</span>
            )}
          </Button>

          {/* 퇴근보고 — 1차 액션. 완료 시 secondary로 강등 */}
          <Button
            variant={checkOutDone ? 'secondary' : 'primary'}
            onClick={openCheckOutFlow}
            title={checkOutDone ? '이미 작성됨 — 재제출/수정 가능' : undefined}
          >
            {checkOutDone ? <Check className="h-4 w-4" aria-hidden /> : <LogOut className="h-4 w-4" aria-hidden />}
            퇴근보고 작성
            {checkOutDone && (
              <span className="text-[12px] font-normal text-text-muted">(완료)</span>
            )}
          </Button>

          {showBreakBtn && (
            myCard?.is_on_break ? (
              <Button
                variant="warning-soft"
                onClick={() => triggerBreak('break-end')}
                disabled={breakBusy}
              >
                <Coffee className="h-4 w-4" aria-hidden />
                휴게 종료
              </Button>
            ) : (
              <Button
                variant="secondary"
                onClick={() => triggerBreak('break-start')}
                disabled={breakBusy}
              >
                <Coffee className="h-4 w-4" aria-hidden />
                휴게 시작
              </Button>
            )
          )}

          {showLocationSelect && (
            <div className="ml-auto">
              <LocationSelectInline
                current={myCard?.current_location ?? null}
                date={today}
                onChange={fetchMyCard}
              />
            </div>
          )}
        </div>

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
            <input
              type="date"
              value={filterDate}
              onChange={e => setFilterDate(e.target.value)}
              className="h-9 rounded-[10px] border border-border-strong bg-surface text-[13px] px-3 focus:outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20"
            />
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
            </div>
          </div>

          {finalView === 'list' ? (
            <SubmissionsRawTable
              mine mode="final"
              onEditWorkLog={openEditByWorkLogId}
            />
          ) : (
            <MyHistoryCalendar
              onEditWorkLog={openEditByWorkLogId}
              onCreateCheckIn={(date) => setCalendarCheckInDate(date)}
              onCreateCheckOut={(date) => setCalendarCheckOutDate(date)}
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
