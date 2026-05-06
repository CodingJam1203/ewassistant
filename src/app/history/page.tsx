'use client'

import { useState, useEffect } from 'react'
import { Copy, Check, RefreshCw, Pencil, Trash2 } from 'lucide-react'
import { format } from 'date-fns'
import { getKstTodayDateString } from '@/lib/utils/date'
import WorkLogModal from '@/components/WorkLogModal'
import Pagination from '@/components/Pagination'
import type { WorkLog } from '@/types/work-log'

interface OrgTeam { id: string; division_id: string; name: string }
interface OrgDivision { id: string; name: string; teams: OrgTeam[] }

function CopyCell({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      alert('복사 실패. 브라우저 권한을 확인해주세요.')
    }
  }
  return (
    <button
      onClick={handleCopy}
      title="복사하기"
      className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors whitespace-nowrap
        ${copied ? 'bg-green-100 text-green-700' : 'bg-blue-50 text-blue-700 hover:bg-blue-100'}`}
    >
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
      {copied ? '완료' : '복사'}
    </button>
  )
}

function formatInterval(str: string) {
  if (!str) return '00:00'
  if (str.includes(':')) {
    const parts = str.split(':')
    return `${parts[0].padStart(2, '0')}:${parts[1].padStart(2, '0')}`
  }
  return str
}

/** 보고 상태 — timeline 마지막 kind로 판정 */
function getReportStatus(log: WorkLog): {
  kind: 'check_in_only' | 'completed'
  hasAdvanceReport: boolean
} {
  const tl = log.work_location_timeline
  const last = Array.isArray(tl) && tl.length > 0 ? tl[tl.length - 1] : null
  const kind: 'check_in_only' | 'completed' =
    last && last.kind === 'expected_checkout' ? 'check_in_only' : 'completed'
  const hasAdvanceReport =
    log.attendance_record_type === '출근보고 진행 (주말출근, 휴가 포함)' &&
    !!log.expected_start_date
  return { kind, hasAdvanceReport }
}

function StatusBadge({ log }: { log: WorkLog }) {
  const { kind, hasAdvanceReport } = getReportStatus(log)
  return (
    <div className="flex flex-col items-start gap-0.5">
      {kind === 'check_in_only' ? (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-700">
          🕒 출근만 작성됨
        </span>
      ) : (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-700">
          ✓ 퇴근 완료
        </span>
      )}
      {hasAdvanceReport && (
        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-50 text-blue-700">
          + 사전 출근보고
        </span>
      )}
    </div>
  )
}

export default function HistoryPage() {
  const [logs, setLogs] = useState<WorkLog[]>([])
  const [loading, setLoading] = useState(true)
  const [isAdmin, setIsAdmin] = useState(false)
  const [org, setOrg] = useState<OrgDivision[]>([])
  const [filterMine, setFilterMine] = useState(false)
  const [filterDivision, setFilterDivision] = useState('')
  const [filterTeam, setFilterTeam] = useState('')
  const [filterName, setFilterName] = useState('')
  const [filterDate, setFilterDate] = useState('')
  const [editingLog, setEditingLog] = useState<WorkLog | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  // ─── 페이지네이션 ────────────────────────────────────────────
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)

  // 관리자 여부 확인 + 조직 목록 + 내 프로필 기본값 — 병렬 호출
  useEffect(() => {
    Promise.all([
      fetch('/api/admin/check').then(r => r.json()).catch(() => ({ isAdmin: false })),
      fetch('/api/org').then(r => r.ok ? r.json() : []).catch(() => []),
      fetch('/api/auth/profile').then(r => r.ok ? r.json() : null).catch(() => null),
    ]).then(([adminData, orgData, profile]) => {
      setIsAdmin(adminData?.isAdmin ?? false)
      setOrg(orgData as OrgDivision[])
      if (profile?.division) setFilterDivision(profile.division)
      if (profile?.team) setFilterTeam(profile.team)
    })
  }, [])

  // 본부 변경 시 팀 초기화
  const handleDivisionChange = (div: string) => {
    setFilterDivision(div)
    setFilterTeam('')
  }

  const availableTeams = org.find(d => d.name === filterDivision)?.teams ?? []

  const fetchLogs = async () => {
    setLoading(true)
    try {
      const url = new URL('/api/work-logs', window.location.origin)
      if (filterMine) {
        url.searchParams.append('mine', 'true')
      } else {
        if (filterDivision) url.searchParams.append('division', filterDivision)
        if (filterTeam) url.searchParams.append('team', filterTeam)
      }
      url.searchParams.append('limit', '200')
      const res = await fetch(url.toString())
      const data = await res.json()
      if (res.ok) setLogs(data)
      else console.error('Failed to fetch logs:', data.error)
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchLogs() }, [filterMine, filterDivision, filterTeam]) // eslint-disable-line react-hooks/exhaustive-deps

  const filteredLogs = logs.filter(log => {
    if (filterName && !log.name.includes(filterName)) return false
    if (filterDate && log.leave_date !== filterDate) return false
    return true
  })

  // 필터/리스트 변경 시 1페이지로 리셋
  useEffect(() => { setPage(1) }, [
    filterMine, filterDivision, filterTeam, filterName, filterDate, logs.length,
  ])

  const pageStart = (page - 1) * pageSize
  const pagedLogs = filteredLogs.slice(pageStart, pageStart + pageSize)

  const handleDelete = async (id: string) => {
    if (!confirm('이 기록을 삭제하시겠습니까?')) return
    setDeletingId(id)
    try {
      const res = await fetch(`/api/work-logs/${id}`, { method: 'DELETE' })
      const data = await res.json()
      if (res.ok) {
        setLogs(prev => prev.filter(l => l.id !== id))
      } else {
        alert('삭제 실패: ' + data.error)
      }
    } catch {
      alert('오류가 발생했습니다.')
    } finally {
      setDeletingId(null)
    }
  }

  const handleEditSuccess = () => {
    setEditingLog(null)
    fetchLogs()  // 수정 후 목록 갱신
  }

  return (
    <div className="space-y-6">
      {/* 수정 모달 (관리자) — WorkLogModal 풀 폼 */}
      {editingLog && isAdmin && (
        <WorkLogModal
          date={editingLog.leave_date}
          userName={editingLog.name}
          editingLog={editingLog}
          onClose={() => setEditingLog(null)}
          onSuccess={handleEditSuccess}
        />
      )}

      <div className="sm:flex sm:items-center sm:justify-between">
        <h2 className="text-2xl font-bold leading-7 text-gray-900">전체 제출 내역</h2>
      </div>

      {/* 필터 */}
      <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-200 flex flex-wrap gap-3 items-end">
        {/* 본부 필터 */}
        <div>
          <label className="block text-xs font-medium text-gray-700">본부</label>
          <select
            className="mt-1 block rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-sm border px-3 py-2 bg-white"
            value={filterDivision}
            onChange={e => handleDivisionChange(e.target.value)}
            disabled={filterMine}
          >
            <option value="">전체</option>
            {org.map(d => (
              <option key={d.id} value={d.name}>{d.name}</option>
            ))}
          </select>
        </div>
        {/* 팀 필터 */}
        <div>
          <label className="block text-xs font-medium text-gray-700">팀</label>
          <select
            className="mt-1 block rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-sm border px-3 py-2 bg-white disabled:bg-gray-50 disabled:text-gray-400"
            value={filterTeam}
            onChange={e => setFilterTeam(e.target.value)}
            disabled={filterMine || !filterDivision || availableTeams.length === 0}
          >
            <option value="">전체 팀</option>
            {availableTeams.map(t => (
              <option key={t.id} value={t.name}>{t.name}</option>
            ))}
          </select>
        </div>
        {/* 날짜 필터 */}
        <div>
          <label className="block text-xs font-medium text-gray-700">날짜</label>
          <input
            type="date"
            className="mt-1 block rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-sm border px-3 py-2"
            value={filterDate}
            onChange={e => setFilterDate(e.target.value)}
          />
        </div>
        {/* 이름 검색 */}
        <div>
          <label className="block text-xs font-medium text-gray-700">이름 검색</label>
          <input
            type="text"
            placeholder="이름 입력..."
            className="mt-1 block rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-sm border px-3 py-2"
            value={filterName}
            onChange={e => setFilterName(e.target.value)}
          />
        </div>
        {/* 내 기록만 */}
        <div className="flex items-center gap-2 pb-2">
          <input
            id="filterMine"
            type="checkbox"
            className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            checked={filterMine}
            onChange={e => setFilterMine(e.target.checked)}
          />
          <label htmlFor="filterMine" className="text-sm text-gray-900">내 기록만</label>
        </div>
        <div className="flex items-center gap-3 ml-auto pb-2">
          <button
            onClick={() => setFilterDate(getKstTodayDateString())}
            className="text-sm text-blue-600 hover:text-blue-800 font-medium"
          >
            오늘
          </button>
          <button
            onClick={fetchLogs}
            className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800"
          >
            <RefreshCw className="h-4 w-4" /> 새로고침
          </button>
        </div>
      </div>

      {loading ? (
        <div className="space-y-2 mt-4">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-10 bg-gray-100 dark:bg-gray-700 rounded animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase whitespace-nowrap">복사</th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase whitespace-nowrap">상태</th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase whitespace-nowrap">근무일</th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase whitespace-nowrap">이름</th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase whitespace-nowrap">근무장소</th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase whitespace-nowrap">출퇴근</th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase whitespace-nowrap">실근무/휴게</th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase whitespace-nowrap">EW</th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase whitespace-nowrap">유형</th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase whitespace-nowrap">제출일시</th>
                  {isAdmin && (
                    <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase whitespace-nowrap">수정/삭제</th>
                  )}
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-100">
                {pagedLogs.map(log => (
                  <tr key={log.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-3 py-3 text-center">
                      <CopyCell text={log.copy_text} />
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap">
                      <StatusBadge log={log} />
                    </td>
                    <td className="px-3 py-3 font-medium text-gray-900 whitespace-nowrap">
                      {log.leave_date}
                    </td>
                    <td className="px-3 py-3 text-gray-700 whitespace-nowrap">
                      {log.name}
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700">
                        {log.work_location}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-gray-700 whitespace-nowrap">
                      {log.start_time.substring(0, 5)} ~ {log.end_time.substring(0, 5)}
                      {getReportStatus(log).kind === 'check_in_only' && (
                        <span className="ml-1 text-xs text-amber-600 font-medium">(예정)</span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-gray-700 whitespace-nowrap">
                      {formatInterval(log.actual_work_time)}
                      <span className="text-gray-400 mx-1">/</span>
                      {formatInterval(log.break_time)}
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap">
                      <span className="font-bold text-blue-600">{log.ew_value}</span>
                    </td>
                    <td className="px-3 py-3 text-gray-500 whitespace-nowrap text-xs">
                      {log.work_type_label}
                    </td>
                    <td className="px-3 py-3 text-gray-400 whitespace-nowrap text-xs">
                      <div>{format(new Date(log.created_at), 'MM/dd HH:mm')}</div>
                      {log.updated_by && log.updated_at && (
                        <div className="text-xs text-amber-500">수정 {format(new Date(log.updated_at), 'MM/dd HH:mm')}</div>
                      )}
                    </td>
                    {isAdmin && (
                      <td className="px-3 py-3 text-center whitespace-nowrap">
                        <div className="flex items-center justify-center gap-2">
                          <button
                            onClick={() => setEditingLog(log)}
                            className="text-gray-400 hover:text-blue-600 transition-colors"
                            title="수정"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => handleDelete(log.id)}
                            className="text-gray-400 hover:text-red-600 transition-colors"
                            title="삭제"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>

            {filteredLogs.length === 0 && (
              <div className="py-16 text-center text-sm text-gray-500">제출 내역이 없습니다.</div>
            )}
          </div>

          {filteredLogs.length > 0 && (
            <Pagination
              totalCount={filteredLogs.length}
              page={page}
              pageSize={pageSize}
              onPageChange={setPage}
              onPageSizeChange={setPageSize}
            />
          )}
        </div>
      )}
    </div>
  )
}
