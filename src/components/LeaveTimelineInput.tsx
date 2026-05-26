'use client'

/**
 * 휴가 시간 입력 컴포넌트
 *
 * 단일 select: 없음 / 00:30 / 01:00 / ... / 08:00 (30분 단위, 17개)
 *
 * 사용자는 "휴가 시간"만 입력하고, 내부 leaveType 분류(morning_half / full_day)는
 * 시간 기반 자동 매핑:
 *   - 0min                    → none (빈 timeline)
 *   - 30min ~ 450min (≤7.5h) → morning_half (반차 — 차감 정확 계산)
 *   - 480min        (= 8h)   → full_day (종일 휴가)
 *
 * 정확히 정규 근무 길이(8h)만 종일로 분류. 4.5h, 6h, 7.5h 등 "긴 부분 휴가"는
 * morning_half로 둬야 EW 계산기가 (출퇴근 폭) - (점심) - (휴가)로 정확히 차감.
 * (이전: ≤4h 반차, >4h 종일 → 6h 휴가가 종일로 잘못 분류돼 actualWork=0 버그.)
 *
 * EW 계산기는 isFullDayLeave (= leaveType === 'full_day')만 분기에 사용.
 * full_day면 actualWork=0, EW="휴가" 강제. 따라서 종일 분류는 신중해야 함.
 */

import { Plane, AlertCircle } from 'lucide-react'
import { useEffect, useState } from 'react'
import {
  type LeaveTimeline,
} from '@/types/leave-timeline'
import { buildLeaveItem, minutesToLeaveType, LEAVE_TIME_OPTIONS } from '@/lib/leave-timeline'
import CustomDropdown from '@/components/ui/CustomDropdown'

interface LeaveTimelineInputProps {
  value: LeaveTimeline
  onChange: (next: LeaveTimeline) => void
  disabled?: boolean
}

// Phase B — 사용자 mode가 sheet_only일 때 시트 동기화 안내. 모든 LeaveTimelineInput mount에서 1회 fetch (5분 cache).
function useUserCalendarMode(): string | null {
  const [mode, setMode] = useState<string | null>(null)
  useEffect(() => {
    let canceled = false
    fetch('/api/my/calendar-mode')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (!canceled && d) setMode(d.mode) })
      .catch(() => { /* silent */ })
    return () => { canceled = true }
  }, [])
  return mode
}

/** 시간 select 옵션 — 30분 단위, '휴가 없음' + 00:30 ~ 08:00 (lib 공용) */
const TIME_OPTIONS = LEAVE_TIME_OPTIONS

function timelineToMinutes(timeline: LeaveTimeline): number {
  if (!Array.isArray(timeline) || timeline.length === 0) return 0
  return timeline[0].roundedMinutes ?? 0
}

export default function LeaveTimelineInput({ value, onChange, disabled }: LeaveTimelineInputProps) {
  const currentMinutes = timelineToMinutes(value)
  const userMode = useUserCalendarMode()

  const handleMinutesChange = (newMinutes: number) => {
    const leaveType = minutesToLeaveType(newMinutes)
    if (!leaveType) {
      onChange([])
      return
    }
    onChange([buildLeaveItem(leaveType, '휴가', 'manual', newMinutes)])
  }

  return (
    <div className="space-y-1.5">
      {/* Phase B — sheet_only mode 사용자에게 시트 동기화 안내 */}
      {userMode === 'sheet_only' && (
        <div className="flex items-start gap-1.5 text-[11px] text-warning-text bg-warning-bg border border-warning-border rounded-md px-2 py-1.5 leading-snug">
          <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <span>
            이 팀은 시트로 운영됩니다. 휴가는 N-Click에 저장되지만 시트와 자동 동기화되지 않습니다.
            <strong className="font-semibold"> 시트에도 직접 휴가를 등록해주세요.</strong>
          </span>
        </div>
      )}
      <div className="flex items-center gap-2 flex-wrap">
      <Plane className="h-3.5 w-3.5 text-warning-text shrink-0" aria-hidden />
      <span className="text-[12px] text-text-muted">휴가 시간:</span>
      {/* 2026-05-19 v1.23: native select → CustomDropdown */}
      <CustomDropdown
        value={String(currentMinutes)}
        onChange={(v) => handleMinutesChange(parseInt(v, 10))}
        disabled={disabled}
        ariaLabel="휴가 시간"
        className="w-32"
        options={TIME_OPTIONS.map(opt => ({
          value: String(opt.minutes),
          label: opt.label,
        }))}
      />
      </div>
    </div>
  )
}
