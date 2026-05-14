'use client'

/**
 * 휴가 시간 입력 컴포넌트
 *
 * 단일 select: 없음 / 00:30 / 01:00 / ... / 08:00 (30분 단위, 17개)
 *
 * 사용자는 "휴가 시간"만 입력하고, 내부 leaveType 분류(morning_half / full_day)는
 * 시간 기반 자동 매핑:
 *   - 0min                  → none (빈 timeline)
 *   - 30min  ~ 240min (≤4h) → morning_half (반차)
 *   - 270min ~ 480min (>4h) → full_day (종일 휴가)
 *
 * 검증 근거 (EW 영향 분석):
 *   - EW 계산기는 isFullDayLeave (= leaveType === 'full_day')만 분기에 사용
 *   - 그 외 morning_half / afternoon_half 구분은 표시 라벨에만 영향
 *   - 따라서 시간만 보고 morning_half / full_day 자동 분류해도 차감 시간(roundedMinutes)
 *     기반 EW 계산은 그대로 정상 동작
 */

import { Plane } from 'lucide-react'
import {
  type LeaveTimeline,
  type LeaveType,
} from '@/types/leave-timeline'
import { buildLeaveItem } from '@/lib/leave-timeline'

interface LeaveTimelineInputProps {
  value: LeaveTimeline
  onChange: (next: LeaveTimeline) => void
  disabled?: boolean
}

/** 시간 select 옵션 — 30분 단위, 00:30 ~ 08:00 (16개) + '없음' */
const TIME_OPTIONS: { minutes: number; label: string }[] = (() => {
  const opts: { minutes: number; label: string }[] = [{ minutes: 0, label: '휴가 없음' }]
  for (let m = 30; m <= 8 * 60; m += 30) {
    const h = Math.floor(m / 60)
    const mm = m % 60
    opts.push({
      minutes: m,
      label: `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`,
    })
  }
  return opts
})()

/** 휴가 시간(분) → leaveType 자동 매핑 */
function minutesToLeaveType(minutes: number): LeaveType | null {
  if (minutes <= 0) return null
  if (minutes <= 240) return 'morning_half'
  return 'full_day'
}

function timelineToMinutes(timeline: LeaveTimeline): number {
  if (!Array.isArray(timeline) || timeline.length === 0) return 0
  return timeline[0].roundedMinutes ?? 0
}

export default function LeaveTimelineInput({ value, onChange, disabled }: LeaveTimelineInputProps) {
  const currentMinutes = timelineToMinutes(value)

  const handleMinutesChange = (newMinutes: number) => {
    const leaveType = minutesToLeaveType(newMinutes)
    if (!leaveType) {
      onChange([])
      return
    }
    onChange([buildLeaveItem(leaveType, '휴가', 'manual', newMinutes)])
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <Plane className="h-3.5 w-3.5 text-warning-text shrink-0" aria-hidden />
      <span className="text-[12px] text-text-muted">휴가 시간:</span>
      <select
        value={currentMinutes}
        onChange={e => handleMinutesChange(parseInt(e.target.value, 10))}
        disabled={disabled}
        className="select-tight rounded-[10px] border border-border-strong bg-surface h-9 px-3 text-sm tabular-nums focus:outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 disabled:opacity-50"
      >
        {TIME_OPTIONS.map(opt => (
          <option key={opt.minutes} value={opt.minutes}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  )
}
