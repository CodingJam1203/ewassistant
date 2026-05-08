'use client'

/**
 * 제출 이력 테이블 — work_log_submissions 기반.
 *
 * 두 가지 모드:
 *   - mode='raw'   : 시간순 모든 제출 row (수정·재제출 누적)
 *   - mode='final' : 일자/사용자별 출근/퇴근 각각 최신 1건 (일자별 최종)
 *
 * 컬럼은 모든 셀을 RAW 그대로 펼침 — 가로 스크롤 허용.
 *
 * 스타일은 DESIGN.md 기준 — 색상은 디자인 토큰만, 컴포넌트는 ui/* 사용.
 */

import { useEffect, useMemo, useState } from 'react'
import { format } from 'date-fns'
import { Pencil, Copy, Check } from 'lucide-react'
import Pagination from '@/components/Pagination'
import {
  Badge,
  Button,
  FilterBar,
  Input,
  Select,
  TableContainer,
  Table,
  Th,
  Td,
  TR_HOVER,
} from '@/components/ui'
import type { BadgeVariant } from '@/components/ui'
import { cn } from '@/lib/utils/cn'

function CopyButton({ text }: { text: string | null }) {
  const [copied, setCopied] = useState(false)
  if (!text) return <span className="text-text-disabled">-</span>
  const handle = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      alert('복사 실패. 브라우저 권한을 확인해주세요.')
    }
  }
  return (
    <Button
      variant={copied ? 'secondary' : 'ghost'}
      size="sm"
      onClick={handle}
      className={cn('!h-7 !px-2 !text-[11px]', copied && '!text-success-text !bg-success-bg !border-success-border')}
      title="EW 복사 문구 복사"
    >
      {copied ? <Check className="h-3 w-3" aria-hidden /> : <Copy className="h-3 w-3" aria-hidden />}
      {copied ? '완료' : '복사'}
    </Button>
  )
}

export interface ChangedFieldRow {
  kind?: 'check_in' | 'check_out'
  label: string
  before: string
  after: string
}

export interface SubmissionRow {
  id: string
  user_email: string
  name: string | null
  division: string | null
  team: string | null

  report_type: 'check_in' | 'check_out' | 'check_in_update' | 'check_out_update'
  target_date: string
  submitted_at: string

  work_log_id: string | null

  start_time: string | null
  end_time: string | null
  break_time: string | null
  actual_work_time: string | null
  work_location: string | null
  work_content: string | null
  ew_value: string | null
  copy_text: string | null
  late_or_attendance_status: string | null
  previous_report_time: string | null
  current_report_time: string | null
  late_reason: string | null
  break_reason: string | null

  expected_start_date: string | null
  expected_work_time: string | null
  expected_work_location: string | null
  /** 출근 timeline 마지막 항목(expected_checkout)에서 퇴근예정시각 추출용 */
  expected_work_location_timeline?: Array<{ kind?: string; startTime?: string }> | null
  /** 사전 보고 있는 상태에서 출근만 누른 경우 actual timeline (퇴근예정시각 fallback용) */
  work_location_timeline?: Array<{ kind?: string; startTime?: string }> | null

  changed_fields: ChangedFieldRow[] | null

  work_type_label: string | null
  attendance_record_type: string | null
}

/** expected_work_location_timeline의 마지막 expected_checkout startTime → 퇴근예정시각 */
function extractExpectedCheckoutTime(
  tl: Array<{ kind?: string; startTime?: string }> | null | undefined
): string | null {
  if (!Array.isArray(tl) || tl.length === 0) return null
  const last = tl[tl.length - 1]
  if (last?.kind === 'expected_checkout' || last?.kind === 'checkout') {
    return last.startTime ?? null
  }
  return null
}

/**
 * 보고유형 필터 옵션 — 출근/퇴근 family 기준 (수정 row도 같은 family에 포함).
 *  - 'check_in'  : check_in + check_in_update
 *  - 'check_out' : check_out + check_out_update
 */
