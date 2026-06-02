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

interface ReviewableUser {
  email: string
  display_name: string | null
  division: string | null
  team: string | null
  effective_team: string | null
}

interface VirtualReview {
  user_email: string
  target_date: string
  review_status: ReviewStatus
  review_note: string | null
  reviewer_email: string | null
  reviewed_at: string | null
}

interface ApiResp {
  rows: LeaderReviewRow[]
  /** v1.74 — work_log 없는데 review 박힌 케이스 (매트릭스 가상 셀) */
  virtualReviews?: VirtualReview[]
  /** v1.74 — 매트릭스 사용자 목록 (보고 없어도 row 표시) */
  reviewableUsers?: ReviewableUser[]
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
    case 'missing': return '⚠ EW미상신'
    case 'wrong':   return '✗ EW오상신'
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
  // v1.74.5 — 리더 관리는 퇴근보고 전용 (사용자 결정). 종류 셀렉트 폐기.
  const reportKind: 'check_out' = 'check_out'
  const [nameQuery, setNameQuery] = useState('')
  /** v1.73 Phase 4 — 테이블 / 매트릭스 view 토글 */
  const [view, setView] = useState<'table' | 'matrix'>('table')

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

  // v1.74.5/.11 — 리더 관리 = 퇴근보고 전용.
  // 테이블뷰: actual_end_time(실제 퇴근 완료)만 체크. legacy end_time은 사전등록 시에도
  //   채워지는 컬럼이라 미래 work_log가 섞임 → 제외.
  // 매트릭스: 사용자×날짜 풀 그리드 — 종류 필터 무관.
  const filteredRows = useMemo(() => {
    if (!data) return []
    const q = nameQuery.trim()
    return data.rows.filter((r) => {
      if (view === 'table') {
        if (!r.actual_end_time) return false
      }
      if (q && !(r.display_name ?? '').includes(q)) return false
      return true
    })
  }, [data, nameQuery, view])

  /**
   * v1.74.3 — 진짜 낙관적 업데이트.
   * 1) setData 먼저 (UI 즉시 반영)
   * 2) fetch 백그라운드
   * 3) 실패 시 rollback + alert
   * busyRowId 안 박음 — UI 즉시 응답.
   */
  const handleStatusChange = async (
    args: { workLogId: string | null; userEmail: string; date: string },
    next: ReviewStatus | '',
  ) => {
    const status = next === '' ? null : next
    // 1) prev snapshot (rollback용)
    const snapshot = data
    // 2) 낙관적 업데이트
    setData((prev) => {
      if (!prev) return prev
      const updatedRows = prev.rows.map((r) =>
        r.user_email === args.userEmail && r.target_date === args.date
          ? { ...r, review_status: status }
          : r,
      )
      const prevVirtual = prev.virtualReviews ?? []
      let newVirtual = prevVirtual
      const matched = updatedRows.some((r) => r.user_email === args.userEmail && r.target_date === args.date)
      if (!matched) {
        const filtered = prevVirtual.filter((v) => !(v.user_email === args.userEmail && v.target_date === args.date))
        if (status) {
          newVirtual = [...filtered, {
            user_email: args.userEmail,
            target_date: args.date,
            review_status: status,
            review_note: null,
            reviewer_email: null,
            reviewed_at: new Date().toISOString(),
          }]
        } else {
          newVirtual = filtered
        }
      }
      return { ...prev, rows: updatedRows, virtualReviews: newVirtual }
    })
    // 3) 백그라운드 fetch
    try {
      const res = await fetch('/api/leader-reviews', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          work_log_id: args.workLogId,
          target_user_email: args.userEmail,
          target_date: args.date,
          status,
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        alert('피드백 저장 실패 (롤백): ' + (j?.error ?? res.statusText))
        setData(snapshot)  // rollback
      }
    } catch (err) {
      alert('피드백 저장 실패 (네트워크): ' + (err instanceof Error ? err.message : String(err)))
      setData(snapshot)
    }
  }

