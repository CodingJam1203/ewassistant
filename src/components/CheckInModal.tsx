'use client'

import { useEffect, useState } from 'react'
import { X, Loader2 } from 'lucide-react'
import WorkLocationTimelineInput, { defaultTimeline } from '@/components/WorkLocationTimelineInput'
import { validateTimeline } from '@/lib/work-location-timeline'
import type { WorkLocationTimeline } from '@/types/work-location-timeline'

interface CheckInModalProps {
  date: string
  userName: string | null
  /** 출근 버튼에서 시각이 결정된 경우 첫 work_location의 startTime으로 사용 */
  initialStartTime?: string
  onClose: () => void
  onSuccess: () => void
}

const BREAK_OPTS = ['00:00', '00:30', '01:00', '01:30', '02:00', '02:30', '03:00']

/** 'HH:mm' 분이 30분 단위인지 확인 후 그렇지 않으면 30분 단위로 보정해서 반환 */
function normalizeStartTimeTo30(input: string | undefined, fallback: string): string {
  if (!input) return fallback
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(input)
  if (!m) return fallback
  const hh = m[1]
  const mm = parseInt(m[2], 10)
  const flooredMm = mm < 30 ? '00' : '30'
  return `${hh}:${flooredMm}`
}

export default function CheckInModal({
  date, userName, initialStartTime, onClose, onSuccess,
}: CheckInModalProps) {
  const [name, setName] = useState<string>(userName ?? '')
  const [breakTime, setBreakTime] = useState<string>('01:00')
  const [workContent, setWorkContent] = useState<string>('')
  const [timeline, setTimeline] = useState<WorkLocationTimeline>(() => {
    // 임시 기본값 (이후 어제 expected가 있으면 fetch 결과로 교체)
    const base = defaultTimeline()
    if (initialStartTime) {
      const normalized = normalizeStartTimeTo30(initialStartTime, '09:00')
      // 첫 work_location의 startTime을 출근 버튼 시각으로 prefill
      const next: WorkLocationTimeline = base.map((e, i) => {
        if (i === 0 && e.kind === 'work_location') {
          return { ...e, startTime: normalized }
        }
        return e
      })
      return next
    }
    return base
  })
  const [loadingPrefill, setLoadingPrefill] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState<string | null>(null)

  /** 어제 퇴근보고에서 작성한 expected timeline을 가져와서 prefill */
  useEffect(() => {
    let cancelled = false
    const fetchPrefill = async () => {
      try {
        const res = await fetch(`/api/team-status/expected-timeline?date=${encodeURIComponent(date)}`)
        if (!res.ok) return
        const data = await res.json() as { timeline: WorkLocationTimeline | null }
        if (cancelled) return
        if (data.timeline && data.timeline.length > 0) {
          setTimeline(data.timeline)
        }
      } catch {
        // prefill 실패는 무시 (기본값 유지)
      } finally {
        if (!cancelled) setLoadingPrefill(false)
      }
    }
    fetchPrefill()
    return () => { cancelled = true }
  }, [date])

  const validationErrors = validateTimeline(timeline)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!name.trim()) return setError('이름을 입력해주세요.')
    if (validationErrors.length > 0) {
      return setError(validationErrors[0].message)
    }

    setSaving(true)
    try {
      const res = await fetch('/api/team-status/check-in', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date,
          name:                 name.trim(),
          workLocationTimeline: timeline,
          break_time:           breakTime,
          work_content:         workContent.trim() || null,
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
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 overflow-y-auto py-6 px-4"
    >
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <div>
            <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">출근보고 작성하기</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{date} — 근무장소 타임라인을 입력해주세요</p>
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
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* 근무장소 타임라인 */}
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">근무장소 타임라인 *</label>
            <p className="text-xs text-gray-400 mb-2">
              하루 안에 여러 장소에서 근무하는 경우 <span className="font-medium">근무장소 추가</span>로 행을 늘리고, 마지막에 <span className="font-medium">퇴근예정</span> 시간을 입력하세요. 시간은 30분 단위입니다.
            </p>
            {loadingPrefill && (
              <p className="text-xs text-gray-400 mb-2">어제 퇴근보고의 출근 예정 정보를 불러오는 중...</p>
            )}
            <WorkLocationTimelineInput
              value={timeline}
              onChange={setTimeline}
              errors={validationErrors}
            />
          </div>

          {/* 휴게시간 */}
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">휴게시간</label>
            <select
              value={breakTime}
              onChange={e => setBreakTime(e.target.value)}
              className="w-full sm:w-1/2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {BREAK_OPTS.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>

          {/* 메모 */}
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">메모</label>
            <textarea
              value={workContent}
              onChange={e => setWorkContent(e.target.value)}
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
              className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-600">
              취소
            </button>
            <button type="submit" disabled={saving || validationErrors.length > 0}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-50">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              출근보고 작성하기
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
