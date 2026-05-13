'use client'

/**
 * 미보고 요약 카드 — 본인의 보고 상태를 한눈에 보여주고, [지금 작성] 버튼으로
 * 해당 일자의 퇴근보고/출근보고 모달을 바로 열 수 있게 한다.
 *
 * 사용처:
 *   - MY PAGE 테이블뷰 상단
 *   - (옵션) 캘린더뷰 상단 — 캘린더는 자체 월 요약 뱃지를 따로 둠
 */

import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, CheckCircle2, Plus, X } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { ko } from 'date-fns/locale'
import type { DayStatusEntry, SubmissionStatusResponse } from '@/app/api/my/submission-status/route'

// localStorage key — dismiss한 날짜는 다음 fetch에서도 숨김.
// 보고 작성하면 status가 missing_*에서 빠지므로 자동으로 미보고 리스트에서 사라짐 → dismiss 영구.
const STORAGE_KEY = 'missing-reports-dismissed'

function loadDismissed(): Set<string> {
  if (typeof window === 'undefined') return new Set()
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return new Set()
    const arr = JSON.parse(raw) as unknown
    return new Set(Array.isArray(arr) ? (arr as string[]).filter(s => typeof s === 'string') : [])
  } catch { return new Set() }
}

function saveDismissed(set: Set<string>): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...set]))
  } catch {}
}

interface Props {
  /** 조회 범위 — 보통 이번 달 시작/끝 */
  from: string
  to: string
  /** 미보고 항목 클릭 시 호출 — 부모가 적절한 모달 오픈 처리 */
  onOpenCheckIn?: (date: string) => void
  onOpenCheckOut?: (date: string) => void
  /** 외부 트리거로 재조회 (예: 모달 저장 후) */
  refreshKey?: number
}

function dowKo(dateStr: string): string {
  try { return format(parseISO(dateStr), 'eee', { locale: ko }) } catch { return '' }
}