  const handleNotify = async (row: LeaderReviewRow) => {
    // v1.74.9 — 알림 발송 시점에만 메모 받기 (prompt). 빈 값이면 메모 라인 없이 발송.
    const note = window.prompt('알림에 포함할 메모 (선택)', '')
    if (note === null) return  // 취소
    setBusyRowId(row.work_log_id)
    try {
      const res = await fetch('/api/leader-reviews/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target_user_email: row.user_email,
          target_date: row.target_date,
          work_log_id: row.work_log_id,
          report_kind: 'check_out',  // v1.74.5 — 리더 관리는 퇴근보고 전용
          note: note.trim() || null,
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
      {/* v1.74 — 압축 필터바. 데스크탑 1행, 모바일은 자연 wrap. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2 bg-surface-muted rounded-[8px] text-[12px]">
        <div className="flex items-center gap-1.5">
          <span className="text-text-secondary whitespace-nowrap">기간</span>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="!h-7 !text-[12px] w-36" />
          <span className="text-text-muted">~</span>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="!h-7 !text-[12px] w-36" />
        </div>
        {/* v1.74.5 — 리더 관리는 퇴근보고 전용. 종류 셀렉트 폐기. 알림 채널 = 퇴근보고 고정. */}
        <div className="flex items-center gap-1.5">
          <span className="text-text-secondary whitespace-nowrap">이름</span>
          <Input
            type="text"
            value={nameQuery}
            onChange={(e) => setNameQuery(e.target.value)}
            placeholder="검색"
            className="!h-7 !text-[12px] w-28"
          />
        </div>
        <div className="ml-auto flex items-center gap-2 text-text-muted">
          <span>{filteredRows.length} / {data.rows.length}건</span>
          {/* v1.73 Phase 4 — view 토글 */}
          <div className="inline-flex border border-border rounded overflow-hidden">
            <button
              onClick={() => setView('table')}
              className={cn(
                'px-2 h-7 text-[12px] transition-colors',
                view === 'table' ? 'bg-primary-600 text-white' : 'bg-white text-text-secondary hover:bg-surface-muted',
              )}
            >
              테이블
            </button>
            <button
              onClick={() => setView('matrix')}
              className={cn(
                'px-2 h-7 text-[12px] transition-colors',
                view === 'matrix' ? 'bg-primary-600 text-white' : 'bg-white text-text-secondary hover:bg-surface-muted',
              )}
            >
              매트릭스
            </button>
          </div>
        </div>
      </div>

      {filteredRows.length === 0 ? (
        <div className="p-6 bg-surface-muted rounded-[10px] text-text-secondary text-sm text-center">
          조회된 보고가 없습니다.
        </div>
      ) : view === 'matrix' ? (
        <MatrixView
          rows={filteredRows}
          virtualReviews={data.virtualReviews ?? []}
          reviewableUsers={data.reviewableUsers ?? []}
          from={from}
          to={to}
          busyRowId={busyRowId}
          onStatusChange={handleStatusChange}
        />
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <thead>
              <tr>
                <Th className="text-center w-[160px] min-w-[160px]">리더 피드백</Th>
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
                        onChange={(e) => handleStatusChange({ workLogId: r.work_log_id, userEmail: r.user_email, date: r.target_date }, e.target.value as ReviewStatus | '')}
                        disabled={busyRowId === r.work_log_id}
                        className={cn(
                          'h-7 text-[12px] rounded border px-2 cursor-pointer w-full min-w-[140px]',
                          statusBadgeClass(r.review_status),
                          busyRowId === r.work_log_id && 'opacity-50 cursor-wait',
                        )}
                      >
                        {/* v1.74.12 — 이모지로 구분 (상신 ⭕ / 미보고 ❌) */}
                        <option value="">{r.work_log_id ? '⭕ 상신' : '❌ 미보고'}</option>
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
        <Badge variant="danger">EW미상신 / EW오상신</Badge>
        <span>붉은 음영 — 알림 발송 가능</span>
      </div>
    </div>
  )
}

// ─── v1.73 Phase 4 — 매트릭스 뷰 ────────────────────────────────────────────────

interface MatrixCell {
  /** work_log 있는 경우만 채워짐. 없으면 null (가상 셀) */
  work_log_id: string | null
  review_status: ReviewStatus | null
  hasWorkLog: boolean
}

interface MatrixViewProps {
  rows: LeaderReviewRow[]
  /** v1.74 — work_log 없는 review (가상) */
  virtualReviews: VirtualReview[]
  /** v1.74 — 전체 사용자 목록 (보고 없는 사용자도 행 노출) */
  reviewableUsers: ReviewableUser[]
  from: string
  to: string
  busyRowId: string | null
  onStatusChange: (
    args: { workLogId: string | null; userEmail: string; date: string },
    next: ReviewStatus | '',
  ) => Promise<void>
}

function MatrixView({ rows, virtualReviews, reviewableUsers, from, to, busyRowId, onStatusChange }: MatrixViewProps) {
  // 가로 날짜 컬럼
  const dates = useMemo(() => {
    const out: string[] = []
    const start = new Date(from + 'T00:00:00Z')
    const end = new Date(to + 'T00:00:00Z')
    for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
      out.push(d.toISOString().slice(0, 10))
    }
    return out
  }, [from, to])

  // 사용자 목록 — reviewableUsers (보고 없어도 노출)
  const users = useMemo(() => {
    return [...reviewableUsers]
      .map((u) => ({
        email: u.email,
        name: u.display_name ?? u.email,
        division: u.division ?? '',
        team: u.effective_team ?? u.team ?? '',
      }))
      .sort((a, b) =>
        (a.division + a.team).localeCompare(b.division + b.team) || a.name.localeCompare(b.name, 'ko'),
      )
  }, [reviewableUsers])

  // 셀 map — work_log 있는 row + 가상 review 합쳐서
  const byUserDate = useMemo(() => {
    const m = new Map<string, MatrixCell>()
    for (const r of rows) {
      m.set(`${r.user_email}|${r.target_date}`, {
        work_log_id: r.work_log_id,
        review_status: r.review_status,
        hasWorkLog: true,
      })
    }
    for (const v of virtualReviews) {
      m.set(`${v.user_email}|${v.target_date}`, {
        work_log_id: null,
        review_status: v.review_status,
        hasWorkLog: false,
      })
    }
    return m
  }, [rows, virtualReviews])

  const cellBgClass = (status: ReviewStatus | null | undefined): string => {
    if (status === 'checked') return 'bg-green-50'
    if (status === 'missing' || status === 'wrong') return 'bg-red-50'
    return ''
  }

  const dayLabel = (date: string) => {
    const d = new Date(date + 'T00:00:00Z')
    const dow = d.getUTCDay()
    const md = `${d.getUTCMonth() + 1}/${d.getUTCDate()}`
    const dowKo = ['일', '월', '화', '수', '목', '금', '토'][dow]
    return { md, dowKo, isWeekend: dow === 0 || dow === 6 }
  }

  // v1.74 — 셀 텍스트(미상신/오상신 등) 들어가게 너비 확장.
  const COL_W = 'w-[110px] min-w-[110px] max-w-[110px]'
  const NAME_COL_W = 'w-[140px] min-w-[140px] max-w-[140px]'

  return (
    <div className="overflow-x-auto border border-border rounded-[8px]">
      <table className="border-collapse text-[12px]" style={{ tableLayout: 'fixed' }}>
        <thead className="bg-surface-muted">
          <tr>
            <th className={cn('sticky left-0 z-10 bg-surface-muted border-b border-r border-border px-2 py-2 text-left font-semibold', NAME_COL_W)}>
              구성원 / 날짜
            </th>
            {dates.map((d) => {
              const { md, dowKo, isWeekend } = dayLabel(d)
              return (
                <th
                  key={d}
                  className={cn(
                    'border-b border-r border-border px-2 py-1 text-center font-medium whitespace-nowrap',
                    COL_W,
                    isWeekend && 'text-red-500',
                  )}
                >
                  <div className="text-[11px]">{md}</div>
                  <div className="text-[10px] text-text-muted">({dowKo})</div>
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.email}>
              <td className={cn('sticky left-0 z-10 bg-white border-b border-r border-border px-2 py-2 text-left whitespace-nowrap', NAME_COL_W)}>
                <div className="font-medium text-text-primary truncate">{u.name}</div>
                <div className="text-[10px] text-text-muted truncate">{u.team}</div>
              </td>
              {dates.map((d) => {
                // v1.74 — 모든 셀에 드롭다운. work_log 없는 셀(가상)은 시각적 차별만.
                const cell: MatrixCell = byUserDate.get(`${u.email}|${d}`) ?? {
                  work_log_id: null,
                  review_status: null,
                  hasWorkLog: false,
                }
                const busyKey = cell.work_log_id ?? `virtual:${u.email}|${d}`
                const busy = busyRowId === busyKey
                const isVirtual = !cell.hasWorkLog
                return (
                  <td
                    key={d}
                    className={cn(
                      'border-b border-r border-border px-1 py-1 text-center align-middle',
                      COL_W,
                      cellBgClass(cell.review_status),
                      // 보고 없는 셀: 옅은 회색 + 점선 border로 구분
                      isVirtual && cell.review_status === null && 'bg-surface-muted/40',
                    )}
                    title={isVirtual ? '보고 없음 (가상 review)' : undefined}
                  >
                    <select
                      value={cell.review_status ?? ''}
                      onChange={(e) => onStatusChange({ workLogId: cell.work_log_id, userEmail: u.email, date: d }, e.target.value as ReviewStatus | '')}
                      disabled={busy}
                      className={cn(
                        'h-6 text-[11px] rounded px-1 w-full cursor-pointer',
                        // 가상 셀은 점선 border, 보고 있는 셀은 실선
                        isVirtual ? 'border border-dashed' : 'border',
                        statusBadgeClass(cell.review_status),
                        busy && 'opacity-50 cursor-wait',
                      )}
                      title={statusLabel(cell.review_status) + (isVirtual ? ' (보고 없음)' : '')}
                    >
                      {/* default 라벨 분기 (v1.74.12 — 이모지로 구분):
                          - work_log 없음 + review 없음 → '❌ 미보고'
                          - work_log 있음 + review 없음 → '⭕ 상신'
                          - review 있음 → '-' (드롭다운 펼친 상태 라벨, 실제 표시는 review 텍스트) */}
                      <option value="">
                        {cell.review_status === null ? (isVirtual ? '❌ 미보고' : '⭕ 상신') : '-'}
                      </option>
                      <option value="checked">✓ 체크</option>
                      <option value="missing">⚠ EW미상신</option>
                      <option value="wrong">✗ EW오상신</option>
                    </select>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
