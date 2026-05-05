'use client'

import { useState } from 'react'
import { X, Loader2 } from 'lucide-react'

interface CheckInModalProps {
  date: string
  userName: string | null
  defaultLocation?: string
  initialStartTime?: string
  onClose: () => void
  onSuccess: () => void
}

const LOCATIONS = ['사무실', '재택', '외근', '기타'] as const

/** 30분 단위 시간 옵션 생성 */
function buildTimeOpts(startHour: number, endHour: number): string[] {
  const opts: string[] = []
  for (let h = startHour; h <= endHour; h++) {
    opts.push(`${String(h).padStart(2, '0')}:00`)
    if (h < endHour || endHour === 23) opts.push(`${String(h).padStart(2, '0')}:30`)
  }
  return opts
}

const START_OPTS  = buildTimeOpts(6, 23)
const END_OPTS    = buildTimeOpts(8, 23)
const BREAK_OPTS  = ['00:00', '00:30', '01:00', '01:30', '02:00', '02:30', '03:00']

export default function CheckInModal({
  date, userName, defaultLocation = '사무실', initialStartTime, onClose, onSuccess
}: CheckInModalProps) {
  const [form, setForm] = useState({
    name:            userName ?? '',
    location_type:   defaultLocation as string,
    location_custom: '',
    start_time:      initialStartTime ?? '09:00',
    end_time:        '18:00',
    break_time:      '01:00',
    work_content:    '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState<string | null>(null)

  const set = (k: string, v: string) => setForm(p => ({ ...p, [k]: v }))

  const finalLocation =
    form.location_type === '기타' ? form.location_custom : form.location_type

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!form.name.trim()) return setError('이름을 입력해주세요.')
    if (!finalLocation.trim()) return setError('근무장소를 입력해주세요.')

    setSaving(true)
    try {
      const res = await fetch('/api/team-status/check-in', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date,
          name:               form.name.trim(),
          work_location:      finalLocation.trim(),
          work_location_type: form.location_type,
          start_time:         form.start_time,
          end_time:           form.end_time,
          break_time:         form.break_time,
          work_content:       form.work_content.trim() || null,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? '출근보고 처리에 실패했습니다.')
      } else {
        onSuccess()
      }
    } catch {
      setError('네트워크 오류가 발생했습니다.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
    >
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <div>
            <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">출근보고 작성하기</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{date} — 출퇴근보고가 없어 예정시간을 입력해주세요</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          {/* 이름 */}
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">이름 *</label>
            <input
              type="text"
              value={form.name}
              onChange={e => set('name', e.target.value)}
              className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* 근무장소 */}
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">근무장소 *</label>
            <select
              value={form.location_type}
              onChange={e => set('location_type', e.target.value)}
              className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {LOCATIONS.map(l => <option key={l} value={l}>{l}</option>)}
            </select>
            {form.location_type === '기타' && (
              <input
                type="text"
                value={form.location_custom}
                onChange={e => set('location_custom', e.target.value)}
                placeholder="장소 직접 입력"
                className="mt-2 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            )}
          </div>

          {/* 출퇴근 예정시간 — 30분 단위 */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">출근 예정</label>
              <select
                value={form.start_time}
                onChange={e => set('start_time', e.target.value)}
                className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {START_OPTS.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">퇴근 예정</label>
              <select
                value={form.end_time}
                onChange={e => set('end_time', e.target.value)}
                className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {END_OPTS.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">휴게시간</label>
              <select
                value={form.break_time}
                onChange={e => set('break_time', e.target.value)}
                className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {BREAK_OPTS.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>

          {/* 메모 */}
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">메모</label>
            <textarea
              value={form.work_content}
              onChange={e => set('work_content', e.target.value)}
              rows={2}
              placeholder="비고"
              className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
          </div>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 dark:bg-red-900/20 border border-red-200 rounded-lg px-3 py-2">{error}</p>
          )}

          <div className="flex justify-end gap-3 pt-1">
            <button type="button" onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 bg-white dark: