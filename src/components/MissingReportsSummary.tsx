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
import { AlertCircle, CheckCircle2, Plus } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { ko } from 'date-fns/locale'
import type { DayStatusEntry, SubmissionStatusResponse } from '@/app/api/my/submission-status/route'

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

  const missingDays = useMemo(() => {
    if (!data) return []
    return data.days.filter(d => d.status === 'missing_checkout' || d.status === 'missing_all')
  }, [data])

  // 로딩 중 또는 데이터 없음 — 자리만 잡고 안 보임
  if (loading || !data) {
    return (
      <div className="h-0" aria-hidden />
    )
  }

  const { summary } = data

  // 미보고 0건 — 초록 confirm 카드
  if (missingDays.length === 0) {
    return (
      <div className="rounded-2xl border border-success-border bg-success-bg/40 px-4 py-3 flex items-center gap-2.5 text-[13px] text-success-text">
        <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden />
        <span>
          이번 기간 미보고 없음 — <span className="font-semibold tabular-nums">{summary.complete}</span>건 완료
          {summary.onLeave > 0 && <> · 휴가 <span className="font-semibold tabular-nums">{summary.onLeave}</span>일</>}
        </span>
      </div>
    )
  }

  return (
    <div className="rounded-2xl border-2 border-danger-border bg-danger-bg/30 overflow-hidden">
      <div className="px-4 py-3 border-b border-danger-border bg-danger-bg/50 flex items-center gap-2.5">
        <AlertCircle className="h-4 w-4 text-danger-text shrink-0" aria-hidden />
        <h3 className="text-[13px] font-semibold text-danger-text">
          미보고 {missingDays.length}건
          <span className="ml-2 font-normal text-[12px] text-text-secondary">
            {summary.missingCheckout > 0 && <>퇴근 누락 {summary.missingCheckout}</>}
            {summary.missingCheckout > 0 && summary.missingAll > 0 && ' · '}
            {summary.missingAll > 0 && <>전체 미보고 {summary.missingAll}</>}
          </span>
        </h3>
      </div>
      <ul className="divide-y divide-border bg-surface">
        {missingDays.map(d => (
          <MissingRow
            key={d.date}
            day={d}
            onOpenCheckIn={onOpenCheckIn}
            onOpenCheckOut={onOpenCheckOut}
          />
        ))}
      </ul>
    </div>
  )
}

function MissingRow({
  day, onOpenCheckIn, onOpenCheckOut,
}: {
  day: DayStatusEntry
  onOpenCheckIn?: (date: string) => void
  onOpenCheckOut?: (date: string) => void
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
      <button
        type="button"
        onClick={handleClick}
        className="inline-flex items-center gap-1 h-7 px-2.5 rounded-[8px] border border-primary-200 bg-primary-50 text-primary-700 text-[12px] font-medium hover:bg-primary-100 transition-colors shrink-0"
      >
        <Plus className="h-3 w-3" aria-hidden />
        {isMissingAll ? '출근보고 작성' : '퇴근보고 작성'}
      </button>
    </li>
  )
}
