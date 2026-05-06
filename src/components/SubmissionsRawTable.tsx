'use client'

/**
 * RAW 제출 내역 테이블 — work_log_submissions 시간순 펼치기.
 *
 * /my-logs, /history의 RAW 탭에서 공통 사용.
 * 컬럼은 가능한 한 한 화면에 다 펼침 — 가로 스크롤 허용.
 *
 * 보고 유형 4종:
 *   check_in         (출근보고)
 *   check_out        (퇴근보고)
 *   check_in_update  (출근보고 수정)
 *   check_out_update (퇴근보고 수정)
 */

import { useEffect, useMemo, useState } from 'react'
import { format } from 'date-fns'
import { Pencil } from 'lucide-react'
import Pagination from '@/components/Pagination'

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
  target_date: string  // YYYY-MM-DD
  submitted_at: string

  work_log_id: string | null

  // 퇴근 영역
  start_time: string | null
  end_time: string | null
  break_time: string | null
  actual_work_time: string | null
  work_location: string | null
  work_content: string | null
  ew_value: string | null
  copy_text: string | null
  late_or_attendance_status: string | null

  // 출근 영역
  expected_start_date: string | null
  expected_work_time: string | null
  expected_work_location: string | null

  // 수정
  changed_fields: ChangedFieldRow[] | null

  // 메타
  work_type_label: string | null
  attendance_record_type: string | null
}

const REPORT_TYPE_OPTIONS: Array<{ value: ''; label: string } | { value: SubmissionRow['report_type']; label: string }> = [
  { value: '',                label: '전체 보고유형' },
  { value: 'check_in',        label: '출근보고' },
  { value: 'check_out',       label: '퇴근보고' },
  { value: 'check_in_update', label: '출근보고 수정' },
  { value: 'check_out_update',label: '퇴근보고 수정' },
]

function reportTypeLabel(t: SubmissionRow['report_type']): string {
  switch (t) {
    case 'check_in':         return '출근보고'
    case 'check_out':        return '퇴근보고'
    case 'check_in_update':  return '출근보고 수정'
    case 'check_out_update': return '퇴근보고 수정'
  }
}

