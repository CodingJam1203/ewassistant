'use client'

import { useState } from 'react'
import { X, Loader2, LogIn } from 'lucide-react'

interface CheckInTimeModalProps {
  date: string
  workLogId: string | null   // 출근보고가 이미 있으면 전달 → 바로 check-in
  onClose: () => void
  /** 출근보고 있을 때: 시각 선택 후 check-in 완료 콜백 */
  onDone: () => void
  /** 출근보고 없을 때: 시각 선택 후 CheckInModal로 이동 */
  onNeedWorkLog: (time: string) => void
}

/** 현재 시각을 30분 단위로 내림 */
function roundTo30(date: Date): string {
  const h = date.getHours()
  const m = date.getMinutes() < 30 ? 0 : 30
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`
}

/** 06:00 ~ 23:30 30분 단위 옵션 */
function buildTimeOptions(): string[] {
  const opts: string[] = []
  for (let h = 6; h <= 23; h++) {
    opts.push(`${h.toString().padStart(2, '0')}:00`)
    if (h < 23) opts.push(`${h.toString().padStart(2, '0')}:30`)
  }
  return opts
}

const TIME_OPTIONS = buildTimeOptions()

export default function CheckInTimeModal({
  date, workLogId, onClose, onDone, onNeedWorkLog,
}: CheckInTimeModalProps) {
  const [time, setTime] = useState(roundTo30(new Date()))
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState<string | null>(null)

  const handleConfirm = async () => {
    setError(null)

    if (workLogId) {
      // 출근보고 있음 → 바로 check-in API 호출
      setSaving(true)
      try {
        // 선택 시각을 KST ISO 로 변환
        const [hh, mm] = time.split(':').map(Number)
        const checkedInAt = new Date(date)
        checkedInAt.setHours(hh, mm, 0, 0)

        const res = await fetch('/api/team-status/check-in', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            date,
            work_log_id:    workLogId,
            checked_in_at:  checkedInAt.toISOString(),
          }),
        })
        const data = await res.json()
        if (!res.ok) {
          setError(data.error ?? '출근 처리에 실패했습니다.')
        } else {
          onDone()
        }
      } catch {
        setError('네트워크 오류가 발생했습니다.')
      } finally {
        setSaving(false)
      }
    } else {
      // 출근보고 없음 → CheckInModal 로 넘김
      onNeedWorkLog(time)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-xs">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">출근 시각 선택</h3>
            <p className="text-xs text-gray-400 mt-0.5">{date}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-5 py-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">출근 시각</label>
            <select
              value={time}
              onChange={e => setTime(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            >
              {TIME_OPTIONS.map(t => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>

          {!workLogId && (
            <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              출근보고가 없습니다. 시각 선택 후 출근보고를 작성해주세요.
            </p>
          )}

          {error && (
            <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 text-sm text-gray-600 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              취소
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={saving}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-50"
            >
              {saving
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : <LogIn className="h-4 w-4" />
              }
              {workLogId ? '출근 확인' : '다음 →'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