const REPORT_TYPE_OPTIONS: Array<{ value: '' | 'check_in' | 'check_out'; label: string }> = [
  { value: '',          label: '전체 보고유형' },
  { value: 'check_in',  label: '출근보고' },
  { value: 'check_out', label: '퇴근보고' },
]

function reportTypeLabel(t: SubmissionRow['report_type']): string {
  switch (t) {
    case 'check_in':         return '출근보고'
    case 'check_out':        return '퇴근보고'
    case 'check_in_update':  return '출근보고 수정'
    case 'check_out_update': return '퇴근보고 수정'
  }
}

function reportTypeBadge(t: SubmissionRow['report_type']): BadgeVariant {
  switch (t) {
    case 'check_in':         return 'success'
    case 'check_out':        return 'info'
    case 'check_in_update':  return 'warning'
    case 'check_out_update': return 'warning'
  }
}

function fmtTime(s: string | null): string {
  if (!s) return '-'
  if (s.includes(':')) return s.substring(0, 5)
  return s
}

function fmtInterval(s: string | null): string {
  if (!s) return '-'
  if (s.includes(':')) {
    const parts = s.split(':')
    return `${parts[0].padStart(2, '0')}:${parts[1].padStart(2, '0')}`
  }
  return s
}

/** 일자별 최종 추출 — (user_email, target_date, family) 별 가장 최신 row 1건 */
function pickLatestPerDay(rows: SubmissionRow[]): SubmissionRow[] {
  const map = new Map<string, SubmissionRow>()
  for (const r of rows) {
    const family = r.report_type.startsWith('check_in') ? 'in' : 'out'
    const key = `${r.user_email}__${r.target_date}__${family}`
    const existing = map.get(key)
    if (!existing || existing.submitted_at < r.submitted_at) {
      map.set(key, r)
    }
  }
  // 정렬: target_date desc, family — 한 날 안에서는 퇴근(out)이 위, 출근(in)이 아래
  return Array.from(map.values()).sort((a, b) => {
    if (a.target_date !== b.target_date) return a.target_date < b.target_date ? 1 : -1
    const fa = a.report_type.startsWith('check_out') ? 0 : 1
    const fb = b.report_type.startsWith('check_out') ? 0 : 1
    return fa - fb
  })
}

export interface SubmissionsRawTableProps {
  endpoint?: string
  mine?: boolean
  extraQuery?: Record<string, string>
  /**
   * 수정 버튼 클릭 시 호출.
   *  - workLogId : 원본 work_logs.id
   *  - scope     : 'check_in' (출근보고 영역) / 'check_out' (퇴근보고 영역)
   *                row의 보고유형으로 자동 판정해서 전달됨.
   */
  onEditWorkLog?: (workLogId: string, scope: 'check_in' | 'check_out') => void
  allowOrgFilter?: boolean
  /**
   * 'raw'  : 모든 제출 row 시간순
   * 'final': 일자/사용자별 출근/퇴근 최신 1건
   */
  mode?: 'raw' | 'final'
}

