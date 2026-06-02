'use client'

/**
 * v1.73 Phase 3 — 리더 관리 뷰 테이블.
 * /api/leader-reviews 응답을 테이블로 렌더 + 피드백 드롭다운 + 알림 버튼.
 *
 * 핵심:
 *   - 보고종류 default '퇴근보고' filter (check_out)
 *   - 대상일자 내림차순 (서버 기본)
 *   - status='missing'/'wrong' row 붉은 음영
 *   - 드롭다운 변경 → PATCH /api/leader-reviews (낙관적 업데이트)
 *   - [📢 알림] 버튼 (missing/wrong 한정) → POST /api/leader-reviews/notify
 *   - 사용 토글 OFF 본부/팀에 리뷰 가능 대상 없으면 안내
 */

import { useEffect, useMemo, useState } from 'react'
import { Bell, AlertCircle } from 'lucide-react'
import { Badge, Input, Select, Table, Th, Td } from '@/components/ui'
import { cn } from '@/lib/utils/cn'
import { dowKo } from '@/lib/utils/date'

type ReviewStatus = 'checked' | 'missing' | 'wrong'

interface LeaderReviewRow {
  work_log_id: string
  user_email: string
  display_name: string | null
  division: string | null
  team: string | null
  effective_team: string | null
  target_date: string
  planned_start_time: string | null
  planned_end_time: string | null
  actual_start_time: string | null
  actual_end_time: string | null
  start_time: string | null
  end_time: string | null
  work_location: string | null
  work_content: string | null
  review_status: ReviewStatus | null
  review_note: string | null
  reviewer_email: string | null
  reviewed_at: string | null
}

interface ApiResp {
  rows: LeaderReviewRow[]
  reviewableTeams: Array<{ division: string; team: string }>
}

interface Props {
  /** 외부 본부 필터 (history page의 FilterBar에서) */
  divisionFilter?: string
  /** 외부 팀 필터 */
  teamFilter?: string
  /** 새로고침 트리거용 */
  refreshTick?: number
  /** 보고 종류 default — 사용자 결정으로 '퇴근보고' (check_out) */
  defaultReportKind?: 'check_in' | 'check_out'
}

function thisMonthRange(): { from: string; to: string } {
  const now = new Date()
  const y = now.getFullYear()
  const m = now.getMonth()
  const last = new Date(y, m + 1, 0).getDate()
  const pad = (n: number) => String(n).padStart(2, '0')
  return {
    from: `${y}-${pad(m + 1)}-01`,
    to: `${y}-${pad(m + 1)}-${pad(last)}`,
  }
}

function fmtTime(hhmmss: string | null): string {
  if (!hhmmss) return '-'
  return hhmmss.slice(0, 5)
}

function statusBadgeClass(status: ReviewStatus | null): string {
  if (status === 'checked') return 'bg-green-50 text-green-700 border-green-200'
  if (status === 'missing' || status === 'wrong') return 'bg-red-50 text-red-700 border-red-200'
  return 'bg-surface-muted text-text-secondary border-border'
}

function statusLabel(status: ReviewStatus | null): string {
  switch (status) {
    case 'checked': return '✓ 체크완료'
    case 'missing': return '⚠ 미상신'
    case 'wrong':   return '✗ 오상신'
    default:        return '(미선택)'
  }
}

export default function LeaderReviewsTable({
  divisionFilter,
  teamFilter,
  refreshTick,
  defaultReportKind = 'check_out',
}: Props) {
  const initial = useMemo(thisMonthRange, [])
  const [from, setFrom] = useState(initial.from)
  const [to, setTo] = useState(initial.to)
  const [reportKind, setReportKind] = useState<'all' | 'check_in' | 'check_out'>(defaultReportKind)
  const [nameQuery, setNameQuery] = useState('')

  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<ApiResp | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busyRowId, setBusyRowId] = useState<string | null>(null)
  const [notifyResultByWl, setNotifyResultByWl] = useState<Record<string, { ok: boolean; msg?: string }>>({})

  // fetch
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    const params = new URLSearchParams({ from, to })
    if (divisionFilter) params.set('division', divisionFilter)
    if (teamFilter) params.set('team', teamFilter)
    fetch(`/api/leader-reviews?${params.toString()}`, { cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok) {
          const e = await r.json().catch(() => ({}))
          throw new Error(e?.error ?? `HTTP ${r.status}`)
        }
        return r.json() as Promise<ApiResp>
      })
      .then((j) => {
        if (cancelled) return
        setData(j)
      })
      .catch((e) => {
        if (cancelled) return
        setError(e instanceof Error ? e.message : String(e))
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [from, to, divisionFilter, teamFilter, refreshTick])

  // filter (client-side)
  const filteredRows = useMemo(() => {
    if (!data) return []
    const q = nameQuery.trim()
    return data.rows.filter((r) => {
      // 보고 종류 filter (check_out: actual_end_time 또는 end_time 채워진 row)
      if (reportKind === 'check_out') {
        const hasCheckOut = !!(r.actual_end_time || r.end_time)
        if (!hasCheckOut) return false
      }
      if (reportKind === 'check_in') {
        const hasCheckIn = !!(r.actual_start_time || r.planned_start_time || r.start_time)
        if (!hasCheckIn) return false
      }
      if (q && !(r.display_name ?? '').includes(q)) return false
      return true
    })
  }, [data, reportKind, nameQuery])

  const handleStatusChange = async (workLogId: string, next: ReviewStatus | '') => {
    setBusyRowId(workLogId)
    try {
      const res = await fetch('/api/leader-reviews', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          work_log_id: workLogId,
          status: next === '' ? null : next,
        }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        alert('피드백 저장 실패: ' + (j?.error ?? res.statusText))
        return
      }
      // 낙관적 업데이트
      setData((prev) => {
        if (!prev) return prev
        return {
          ...prev,
          rows: prev.rows.map((r) =>
            r.work_log_id === workLogId
              ? { ...r, review_status: next === '' ? null : next }
              : r,
          ),
        }
      })
    } finally {
      setBusyRowId(null)
    }
  }

  const handleNotify = async (row: LeaderReviewRow) => {
    setBusyRowId(row.work_log_id)
    try {
      const res = await fetch('/api/leader-reviews/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          work_log_id: row.work_log_id,
          report_kind: reportKind === 'check_in' ? 'check_in' : 'check_out',
        }),
      })
      const j = await res.json().catch(() => ({}))
      setNotifyResultByWl((prev) => ({
        ...prev,
        [row.work_log_id]: { ok: res.ok && j.ok, msg: j?.error },
      }))
      if (!res.ok || !j.ok) {
        alert('알림 발송 실패: ' + (j?.error ?? res.statusText))
      }
    } finally {
      setBusyRowId(null)
    }
  }

  if (loading) {
    return (
      <div className="space-y-2">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="h-10 bg-surface-muted rounded-[10px] animate-pulse" />
        ))}
      </div>
    )
  }
  if (error) {
    return (
      <div className="p-4 bg-red-50 border border-red-200 rounded-[10px] text-red-700 text-sm flex items-center gap-2">
        <AlertCircle className="h-4 w-4 shrink-0" />
        <span>{error}</span>
      </div>
    )
  }
  if (!data || data.reviewableTeams.length === 0) {
    return (
      <div className="p-6 bg-surface-muted rounded-[10px] text-text-secondary text-sm text-center">
        리더 관리 기능이 켜진 팀이 없습니다. 관리자에게 활성화를 요청하세요.
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* 자체 필터 바 */}
      <div className="flex flex-wrap items-center gap-3 p-3 bg-surface-muted rounded-[10px]">
        <label className="text-[12px] text-text-secondary">기간</label>
        <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" />
        <span className="text-text-muted">~</span>
        <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" />

        <label className="text-[12px] text-text-secondary ml-2">보고 종류</label>
        <Select value={reportKind} onChange={(e) => setReportKind(e.target.value as 'all' | 'check_in' | 'check_out')} className="w-32">
          <option value="check_out">퇴근보고</option>
          <option value="check_in">출근보고</option>
          <option value="all">전체</option>
        </Select>

        <label className="text-[12px] text-text-secondary ml-2">이름</label>
        <Input
          type="text"
          value={nameQuery}
          onChange={(e) => setNameQuery(e.target.value)}
          placeholder="이름 일부"
          className="w-32"
        />

        <div className="ml-auto text-[12px] text-text-muted">
          {filteredRows.length}건 / 총 {data.rows.length}건
        </div>
      </div>

      {filteredRows.length === 0 ? (
        <div className="p-6 bg-surface-muted rounded-[10px] text-text-secondary text-sm text-center">
          조회된 보고가 없습니다.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <thead>
              <tr>
                <Th className="text-center w-40">리더 피드백</Th>
                <Th className="text-center w-24">알림</Th>
                <Th>대상일</Th>
                <Th>이름</Th>
                <Th>본부 / 팀</Th>
                <Th>출근</Th>
                <Th>퇴근</Th>
                <Th>근무장소</Th>
                <Th>근무내용</Th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((r) => {
                const isAlert = r.review_status === 'missing' || r.review_status === 'wrong'
                const rowClass = isAlert ? 'bg-red-50' : (r.review_status === 'checked' ? 'bg-green-50/40' : '')
                const actStart = r.actual_start_time ?? r.start_time
                const actEnd = r.actual_end_time ?? r.end_time
                const notifyRes = notifyResultByWl[r.work_log_id]
                return (
                  <tr key={r.work_log_id} className={cn(rowClass, 'border-b border-border')}>
                    <Td className="text-center">
                      <select
                        value={r.review_status ?? ''}
                        onChange={(e) => handleStatusChange(r.work_log_id, e.target.value as ReviewStatus | '')}
                        disabled={busyRowId === r.work_log_id}
                        className={cn(
                          'h-7 text-[12px] rounded border px-2 cursor-pointer w-full',
                          statusBadgeClass(r.review_status),
                          busyRowId === r.work_log_id && 'opacity-50 cursor-wait',
                        )}
                      >
                        <option value="">(미선택)</option>
                        <option value="checked">{statusLabel('checked')}</option>
                        <option value="missing">{statusLabel('missing')}</option>
                        <option value="wrong">{statusLabel('wrong')}</option>
                      </select>
                    </Td>
                    <Td className="text-center">
                      {isAlert ? (
                        <button
                          onClick={() => handleNotify(r)}
                          disabled={busyRowId === r.work_log_id}
                          className={cn(
                            'inline-flex items-center gap-1 px-2 h-7 text-[11px] rounded border border-red-300 bg-white text-red-700 hover:bg-red-100 transition-colors',
                            busyRowId === r.work_log_id && 'opacity-50 cursor-wait',
                          )}
                          title="대상자 팀 채널에 알림 발송"
                        >
                          <Bell className="h-3 w-3" /> 알림
                        </button>
                      ) : '-'}
                      {notifyRes && (
                        <div className={cn('mt-1 text-[10px]', notifyRes.ok ? 'text-green-600' : 'text-red-600')}>
                          {notifyRes.ok ? '발송됨' : '실패'}
                        </div>
                      )}
                    </Td>
                    <Td className="font-medium tabular-nums">
                      {r.target_date}
                      <span className="ml-1 text-[11px] text-text-muted">({dowKo(r.target_date)})</span>
                    </Td>
                    <Td>{r.display_name ?? r.user_email}</Td>
                    <Td className="text-[12px] text-text-secondary">
                      {r.division ?? '-'} / {r.effective_team ?? r.team ?? '-'}
                    </Td>
                    <Td className="tabular-nums text-[12px]">
                      {fmtTime(actStart)}
                      <span className="text-text-muted text-[11px] ml-1">(예 {fmtTime(r.planned_start_time)})</span>
                    </Td>
                    <Td className="tabular-nums text-[12px]">
                      {fmtTime(actEnd)}
                      <span className="text-text-muted text-[11px] ml-1">(예 {fmtTime(r.planned_end_time)})</span>
                    </Td>
                    <Td className="text-[12px]">{r.work_location ?? '-'}</Td>
                    <Td className="text-[12px] max-w-[280px] truncate" title={r.work_content ?? ''}>
                      {r.work_content ?? '-'}
                    </Td>
                  </tr>
                )
              })}
            </tbody>
          </Table>
        </div>
      )}

      <div className="flex items-center gap-3 text-[11px] text-text-muted">
        <Badge variant="success">체크완료</Badge>
        <span>녹색 음영</span>
        <Badge variant="danger">미상신 / 오상신</Badge>
        <span>붉은 음영 — 알림 발송 가능</span>
      </div>
    </div>
  )
}
