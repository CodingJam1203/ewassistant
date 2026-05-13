'use client'

/**
 * MissingReportsListView
 *
 * 제출내역 페이지의 "미보고 현황" 탭 본체.
 *
 * - 회사 전체(필터 적용) 미보고 일자 리스트
 * - 페이징 (prev/next)
 * - 본인 row: [작성하러 가기] → MY PAGE 이동
 * - 타인 row + leader/admin: [📩 팀즈 알림] 버튼
 * - 타인 row + 일반 사용자: 조회만
 */

import { useEffect, useMemo, useState, useCallback } from 'react'
import { AlertCircle, CheckCircle2, Send, Loader2, ExternalLink } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { ko } from 'date-fns/locale'
import { Button } from '@/components/ui'
import type {
  MissingReportItem,
  MissingReportsResponse,
  MissingStatus,
} from '@/app/api/missing-reports/route'

interface Props {
  /** YYYY-MM-DD */
  from: string
  to: string
  division?: string
  team?: string
  name?: string
  /** 부모 새로고침 트리거 */
  refreshKey?: number
  /** leader+ 권한 — 알림 버튼 노출 여부 */
  canSendNotify: boolean
}

const PAGE_SIZE = 50

function dowKo(dateStr: string): string {
  try { return format(parseISO(dateStr), 'eee', { locale: ko }) } catch { return '' }
}

export default function MissingReportsListView({
  from, to, division, team, name, refreshKey = 0, canSendNotify,
}: Props) {
  const [page, setPage] = useState(1)
  const [data, setData] = useState<MissingReportsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  /** 발송 진행 중 row keys */
  const [sending, setSending] = useState<Set<string>>(new Set())
  /** row별 발송 결과: 'ok' | error message */
  const [sendResult, setSendResult] = useState<Map<string, string>>(new Map())

  // 필터 변경 시 page 리셋
  useEffect(() => {
    setPage(1)
  }, [from, to, division, team, name, refreshKey])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    const params = new URLSearchParams({
      from, to,
      page: String(page),
      limit: String(PAGE_SIZE),
    })
    if (division) params.set('division', division)
    if (team) params.set('team', team)
    if (name) params.set('name', name)
    fetch(`/api/missing-reports?${params.toString()}`)
      .then(async r => {
        if (!r.ok) {
          const j = await r.json().catch(() => ({}))
          throw new Error(j.error ?? `${r.status}`)
        }
        return r.json() as Promise<MissingReportsResponse>
      })
      .then(d => {
        if (cancelled) return
        setData(d)
      })
      .catch(err => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : '조회 실패')
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [from, to, division, team, name, page, refreshKey])

  const rowKey = (it: MissingReportItem) => `${it.email}|${it.date}|${it.status}`

  const handleSend = useCallback(async (it: MissingReportItem) => {
    const k = rowKey(it)
    setSending(prev => {
      const next = new Set(prev)
      next.add(k)
      return next
    })
    setSendResult(prev => {
      const next = new Map(prev)
      next.delete(k)
      return next
    })
    try {
      const res = await fetch('/api/missing-reports/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: it.date,
          email: it.email,
          missingType: it.status,
        }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j.ok) {
        const msg = (j.error as string) ?? '발송 실패'
        setSendResult(prev => {
          const next = new Map(prev)
          next.set(k, `❌ ${msg}`)
          return next
        })
      } else {
        setSendResult(prev => {
          const next = new Map(prev)
          next.set(k, '✅ 발송 완료')
          return next
        })
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : '네트워크 오류'
      setSendResult(prev => {
        const next = new Map(prev)
        next.set(k, `❌ ${msg}`)
        return next
      })
    } finally {
      setSending(prev => {
        const next = new Set(prev)
        next.delete(k)
        return next
      })
    }
  }, [])

  const totalPages = useMemo(() => {
    if (!data) return 1
    return Math.max(1, Math.ceil(data.total / data.limit))
  }, [data])

  // ─── 렌더링 ────────────────────────────────────────────────────────────────
  if (loading && !data) {
    return (
      <div className="space-y-2">
        {[...Array(8)].map((_, i) => (
          <div key={i} className="h-12 bg-surface-muted rounded-[10px] animate-pulse" />
        ))}
      </div>
    )
  }
  if (error) {
    return (
      <div className="rounded-2xl border border-danger-border bg-danger-bg/30 px-4 py-3 text-[13px] text-danger-text">
        조회 실패: {error}
      </div>
    )
  }
  if (!data) return null

  // 빈 결과
  if (data.total === 0) {
    return (
      <div className="rounded-2xl border border-success-border bg-success-bg/40 px-4 py-3 flex items-center gap-2.5 text-[13px] text-success-text">
        <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden />
        <span>이번 기간 미보고 없음 — 모두 정상 보고 완료</span>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* 헤더 */}
      <div className="rounded-2xl border border-danger-border bg-danger-bg/30 px-4 py-3 flex items-center gap-2.5">
        <AlertCircle className="h-4 w-4 text-danger-text shrink-0" aria-hidden />
        <h3 className="text-[13px] font-semibold text-danger-text">
          미보고 {data.total}건
          <span className="ml-2 font-normal text-[12px] text-text-secondary">
            (페이지 {data.page} / {totalPages})
          </span>
        </h3>
      </div>

      {/* 리스트 */}
      <div className="rounded-2xl border border-border bg-surface overflow-hidden">
        <ul className="divide-y divide-border">
          {data.items.map(it => (
            <MissingRow
              key={rowKey(it)}
              item={it}
              isSelf={it.email === data.selfEmail}
              canSendNotify={canSendNotify}
              sending={sending.has(rowKey(it))}
              result={sendResult.get(rowKey(it)) ?? null}
              onSend={handleSend}
            />
          ))}
        </ul>
      </div>

      {/* 페이지네이션 */}
      <div className="flex items-center justify-center gap-3 pt-1">
        <Button
          variant="ghost"
          size="sm"
          disabled={page <= 1 || loading}
          onClick={() => setPage(p => Math.max(1, p - 1))}
        >
          ← 이전
        </Button>
        <span className="text-[13px] text-text-secondary tabular-nums">
          {data.page} / {totalPages}
        </span>
        <Button
          variant="ghost"
          size="sm"
          disabled={page >= totalPages || loading}
          onClick={() => setPage(p => Math.min(totalPages, p + 1))}
        >
          다음 →
        </Button>
      </div>
    </div>
  )
}

