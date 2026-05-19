'use client'

/**
 * TimeSelect
 * - HH:MM (24h, optionally 36h) 문자열을 시 / 분 두 개의 dropdown으로 입력
 * - 2026-05-19 v1.14: native <select> → CustomDropdown 교체.
 *   선택값이 popover 열렸을 때 위에서 3번째 위치에 보이도록 스크롤 제어.
 *
 * value: "" | "HH:MM"  (빈 문자열 허용 — placeholder 동작)
 * onChange: (v: string) => void   "HH:MM" 또는 ""
 *
 * 분 단위(minuteStep, 기본 1)로 옵션 생성. 30분 단위로 제한하려면 30 전달.
 * allowNextDay=true 이면 hour 옵션이 24~36까지 확장되며 24+는 "(명일) HH"로 표기.
 */

import { useMemo } from 'react'
import CustomDropdown, { type CustomDropdownOption } from '@/components/ui/CustomDropdown'

interface TimeSelectProps {
  value?: string
  onChange: (next: string) => void
  /** 분 단위 — 1(분단위), 5, 10, 15, 30 등 */
  minuteStep?: number
  /** disabled / readonly 상태 */
  disabled?: boolean
  /** 추가 클래스 */
  className?: string
  /** 시 select에 적용할 aria-label */
  ariaLabelHour?: string
  /** 분 select에 적용할 aria-label */
  ariaLabelMinute?: string
  /**
   * 명일(24+ 시) 시간 옵션 허용. 야간 근무자가 새벽까지 일하는 케이스용.
   * true 시 hour 옵션에 24~36이 추가되며, 24+는 "(명일) HH"로 표기.
   */
  allowNextDay?: boolean
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

export default function TimeSelect({
  value,
  onChange,
  minuteStep = 1,
  disabled,
  className,
  ariaLabelHour = '시',
  ariaLabelMinute = '분',
  allowNextDay = false,
}: TimeSelectProps) {
  const safeStep = Math.max(1, Math.min(60, Math.floor(minuteStep || 1)))
  const maxHour = allowNextDay ? 36 : 23

  const [hourStr, minuteStr] = useMemo(() => {
    const v = (value ?? '').trim()
    const m = v.match(/^(\d{1,2}):(\d{1,2})$/)
    if (!m) return ['', '']
    const h = parseInt(m[1], 10)
    const mi = parseInt(m[2], 10)
    if (!Number.isFinite(h) || h < 0 || h > maxHour) return ['', '']
    if (!Number.isFinite(mi) || mi < 0 || mi > 59) return ['', '']
    return [pad2(h), pad2(mi)]
  }, [value, maxHour])

  const hourOptions: CustomDropdownOption[] = useMemo(
    () => Array.from({ length: maxHour + 1 }, (_, i) => {
      const v = pad2(i)
      const label = i >= 24 ? `(명일) ${pad2(i - 24)}` : v
      return { value: v, label }
    }),
    [maxHour]
  )
  const minuteOptions: CustomDropdownOption[] = useMemo(() => {
    const arr: CustomDropdownOption[] = []
    for (let i = 0; i < 60; i += safeStep) {
      const v = pad2(i)
      arr.push({ value: v, label: v })
    }
    if (minuteStr && !arr.some(x => x.value === minuteStr)) {
      arr.push({ value: minuteStr, label: minuteStr })
      arr.sort((a, b) => a.value.localeCompare(b.value))
    }
    return arr
  }, [safeStep, minuteStr])

  const emit = (h: string, mi: string) => {
    if (!h && !mi) {
      onChange('')
      return
    }
    const finalH = h || '00'
    const finalM = mi || '00'
    onChange(`${finalH}:${finalM}`)
  }

  return (
    <div className={`flex items-center gap-2 ${className ?? ''}`}>
      <CustomDropdown
        value={hourStr}
        options={hourOptions}
        onChange={(v) => emit(v, minuteStr)}
        disabled={disabled}
        ariaLabel={ariaLabelHour}
        placeholder="시"
        className="flex-1 min-w-0"
      />
      <span className="text-text-muted text-sm select-none">:</span>
      <CustomDropdown
        value={minuteStr}
        options={minuteOptions}
        onChange={(v) => emit(hourStr, v)}
        disabled={disabled}
        ariaLabel={ariaLabelMinute}
        placeholder="분"
        className="flex-1 min-w-0"
      />
    </div>
  )
}
