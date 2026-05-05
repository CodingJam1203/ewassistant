'use client'

/**
 * 휴가/반차 입력 컴포넌트
 *
 * 단일 select로 다음 4가지 중 하나 선택:
 *  - 없음 (휴가 없음)
 *  - 종일 휴가 (full_day)
 *  - 오전반차 (morning_half)
 *  - 오후반차 (afternoon_half)
 *
 * 선택값에 따라 LeaveTimeline을 빈 배열 또는 단일 항목 배열로 onChange합니다.
 *
 * 1차에서는 단순화: 한 사용자가 하루에 한 종류의 휴가만 가질 수 있다고 가정.
 * (오전반차 + 오후반차 동시 등록은 종일 휴가와 동등하므로 막음)
 */

import { Plane } from 'lucide-react'
import {
  LEAVE_TYPE_DEFINITIONS,
  LEAVE_TYPE_LABELS,
  type LeaveTimeline,
  type LeaveType,
} from '@/types/leave-timeline'
import { buildLeaveItem } from '@/lib/leave-timeline'

type Selection = 'none' | LeaveType

interface LeaveTimelineInputProps {
  value: LeaveTimeline
  onChange: (next: LeaveTimeline) => void
  disabled?: boolean
}

const OPTIONS: { value: Selection; label: string; hint?: string }[] = [
  { value: 'none',           label: '휴가 없음' },
  { value: 'full_day',       label: '종일 휴가',  hint: '09:00~18:00 (8h)' },
  { value: 'morning_half',   label: '오전반차',  hint: '09:00~14:00 (5h)' },
  { value: 'afternoon_half', label: '오후반차',  hint: '14:00~18:00 (4h)' },
]

function timelineToSelection(timeline: LeaveTimeline): Selection {
  if (!Array.isArray(timeline) || timeline.length === 0) return 'none'
  const first = timeline[0]
  return first.leaveType
}

export default function LeaveTimelineInput({ value, onChange, disabled }: LeaveTimelineInputProps) {
  const current: Selection = timelineToSelection(value)
  const def = current !== 'none' ? LEAVE_TYPE_DEFINITIONS[current] : null

  const handleChange = (next: Selection) => {
    if (next === 'none') {
      onChange([])
    } else {
      onChange([buildLeaveItem(next)])
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Plane className="h-3.5 w-3.5 text-amber-500 flex-shrink-0" />
        <select
          value={current}
          onChange={e => handleChange(e.target.value as Selection)}
          disabled={disabled}
          className="rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
        >
          {OPTIONS.map(opt => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        {def && (
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {def.startTime}~{def.endTime}
            {' · '}
            계산 {Math.floor(def.minutes / 60)}:{String(def.minutes % 60).padStart(2, '0')}
          </span>
        )}
      </div>

      {current === 'full_day' && (
        <p className="text-xs text-amber-600">
          종일 휴가 — 근무장소 타임라인은 비워두거나 자동으로 비활성화됩니다.
        </p>
      )}

      {(current === 'morning_half' || current === 'afternoon_half') && (
        <p className="text-xs text-gray-500">
          {LEAVE_TYPE_LABELS[current]}는 실근무시간에서 {Math.floor(LEAVE_TYPE_DEFINITIONS[current].minutes / 60)}시간이 차감됩니다.
        </p>
      )}
    </div>
  )
}