export default function SubmissionsRawTable({
  endpoint = '/api/work-log-submissions',
  mine,
  extraQuery,
  onEditWorkLog,
  allowOrgFilter,
  mode = 'raw',
}: SubmissionsRawTableProps) {
  const [rows, setRows] = useState<SubmissionRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [reportType, setReportType] = useState<'' | 'check_in' | 'check_out'>('')
  const [updatedOnly, setUpdatedOnly] = useState(false)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [nameQuery, setNameQuery] = useState('')

  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)

  const fetchRows = async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (mine) params.set('mine', 'true')
      if (mode === 'raw' && updatedOnly) {
        params.set('updated_only', 'true')
      }
      if (from) params.set('from', from)
      if (to)   params.set('to',   to)
      if (extraQuery) {
        for (const [k, v] of Object.entries(extraQuery)) {
          if (v) params.set(k, v)
        }
      }
      params.set('limit', '1000')

      const res = await fetch(`${endpoint}?${params}`)
      const json = await res.json()
      if (!res.ok) {
        setError(json.error ?? '조회 실패')
        return
      }
      setRows(json.rows ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : '네트워크 오류')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchRows() }, [reportType, updatedOnly, from, to, mine, mode, JSON.stringify(extraQuery)]) // eslint-disable-line react-hooks/exhaustive-deps

  const processedRows = useMemo(() => {
    let r = rows
    if (mode === 'final') r = pickLatestPerDay(r)
    if (reportType) {
      r = r.filter(x => x.report_type.startsWith(reportType))
    }
    if (nameQuery) {
      const q = nameQuery.toLowerCase()
      r = r.filter(x => (x.name ?? '').toLowerCase().includes(q))
    }
    return r
  }, [rows, mode, nameQuery, reportType])

  useEffect(() => { setPage(1) }, [processedRows.length])
  const pageStart = (page - 1) * pageSize
  const pagedRows = processedRows.slice(pageStart, pageStart + pageSize)

  return (
    <div className="space-y-3">
      {/* 필터 바 */}
      <FilterBar>
        <FilterBar.Field label="보고유형">
          <Select
            selectSize="sm"
            value={reportType}
            onChange={e => { setReportType(e.target.value as typeof reportType); setUpdatedOnly(false) }}
            className="min-w-[140px]"
          >
            {REPORT_TYPE_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </Select>
        </FilterBar.Field>

        {mode === 'raw' && (
          <FilterBar.Field label="수정 이력만">
            <label className="inline-flex items-center gap-2 h-9 px-3 rounded-[10px] border border-border-strong bg-surface cursor-pointer">
              <input
                type="checkbox"
                checked={updatedOnly}
                onChange={e => { setUpdatedOnly(e.target.checked); if (e.target.checked) setReportType('') }}
                className="h-4 w-4 rounded border-border-strong text-primary-600 focus:ring-primary-500"
              />
              <span className="text-[13px] text-text-primary">수정만 보기</span>
            </label>
          </FilterBar.Field>
        )}

        <FilterBar.Field label="대상일 시작">
          <Input type="date" inputSize="sm" value={from} onChange={e => setFrom(e.target.value)} className="min-w-[140px]" />
        </FilterBar.Field>
        <FilterBar.Field label="대상일 종료">
          <Input type="date" inputSize="sm" value={to} onChange={e => setTo(e.target.value)} className="min-w-[140px]" />
        </FilterBar.Field>

        {allowOrgFilter && (
          <FilterBar.Field label="이름 검색">
            <Input
              type="text"
              inputSize="sm"
              value={nameQuery}
              onChange={e => setNameQuery(e.target.value)}
              placeholder="이름 일부"
              className="w-36"
            />
          </FilterBar.Field>
        )}

        <div className="ml-auto self-end text-[12px] text-text-secondary tabular-nums">
          <span className="font-semibold text-text-primary">{processedRows.length}</span>
          {' 건 ('}
          {mode === 'final' ? '일자별 최종' : 'RAW 누적'}
          {')'}
        </div>
      </FilterBar>

      {error && (
        <div className="rounded-[10px] bg-danger-bg border border-danger-border p-3 text-[13px] text-danger-text">
          {error}
        </div>
      )}

      {loading ? (
        <div className="space-y-1">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-10 bg-surface-muted rounded-[10px] animate-pulse" />
          ))}
        </div>
      ) : processedRows.length === 0 ? (
        <div className="bg-surface rounded-2xl border border-border p-12 text-center text-sm text-text-muted">
          제출 이력이 없습니다.
        </div>
      ) : (
        <TableContainer>
          <Table>
            <thead>
              <tr>
                <Th className="text-center">복사</Th>
                <Th className="text-center">수정</Th>
                <Th>보고유형</Th>
                <Th>대상일</Th>
                <Th>제출일시</Th>
                <Th>이름</Th>
                <Th>시작</Th>
                <Th>종료</Th>
                <Th>장소</Th>
                <Th>휴게</Th>
                <Th>실근무</Th>
                <Th>EW</Th>
                <Th>근무내용</Th>
                <Th>변경 필드</Th>
              </tr>
            </thead>
            <tbody>
              {pagedRows.map(r => {
                const isUpdate   = r.report_type.endsWith('_update')
                const isCheckOut = r.report_type === 'check_out' || r.report_type === 'check_out_update'
                const dash = <span className="text-text-disabled">-</span>

                const startVal = isCheckOut
                  ? fmtTime(r.start_time)
                  : fmtTime(r.start_time ?? r.expected_work_time)
                const endVal = isCheckOut
                  ? fmtTime(r.end_time)
                  : fmtTime(
                      r.end_time
                      ?? extractExpectedCheckoutTime(r.work_location_timeline)
                      ?? extractExpectedCheckoutTime(r.expected_work_location_timeline)
                    )
                const locVal = isCheckOut
                  ? (r.work_location ?? '-')
                  : (r.work_location ?? r.expected_work_location ?? '-')

                return (
                  <tr key={r.id} className={TR_HOVER}>
                    <Td className="text-center">
                      {isCheckOut ? <CopyButton text={r.copy_text} /> : dash}
                    </Td>
                    <Td className="text-center">
                      {r.work_log_id && onEditWorkLog ? (
                        <button
                          onClick={() => onEditWorkLog(r.work_log_id!, isCheckOut ? 'check_out' : 'check_in')}
                          className="text-text-muted hover:text-primary-600 transition-colors"
                          title={isCheckOut ? '퇴근보고 수정' : '출근보고 수정'}
                          aria-label={isCheckOut ? '퇴근보고 수정' : '출근보고 수정'}
                        >
                          <Pencil className="h-3.5 w-3.5 inline" aria-hidden />
                        </button>
                      ) : dash}
                    </Td>
                    <Td>
                      <Badge variant={reportTypeBadge(r.report_type)} className="!h-5 !px-2 !text-[10px]">
                        {reportTypeLabel(r.report_type)}
                      </Badge>
                    </Td>
                    <Td className="font-medium text-text-primary tabular-nums">{r.target_date}</Td>
                    <Td className="text-text-muted tabular-nums">{format(new Date(r.submitted_at), 'MM/dd HH:mm')}</Td>
                    <Td>
                      <div className="text-text-primary">{r.name ?? '-'}</div>
                      <div className="text-[10px] text-text-muted">
                        {(r.division ?? '-') + ' / ' + (r.team ?? '-')}
                      </div>
                    </Td>
                    <Td numeric>{startVal}</Td>
                    <Td numeric>{endVal}</Td>
                    <Td>{locVal}</Td>
                    <Td numeric>{isCheckOut ? fmtInterval(r.break_time) : dash}</Td>
                    <Td numeric>{isCheckOut ? fmtInterval(r.actual_work_time) : dash}</Td>
                    <Td className="font-bold text-primary-600 tabular-nums">{isCheckOut ? (r.ew_value ?? '-') : dash}</Td>
                    <Td className="max-w-[200px] truncate text-text-secondary" title={r.work_content ?? ''}>
                      {isCheckOut ? (r.work_content ?? '-') : dash}
                    </Td>
                    <Td className="max-w-[260px]">
                      {isUpdate && r.changed_fields && r.changed_fields.length > 0 ? (
                        <ul className="space-y-0.5 list-none">
                          {r.changed_fields.map((cf, i) => (
                            <li key={i} className="text-[10px] text-text-secondary truncate">
                              <span className="font-semibold">{cf.label}:</span> {cf.before} → {cf.after}
                            </li>
                          ))}
                        </ul>
                      ) : dash}
                    </Td>
                  </tr>
                )
              })}
            </tbody>
          </Table>
          <Pagination
            totalCount={processedRows.length}
            page={page}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
          />
        </TableContainer>
      )}
    </div>
  )
}
