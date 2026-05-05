'use client'

import { useState, useEffect } from 'react'
import { Copy, Check, RefreshCw, Pencil, Trash2 } from 'lucide-react'
import { format } from 'date-fns'
import EditLogModal from '@/components/EditLogModal'
import type { WorkLog } from '@/types/work-log'

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

function shortType(label: string | null) {
  if (!label) return '-'
  if (label.includes('스킵')) return '스킵'
  if (label.includes('출근보고')) return '출근보고'
  return label
}

export default function MyLogsPage() {
  const [logs, setLogs] = useState<WorkLog[]>([])
  const [loading, setLoading] = useState(true)
  const [filterDate, setFilterDate] = useState('')
  const [editingLog, setEditingLog] = useState<WorkLog | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const fetchLogs = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/work-logs?mine=true&limit=100')
      const data = await res.json()
      if (res.ok) setLogs(data)
      else console.error('Failed:', data.error)
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchLogs() }, [])

  const filtered = logs.filter(log => {
    if (filterDate && log.leave_date !== filterDate) return false
    return true
  })

  const handleDelete = async (id: string) => {
    if (!confirm('이 기록을 삭제하시겠습니까? 삭제 후 복구할 수 없습니다.')) return
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

  const handleSave = (updated: WorkLog) => {
    setLogs(prev => prev.map(l => l.id === updated.id ? { ...l, ...updated } : l))
    setEditingLog(null)
  }

  return (
    <div className="space-y-6">
      {editingLog && (
        <EditLogModal
          log={editingLog}
          onClose={() => setEditingLog(null)}
          onSave={handleSave}
        />
      )}

      <div className="sm:flex sm:items-center sm:justify-between gap-4">
        <h2 className="text-2xl font-bold leading-7 text-gray-900">내 제출 내역</h2>
        <div className="flex items-center gap-3 mt-2 sm:mt-0">
          <input
            type="date"
            value={filterDate}
            onChange={e => setFilterDate(e.target.value)}
            className="rounded-md border border-gray-300 text-sm px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {filterDate && (
            <button onClick={() => setFilterDate('')} className="text-xs text-gray-500 hover:text-gray-700">
              초기화
            </button>
          )}
          <button
            onClick={fetchLogs}
            className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800"
          >
            <RefreshCw className="h-4 w-4" />
            새로고침
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
                  <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">복사</th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">제출일시</th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">근무일</th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">이름</th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">근무장소</th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">출퇴근</th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">실근무/휴게</th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">EW</th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">유형</th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">메모</th>
                  <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">수정/삭제</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-100">
                {filtered.map(log => (
                  <tr key={log.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-3 py-3 text-center">
                      <CopyCell text={log.copy_text} />
                    </td>
                    <td className="px-3 py-3 text-gray-500 whitespace-nowrap">
                      <div>{format(new Date(log.created_at), 'MM/dd HH:mm')}</div>
                      {/* updated_by가 있을 때만 수정 표시 */}
                      {log.updated_by && log.updated_at && (
                        <div className="text-xs text-amber-500">
                          수정 {format(new Date(log.updated_at), 'MM/dd HH:mm')}
                        </div>
                      )}
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
                    </td>
                    <td className="px-3 py-3 text-gray-700 whitespace-nowrap">
                      {formatInterval(log.actual_work_time)}
                      <span className="text-gray-400 mx-1">/</span>
                      {formatInterval(log.break_time)}
                      {log.break_reason && (
                        <span className="ml-1 text-xs text-gray-400">({log.break_reason})</span>
                      )}
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap">
                      <span className="font-bold text-blue-600">{log.ew_value}</span>
                    </td>
                    <td className="px-3 py-3 text-gray-500 whitespace-nowrap text-xs">
                      {log.work_type_label}
                      {log.attendance_record_type && (
                        <div className="text-gray-400">{shortType(log.attendance_record_type)}</div>
                      )}
                    </td>
                    <td className="px-3 py-3 text-gray-500 max-w-[180px]">
                      <span className="line-clamp-2 text-xs">{log.work_content || '-'}</span>
                    </td>
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
                          disabled={deletingId === log.id}
                          className="text-gray-400 hover:text-red-600 transition-colors disabled:opacity-40"
                          title="삭제"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {filtered.length === 0 && (
              <div className="py-16 text-center text-sm text-gray-500">
                {filterDate ? '해당 날짜의 제출 내역이 없습니다.' : '제출한 내역이 없습니다.'}
              </div>
            )}
          </div>

          {filtered.length > 0 && (
            <div className="px-4 py-3 border-t border-gray-100 text-xs text-gray-400">
              총 {filtered.length}건
            </div>
          )}
        </div>
      )}
    </div>
  )
}
                                                                                                                                                                                                                                                                                                                                                                                                                                                                              