function reportTypeBadgeClass(t: SubmissionRow['report_type']): string {
  switch (t) {
    case 'check_in':         return 'bg-green-100 text-green-700'
    case 'check_out':        return 'bg-blue-100 text-blue-700'
    case 'check_in_update':  return 'bg-amber-100 text-amber-700'
    case 'check_out_update': return 'bg-orange-100 text-orange-700'
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

export interface SubmissionsRawTableProps {
  /** API 엔드포인트 — 보통 '/api/work-log-submissions' */
  endpoint?: string
  /** 본인 한정 조회 여부 */
  mine?: boolean
  /** 외부에서 추가 필터를 넣고 싶으면 (queryString 일부) */
  extraQuery?: Record<string, string>
  /** 수정 핸들러 — work_log_id를 받아서 해당 row를 편집 모드로 */
  onEditWorkLog?: (workLogId: string) => void
  /** 본부 필터 가능한지 (admin/leader) */
  allowOrgFilter?: boolean
}

export default function SubmissionsRawTable({
  endpoint = '/api/work-log-submissions',
  mine,
  extraQuery,
  onEditWorkLog,
  allowOrgFilter,
}: SubmissionsRawTableProps) {
  const [rows, setRows] = useState<SubmissionRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // 필터
  const [reportType, setReportType] = useState<'' | SubmissionRow['report_type']>('')
  const [updatedOnly, setUpdatedOnly] = useState(false)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [nameQuery, setNameQuery] = useState('')

  // 페이지네이션
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)

  // ─── fetch ─────────────────────────────────────────────────────
  const fetchRows = async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (mine) params.set('mine', 'true')
      if (reportType) params.set('report_type', reportType)
      else if (updatedOnly) params.set('updated_only', 'true')
      if (from) params.set('from', from)
      if (to)   params.set('to',   to)
      if (extraQuery) {
        for (const [k, v] of Object.entries(extraQuery)) {
          if (v) params.set(k, v)
        }
      }
      params.set('limit', '500')

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

  useEffect(() => { fetchRows() }, [reportType, updatedOnly, from, to, mine, JSON.stringify(extraQuery)]) // eslint-disable-line react-hooks/exhaustive-deps

  // ─── 클라이언트 측 이름 필터 ───────────────────────────────
  const filteredRows = useMemo(() => {
    if (!nameQuery) return rows
    const q = nameQuery.toLowerCase()
    return rows.filter(r => (r.name ?? '').toLowerCase().includes(q))
  }, [rows, nameQuery])

  useEffect(() => { setPage(1) }, [filteredRows.length])
  const pageStart = (page - 1) * pageSize
  const pagedRows = filteredRows.slice(pageStart, pageStart + pageSize)

  return (
    <div className="space-y-3">
      {/* 필터 바 */}
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 flex flex-wrap gap-2 items-end">
        <div>
          <label className="block text-[11px] font-medium text-gray-600 mb-0.5">보고유형</label>
          <select
            value={reportType}
            onChange={e => { setReportType(e.target.value as typeof reportType); setUpdatedOnly(false) }}
            className="border border-gray-300 rounded px-2 py-1 text-xs bg-white"
          >
            {REPORT_TYPE_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-[11px] font-medium text-gray-600 mb-0.5">수정 이력만</label>
          <label className="flex items-center gap-1 h-[26px]">
            <input
              type="checkbox"
              checked={updatedOnly}
              onChange={e => { setUpdatedOnly(e.target.checked); if (e.target.checked) setReportType('') }}
              className="h-3.5 w-3.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <span className="text-xs text-gray-700">수정만 보기</span>
          </label>
        </div>

        <div>
          <label className="block text-[11px] font-medium text-gray-600 mb-0.5">대상일 시작</label>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)}
            className="border border-gray-300 rounded px-2 py-1 text-xs" />
        </div>
        <div>
          <label className="block text-[11px] font-medium text-gray-600 mb-0.5">대상일 종료</label>
          <input type="date" value={to} onChange={e => setTo(e.target.value)}
            className="border border-gray-300 rounded px-2 py-1 text-xs" />
        </div>

        {allowOrgFilter && (
          <div>
            <label className="block text-[11px] font-medium text-gray-600 mb-0.5">이름 검색</label>
            <input
              type="text" value={nameQuery} onChange={e => setNameQuery(e.target.value)}
              placeholder="이름 일부"
              className="border border-gray-300 rounded px-2 py-1 text-xs w-32" />
          </div>
        )}

        <div className="ml-auto text-xs text-gray-500 flex items-end h-[26px]">
          {filteredRows.length}건
        </div>
      </div>

      {error && (
        <div className="rounded bg-red-50 border border-red-200 p-2 text-xs text-red-700">{error}</div>
      )}

      {loading ? (
        <div className="space-y-1">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-9 bg-gray-100 rounded animate-pulse" />
          ))}
        </div>
      ) : filteredRows.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-12 text-center text-sm text-gray-500">
          제출 이력이 없습니다.
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-xs">
              <thead className="bg-gray-50">
                <tr>
                  <Th>보고유형</Th>
                  <Th>제출일시</Th>
                  <Th>대상일</Th>
                  <Th>이름</Th>
                  <Th>본부/팀</Th>
                  <Th>유형</Th>
                  <Th>출근/퇴근</Th>
                  <Th>실근무</Th>
                  <Th>휴게</Th>
                  <Th>근무장소</Th>
                  <Th>EW</Th>
                  <Th>변경 필드</Th>
                  <Th>메모</Th>
                  <Th className="text-center">수정</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {pagedRows.map(r => {
                  const isCheckIn  = r.report_type === 'check_in' || r.report_type === 'check_in_update'
                  const isUpdate   = r.report_type.endsWith('_update')
                  return (
                    <tr key={r.id} className="hover:bg-gray-50">
                      <Td>
                        <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium ${reportTypeBadgeClass(r.report_type)}`}>
                          {reportTypeLabel(r.report_type)}
                        </span>
                      </Td>
                      <Td>{format(new Date(r.submitted_at), 'MM/dd HH:mm')}</Td>
                      <Td className="font-medium text-gray-900">{r.target_date}</Td>
                      <Td>{r.name ?? '-'}</Td>
                      <Td className="text-gray-500">
                        {r.division ?? '-'}<br/>
                        <span className="text-gray-400">{r.team ?? '-'}</span>
                      </Td>
                      <Td className="text-gray-500">{r.work_type_label ?? '-'}</Td>
                      <Td>
                        {isCheckIn ? (
                          // 출근 영역 — expected_*
                          <>
                            {fmtTime(r.expected_work_time)} ~
                            <br/><span className="text-[10px] text-gray-400">예정</span>
                          </>
                        ) : (
                          // 퇴근 영역 — start ~ end
                          <>{fmtTime(r.start_time)} ~ {fmtTime(r.end_time)}</>
                        )}
                      </Td>
                      <Td>{!isCheckIn ? fmtInterval(r.actual_work_time) : '-'}</Td>
                      <Td>{!isCheckIn ? fmtInterval(r.break_time) : '-'}</Td>
                      <Td>
                        {isCheckIn ? (r.expected_work_location ?? '-') : (r.work_location ?? '-')}
                      </Td>
                      <Td className="font-bold text-blue-600">{r.ew_value ?? '-'}</Td>
                      <Td className="max-w-[220px]">
                        {isUpdate && r.changed_fields && r.changed_fields.length > 0 ? (
                          <ul className="space-y-0.5 list-none">
                            {r.changed_fields.map((cf, i) => (
                              <li key={i} className="text-[10px] text-gray-600 truncate">
                                <span className="font-medium">{cf.label}:</span> {cf.before} → {cf.after}
                              </li>
                            ))}
                          </ul>
                        ) : '-'}
                      </Td>
                      <Td className="max-w-[160px] truncate text-gray-500">{r.work_content ?? '-'}</Td>
                      <Td className="text-center">
                        {r.work_log_id && onEditWorkLog ? (
                          <button
                            onClick={() => onEditWorkLog(r.work_log_id!)}
                            className="text-gray-400 hover:text-blue-600"
                            title="원본 work_log 수정"
                          >
                            <Pencil className="h-3.5 w-3.5 inline" />
                          </button>
                        ) : (
                          <span className="text-gray-300">-</span>
                        )}
                      </Td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <Pagination
            totalCount={filteredRows.length}
            page={page}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
          />
        </div>
      )}
    </div>
  )
}

function Th({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <th className={`px-2 py-2 text-left text-[10px] font-medium text-gray-600 uppercase tracking-wider whitespace-nowrap ${className}`}>
      {children}
    </th>
  )
}

function Td({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <td className={`px-2 py-1.5 align-top text-gray-700 whitespace-nowrap ${className}`}>{children}</td>
  )
}
