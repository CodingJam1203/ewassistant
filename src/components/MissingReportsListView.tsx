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

import { useEffect, useState, useCallback } from 'react'
import { AlertCircle, CheckCircle2, Send, Loader2, ExternalLink } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { ko } from 'date-fns/locale'
import Pagination from '@/components/Pagination'
import { Input } from '@/components/ui'
import type {
  MissingReportItem,
  MissingReportsResponse,
  MissingStatus,
} from '@/app/api/missing-reports/route'
import { DIVISION_DIRECT_LABEL } from '@/lib/org'

interface Props {
  /** YYYY-MM-DD */
  from: string
  to: string
  division?: string
  team?: string
  /** 부모 새로고침 트리거 */
  refreshKey?: number
  /** leader+ 권한 — 알림 버튼 노출 여부 */
  canSendNotify: boolean
}

function dowKo(dateStr: string): string {
  try { return format(parseISO(dateStr), 'eee', { locale: ko }) } catch { return '' }
}

export default function MissingReportsListView({
  from, to, division, team, refreshKey = 0, canSendNotify,
}: Props) {
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [data, setData] = useState<MissingReportsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  /** 발송 진행 중 row keys */
  const [sending, setSending] = useState<Set<string>>(new Set())
  /** row별 발송 결과: 'ok' | error message */
  const [sendResult, setSendResult] = useState<Map<string, string>>(new Map())
  // v1.61.13 — 이름 즉시 검색. 헤더 박스 안 input 으로 사용자가 타이핑하면 350ms debounce
  // 후 서버 fetch에 `name=` 쿼리 포함. 종전 history page 상단 전역 이름 검색 폐기 후 미보고
  // 탭에 이름 필터를 살리려는 대체 흐름. SubmissionsRawTable은 이미 자체 quick filter 보유.
  const [nameQuery, setNameQuery] = useState('')
  const [activeName, setActiveName] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setActiveName(nameQuery.trim()), 350)
    return () => clearTimeout(t)
  }, [nameQuery])

  // 필터 변경 시 page 리셋
  useEffect(() => {
    setPage(1)
  }, [from, to, division, team, activeName, refreshKey])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    const params = new URLSearchParams({
      from, to,
      page: String(page),
      limit: String(pageSize),
    })
    if (division) params.set('division', division)
    if (team) params.set('team', team)
    if (activeName) params.set('name', activeName)
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
  }, [from, to, division, team, activeName, page, pageSize, refreshKey])

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

  // 빈 결과 — 이름 검색 중이면 input은 그대로 노출하고 안내 문구만 분기
  if (data.total === 0) {
    return (
      <div className="space-y-3">
        <div className="rounded-2xl border border-border bg-surface px-4 py-2.5 flex items-center gap-2.5">
          <span className="text-[12px] text-text-muted">이름 빠른 검색</span>
          <div className="ml-auto">
            <Input
              type="text"
              inputSize="sm"
              value={nameQuery}
              onChange={e => setNameQuery(e.target.value)}
              placeholder="이름 일부"
              className="w-36"
            />
          </div>
        </div>
        <div className="rounded-2xl border border-success-border bg-success-bg/40 px-4 py-3 flex items-center gap-2.5 text-[13px] text-success-text">
          <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden />
          <span>
            {activeName
              ? `"${activeName}" 검색 결과 없음 — 해당 이름의 미보고 건이 없습니다`
              : '이번 기간 미보고 없음 — 모두 정상 보고 완료'}
          </span>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* 헤더 + 이름 빠른 검색 */}
      <div className="rounded-2xl border border-danger-border bg-danger-bg/30 px-4 py-3 flex items-center gap-2.5">
        <AlertCircle className="h-4 w-4 text-danger-text shrink-0" aria-hidden />
        <h3 className="text-[13px] font-semibold text-danger-text">
          미보고 {data.total}건
        </h3>
        <div className="ml-auto">
          <Input
            type="text"
            inputSize="sm"
            value={nameQuery}
            onChange={e => setNameQuery(e.target.value)}
            placeholder="이름 일부"
            className="w-36"
          />
        </div>
      </div>

      {/* 리스트 + 페이지네이션 (한 박스) */}
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
        <Pagination
          totalCount={data.total}
          page={page}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
          unit="건"
        />
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
          {item.division ?? '—'} {item.division ? `/ ${item.team?.trim() || DIVISION_DIRECT_LABEL}` : (item.team ?? '')}
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