// ─── row ────────────────────────────────────────────────────────────────────

interface RowProps {
  item: MissingReportItem
  isSelf: boolean
  canSendNotify: boolean
  sending: boolean
  result: string | null
  onSend: (it: MissingReportItem) => void
}

function MissingRow({ item, isSelf, canSendNotify, sending, result, onSend }: RowProps) {
  const isMissingAll = item.status === 'missing_all'
  const statusLabel = isMissingAll ? '전체 미보고' : '퇴근 누락'
  const statusClass = isMissingAll
    ? 'bg-danger-text text-white'
    : 'bg-warning-text text-white'

  return (
    <li className="flex items-center gap-3 px-4 py-2.5 flex-wrap">
      {/* 날짜 */}
      <span className="font-medium text-text-primary tabular-nums text-[13px] w-[130px] shrink-0">
        {item.date}
        <span className="ml-1 text-[11px] text-text-muted">({dowKo(item.date)})</span>
      </span>

      {/* 상태 칩 */}
      <span className={`inline-flex items-center text-[11px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${statusClass}`}>
        {statusLabel}
      </span>

      {/* 이름 + 본부/팀 */}
      <span className="text-[13px] font-medium text-text-primary flex-1 min-w-0 truncate">
        {item.name}
        {isSelf && (
          <span className="ml-1 inline-flex items-center text-[10px] font-semibold px-1.5 py-0 rounded-full bg-primary-100 text-primary-700 align-middle">
            나
          </span>
        )}
        <span className="ml-2 text-[12px] text-text-secondary font-normal">
          {item.division ?? '—'} {item.team ? `/ ${item.team}` : ''}
        </span>
      </span>

      {/* 액션 영역 */}
      <div className="flex items-center gap-1.5 shrink-0">
        {result && (
          <span className={`text-[11px] ${
            result.startsWith('✅') ? 'text-success-text' : 'text-danger-text'
          }`}>
            {result}
          </span>
        )}
        {isSelf ? (
          <a
            href="/home"
            className="inline-flex items-center gap-1 h-7 px-2.5 rounded-[8px] border border-primary-200 bg-primary-50 text-primary-700 text-[12px] font-medium hover:bg-primary-100 transition-colors"
          >
            <ExternalLink className="h-3 w-3" aria-hidden />
            MY PAGE에서 작성
          </a>
        ) : canSendNotify ? (
          <button
            type="button"
            onClick={() => onSend(item)}
            disabled={sending}
            className="inline-flex items-center gap-1 h-7 px-2.5 rounded-[8px] border border-primary-200 bg-primary-50 text-primary-700 text-[12px] font-medium hover:bg-primary-100 transition-colors disabled:opacity-50 disabled:cursor-wait"
          >
            {sending ? (
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
            ) : (
              <Send className="h-3 w-3" aria-hidden />
            )}
            팀즈 알림
          </button>
        ) : null}
      </div>
    </li>
  )
}

export type { MissingStatus }
