'use client'

import { useState, useEffect } from 'react'
import { X, Loader2 } from 'lucide-react'

interface WorkLog {
  id: string
  name: string
  work_type_label: string
  leave_date: string
  start_time: string
  end_time: string
  break_time: string
  break_reason: string | null
  work_content: string | null
  work_location: string
  ew_value: string
  copy_text: string
  [key: string]: unknown
}

interface EditLogModalProps {
  log: WorkLog
  onClose: () => void
  onSave: (updated: WorkLog) => void
}

const WORK_TYPES = ['기본근무 등록', '간주근로 등록', '공휴일근로 등록']
const WORK_LOCATIONS = ['사무실', '재택', '외근', '기타']
const BREAK_TIMES = ['00:00', '00:30', '01:00', '01:30', '02:00', '02:30', '03:00']

function buildTimeOpts(): string[] {
  const r: string[] = ['']
  for (let h = 6; h <= 23; h++) {
    r.push(`${String(h).padStart(2, '0')}:00`)
    if (h < 23) r.push(`${String(h).padStart(2, '0')}:30`)
  }
  return r
}
const TIME_OPTS = buildTimeOpts()
const WORK_TIME_OPTS = TIME_OPTS.filter(Boolean)  // 빈 값 제거 (출퇴근보고 시간 선택용)

function parseLocationForDropdown(workLocation: string) {
  if (WORK_LOCATIONS.slice(0, 3).includes(workLocation)) {
    return { locationType: workLocation, locationCustom: '' }
  }
  return { locationType: '기타', locationCustom: workLocation }
}

function parseBreakTime(dbBreakTime: string): string {
  if (!dbBreakTime) return '00:00'
  const parts = dbBreakTime.split(':')
  if (parts.length >= 2) {
    return `${parts[0].padStart(2, '0')}:${parts[1].padStart(2, '0')}`
  }
  return '00:00'
}

function isoToHHmm(iso: string | null): string {
  if (!iso) return ''
  try {
    const d = new Date(iso)
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  } catch { return '' }
}