export default function MissingReportsSummary({
  from, to, onOpenCheckIn, onOpenCheckOut, refreshKey = 0,
}: Props) {
  const [data, setData] = useState<SubmissionStatusResponse | null>(null)
  const [loading, setLoading] = useState(true)
  // dismiss 상태 — 사용자가 X 또는 "전체 무시"로 숨긴 날짜들. localStorage 영속.
  const [dismissed, setDismissed] = useState<Set<string>>(() => loadDismissed())

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch(`/api/my/submission-status?from=${from}&to=${to}`)
      .then(r => r.ok ? r.json() : null)
      .then((d: SubmissionStatusResponse | null) => {
        if (cancelled) return
        setData(d)
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [from, to, refreshKey])

  // 전체 미보고(서버 기준) — 헤더 카운트에 사용
  const allMissingDays = useMemo(() => {
    if (!data) return []
    return data.days.filter(d => d.status === 'missing_checkout' || d.status === 'missing_all')
  }, [data])

  // dismiss 제외한 표시 대상
  const visibleMissingDays = useMemo(() => {
    return allMissingDays.filter(d => !dismissed.has(d.date))
  }, [allMissingDays, dismissed])

  const handleDismiss = (date: string) => {
    setDismissed(prev => {
      const next = new Set(prev)
      next.add(date)
      saveDismissed(next)
      return next
    })
  }

  const handleDismissAll = () => {
    setDismissed(prev => {
      const next = new Set(prev)
      for (const d of allMissingDays) next.add(d.date)
      saveDismissed(next)
      return next
    })
  }

  // 로딩 중 또는 데이터 없음 — 자리만 잡고 안 보임
  if (loading || !data) {
    return (
      <div className="h-0" aria-hidden />
    )
  }

  const { summary } = data

  // 전체 미보고 0건 (또는 모두 dismiss됨) — 초록 confirm 카드
  if (visibleMissingDays.length === 0) {
    const hiddenCount = allMissingDays.length
    return (
      <div className="rounded-2xl border border-success-border bg-success-bg/40 px-4 py-3 flex items-center gap-2.5 text-[13px] text-success-text">
        <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden />
        <span className="flex-1">
          {hiddenCount > 0 ? (
            <>이번 기간 미보고 알림 모두 숨김 ({hiddenCount}건) — <span className="font-semibold tabular-nums">{summary.complete}</span>건 완료</>
          ) : (
            <>이번 기간 미보고 없음 — <span className="font-semibold tabular-nums">{summary.complete}</span>건 완료</>
          )}
          {summary.onLeave > 0 && <> · 휴가 <span className="font-semibold tabular-nums">{summary.onLeave}</span>일</>}
        </span>
      </div>
    )
  }

  return (
    <div className="rounded-2xl border-2 border-danger-border bg-danger-bg/30 overflow-hidden">
      <div className="px-4 py-3 border-b border-danger-border bg-danger-bg/50 flex items-center gap-2.5">
        <AlertCircle className="h-4 w-4 text-danger-text shrink-0" aria-hidden />
        <h3 className="text-[13px] font-semibold text-danger-text flex-1">
          미보고 {visibleMissingDays.length}건
          <span className="ml-2 font-normal text-[12px] text-text-secondary">
            {summary.missingCheckout > 0 && <>퇴근 누락 {summary.missingCheckout}</>}
            {summary.missingCheckout > 0 && summary.missingAll > 0 && ' · '}
            {summary.missingAll > 0 && <>전체 미보고 {summary.missingAll}</>}
          </span>
        </h3>
        <button
          type="button"
          onClick={handleDismissAll}
          className="text-[12px] text-danger-text/80 hover:text-danger-text hover:underline font-medium shrink-0"
        >
          전체 무시
        </button>
      </div>
      <ul className="divide-y divide-border bg-surface">
        {visibleMissingDays.map(d => (
          <MissingRow
            key={d.date}
            day={d}
            onOpenCheckIn={onOpenCheckIn}
            onOpenCheckOut={onOpenCheckOut}
            onDismiss={handleDismiss}
          />
        ))}
      </ul>
    </div>
  )
}

function MissingRow({
  day, onOpenCheckIn, onOpenCheckOut, onDismiss,
}: {
  day: DayStatusEntry
  onOpenCheckIn?: (date: string) => void
  onOpenCheckOut?: (date: string) => void
  onDismiss?: (date: string) => void
}) {
  const isMissingAll = day.status === 'missing_all'
  const label = isMissingAll ? '전체 미보고' : '퇴근 누락'
  const labelColor = isMissingAll ? 'text-danger-text' : 'text-warning-text'

  const handleClick = () => {
    // 전체 미보고면 출근보고부터, 퇴근 누락이면 퇴근보고 모달
    if (isMissingAll) {
      onOpenCheckIn?.(day.date)
    } else {
      onOpenCheckOut?.(day.date)
    }
  }

  return (
    <li className="flex items-center justify-between gap-3 px-4 py-2.5">
      <div className="flex items-center gap-3 min-w-0">
        <span className="font-medium text-text-primary tabular-nums text-[13px] shrink-0">
          {day.date}
          <span className="ml-1 text-[11px] text-text-muted">({dowKo(day.date)})</span>
        </span>
        <span className={`text-[12px] font-medium ${labelColor}`}>{label}</span>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <button
          type="button"
          onClick={handleClick}
          className="inline-flex items-center gap-1 h-7 px-2.5 rounded-[8px] border border-primary-200 bg-primary-50 text-primary-700 text-[12px] font-medium hover:bg-primary-100 transition-colors"
        >
          <Plus className="h-3 w-3" aria-hidden />
          {isMissingAll ? '출근보고 작성' : '퇴근보고 작성'}
        </button>
        <button
          type="button"
          onClick={() => onDismiss?.(day.date)}
          aria-label="이 알림 무시"
          title="이 알림 무시"
          className="inline-flex items-center justify-center h-7 w-7 rounded-[8px] text-text-muted hover:text-text-primary hover:bg-surface-muted transition-colors"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </li>
  )
}
