'use client'

/**
 * 휴가/반차 입력 컴포넌트
 *
 * 두 개의 select:
 *   1) 휴가 종류 — 없음 / 종일 휴가 / 오전반차 / 오후반차
 *   2) 차감시간 — 30분 단위 (00:00 ~ 09:00). 휴가 종류 선택 시 default가 자동 세팅되지만
 *                사용자가 자유롭게 조정 가능.
 *
 * 1차에서는 단순화: 한 사용자가 하루에 한 종류의 휴가만 가질 수 있다고 가정.
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

const OPTIONS: { value: Selection; label: string }[] = [
  { value: 'none',           label: '휴가 없음' },
  { value: 'full_day',       label: '종일 휴가' },
  { value: 'morning_half',   label: '오전반차' },
  { value: 'afternoon_half', label: '오후반차' },
]

/** 차감시간 select 옵션 — 30분 단위, 00:00 ~ 09:00 */
const DEDUCTION_OPTIONS: { minutes: number; label: string }[] = (() => {
  const opts: { minutes: number; label: string }[] = []
  for (let m = 0; m <= 9 * 60; m += 30) {
    const h = Math.floor(m / 60)
    const mm = m % 60
    opts.push({
      minutes: m,
      label: `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`,
    })
  }
  return opts
})()

function timelineToSelection(timeline: LeaveTimeline): Selection {
  if (!Array.isArray(timeline) || timeline.length === 0) return 'none'
  return timeline[0].leaveType
}

function timelineToDeductionMinutes(timeline: LeaveTimeline): number {
  if (!Array.isArray(timeline) || timeline.length === 0) return 0
  return timeline[0].roundedMinutes ?? 0
}

export default function LeaveTimelineInput({ value, onChange, disabled }: LeaveTimelineInputProps) {
  const current: Selection = timelineToSelection(value)
  const def = current !== 'none' ? LEAVE_TYPE_DEFINITIONS[current] : null
  const currentDeduction = timelineToDeductionMinutes(value)

  /** 휴가 종류 변경 — default 차감시간으로 reset */
  const handleTypeChange = (next: Selection) => {
    if (next === 'none') {
      onChange([])
    } else {
      onChange([buildLeaveItem(next)])
    }
  }

  /** 차감시간 변경 — type은 유지, 차감 분만 업데이트 */
  const handleDeductionChange = (newMinutes: number) => {
    if (current === 'none') return
    const item = value[0]
    onChange([{
      ...item,
      actualMinutes: newMinutes,
      roundedMinutes: newMinutes,
    }])
  }

  return (
    <div className="space-y-2">
      {/* 휴가 종류 + 차감시간 select */}
      <div className="flex items-center gap-2 flex-wrap">
        <Plane className="h-3.5 w-3.5 text-warning-text shrink-0" aria-hidden />
        <select
          value={current}
          onChange={e => handleTypeChange(e.target.value as Selection)}
          disabled={disabled}
          className="select-tight rounded-[10px] border border-border-strong bg-surface h-9 px-3 text-sm focus:outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 disabled:opacity-50"
        >
          {OPTIONS.map(opt => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>

        {current !== 'none' && (
          <>
            <span className="text-[12px] text-text-muted">차감시간:</span>
            <select
              value={currentDeduction}
              onChange={e => handleDeductionChange(parseInt(e.target.value, 10))}
              disabled={disabled}
              className="select-tight rounded-[10px] border border-border-strong bg-surface h-9 px-3 text-sm tabular-nums focus:outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 disabled:opacity-50"
            >
              {DEDUCTION_OPTIONS.map(opt => (
                <option key={opt.minutes} value={opt.minutes}>
                  {opt.label}
                </option>
              ))}
            </select>
          </>
        )}
      </div>

      {/* 시간 폭 안내 */}
      {def && (
        <p className="text-[12px] text-text-secondary tabular-nums">
          {LEAVE_TYPE_LABELS[current as LeaveType]} {def.startTime}~{def.endTime}
          <span className="ml-1 text-text-muted">— 차감시간은 직접 조정할 수 있습니다.</span>
        </p>
      )}
    </div>
  )
}