export default function EditLogModal({ log, onClose, onSave }: EditLogModalProps) {
  const initialBreak = parseBreakTime(log.break_time)
  const { locationType, locationCustom } = parseLocationForDropdown(log.work_location)

  const [form, setForm] = useState({
    name: log.name,
    workTypeLabel: log.work_type_label,
    leaveDate: log.leave_date,
    startTime: log.start_time.substring(0, 5),
    endTime: log.end_time.substring(0, 5),
    breakTime: initialBreak,
    breakReason: log.break_reason ?? '',
    workContent: log.work_content ?? '',
    locationType,
    locationCustom,
  })

  const [actualCheckIn,  setActualCheckIn]  = useState('')
  const [actualCheckOut, setActualCheckOut] = useState('')
  const [loadingActual,  setLoadingActual]  = useState(true)
  const [dailyExists,    setDailyExists]    = useState(false)

  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'report' | 'checkin'>('report')

  const set = (field: string, value: string) =>
    setForm(prev => ({ ...prev, [field]: value }))

  const showBreakReason = (() => {
    const [h, m] = form.breakTime.split(':').map(Number)
    return h * 60 + m >= 30
  })()

  useEffect(() => {
    const load = async () => {
      setLoadingActual(true)
      try {
        const res = await fetch(`/api/team-status?date=${log.leave_date}`)
        if (res.ok) {
          const cards = await res.json()
          const mine = Array.isArray(cards) ? cards.find((c: { is_self: boolean }) => c.is_self) : null
          if (mine) {
            setDailyExists(true)
            setActualCheckIn(isoToHHmm(mine.checked_in_at))
            setActualCheckOut(isoToHHmm(mine.checked_out_at))
          }
        }
      } catch { /* ignore */ } finally {
        setLoadingActual(false)
      }
    }
    load()
  }, [log.leave_date])

  const handleSubmitReport = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!form.name.trim()) return setError('이름을 입력해주세요.')
    if (!form.workContent.trim()) return setError('근무내용을 입력해주세요.')
    if (!form.locationType) return setError('근무장소를 선택해주세요.')
    if (form.locationType === '기타' && !form.locationCustom.trim())
      return setError('근무장소(기타)를 입력해주세요.')

    const finalLocation = form.locationType === '기타' ? form.locationCustom.trim() : form.locationType

    setSaving(true)
    try {
      const res = await fetch(`/api/work-logs/${log.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name.trim(),
          workTypeLabel: form.workTypeLabel,
          leaveDate: form.leaveDate,
          startTime: form.startTime,
          endTime: form.endTime,
          breakTime: form.breakTime,
          breakReason: showBreakReason ? form.breakReason : '',
          workContent: form.workContent.trim(),
          workLocationType: form.locationType,
          workLocationCustom: form.locationCustom.trim(),
          workLocation: finalLocation,
        }),
      })
      const data = await res.json()
      if (!res.ok) setError(data.error ?? '저장에 실패했습니다.')
      else onSave(data as WorkLog)
    } catch {
      setError('네트워크 오류가 발생했습니다.')
    } finally {
      setSaving(false)
    }
  }

  const handleSaveActual = async () => {
    setError(null)
    setSaving(true)
    try {
      const res = await fetch('/api/team-status/update-daily-status', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: log.leave_date,
          checked_in_at:  actualCheckIn,
          checked_out_at: actualCheckOut,
        }),
      })
      const data = await res.json()
      if (!res.ok) setError(data.error ?? '저장에 실패했습니다.')
      else alert('실제 출퇴근 시각이 저장되었습니다.')
    } catch {
      setError('네트워크 오류가 발생했습니다.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900">제출 내역 수정</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex border-b border-gray-200">
          {(['report', 'checkin'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
                activeTab === tab
                  ? 'text-blue-600 border-b-2 border-blue-600'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab === 'report' ? '출퇴근보고' : '실제 출퇴근 시각'}
            </button>
          ))}
        </div>

        {activeTab === 'report' && (
          <form onSubmit={handleSubmitReport} className="px-6 py-5 space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">이름 *</label>
              <input type="text" value={form.name} onChange={e => set('name', e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">근무유형 *</label>
                <select value={form.workTypeLabel} onChange={e => set('workTypeLabel', e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  {WORK_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">근무일 *</label>
                <input type="date" value={form.leaveDate} onChange={e => set('leaveDate', e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">출근시간 *</label>
                <select value={form.startTime} onChange={e => set('startTime', e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  {WORK_TIME_OPTS.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">퇴근시간 *</label>
                <select value={form.endTime} onChange={e => set('endTime', e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  {WORK_TIME_OPTS.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">휴게시간 *</label>
                <select value={form.breakTime} onChange={e => set('breakTime', e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  {BREAK_TIMES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              {showBreakReason && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">휴게사유</label>
                  <input type="text" value={form.breakReason} onChange={e => set('breakReason', e.target.value)}
                    placeholder="점심 등"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">근무장소 *</label>
              <div className="flex gap-2">
                <select value={form.locationType} onChange={e => set('locationType', e.target.value)}
                  className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="">선택</option>
                  {WORK_LOCATIONS.map(l => <option key={l} value={l}>{l}</option>)}
                </select>
                {form.locationType === '기타' && (
                  <input type="text" value={form.locationCustom} onChange={e => set('locationCustom', e.target.value)}
                    placeholder="직접 입력"
                    className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                )}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">근무내용 *</label>
              <textarea value={form.workContent} onChange={e => set('workContent', e.target.value)}
                rows={3} placeholder="주요 업무 내용을 입력하세요"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
            </div>

            {error && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
            )}

            <div className="flex justify-end gap-3 pt-2">
              <button type="button" onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors">
                취소
              </button>
              <button type="submit" disabled={saving}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors">
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                저장
              </button>
            </div>
          </form>
        )}

        {activeTab === 'checkin' && (
          <div className="px-6 py-5 space-y-4">
            {loadingActual ? (
              <div className="py-8 text-center">
                <div className="inline-block animate-spin rounded-full h-6 w-6 border-4 border-gray-200 border-t-blue-600" />
                <p className="mt-2 text-xs text-gray-500">불러오는 중...</p>
              </div>
            ) : !dailyExists ? (
              <div className="py-8 text-center text-sm text-gray-500">
                {log.leave_date}의 출퇴근 기록이 없습니다.
              </div>
            ) : (
              <>
                <p className="text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                  팀원 둘러보기에 표시되는 실제 출근/퇴근 시각을 수정합니다.
                  출퇴근보고의 예정 시간과는 별개입니다.
                </p>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">실제 출근 시각</label>
                    <select value={actualCheckIn} onChange={e => setActualCheckIn(e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500">
                      {TIME_OPTS.map(t => <option key={t} value={t}>{t || '(미기록)'}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">실제 퇴근 시각</label>
                    <select value={actualCheckOut} onChange={e => setActualCheckOut(e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                      {TIME_OPTS.map(t => <option key={t} value={t}>{t || '(미기록)'}</option>)}
                    </select>
                  </div>
                </div>

                {error && (
                  <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
                )}

                <div className="flex justify-end gap-3 pt-2">
                  <button type="button" onClick={onClose}
                    className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors">
                    닫기
                  </button>
                  <button type="button" onClick={handleSaveActual} disabled={saving}
                    className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors">
                    {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                    저장
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
