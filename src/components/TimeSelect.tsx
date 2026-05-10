'use client'

/**
 * TimeSelect
 * - HH:MM (24h, optionally 36h) 문자열을 시 / 분 두 개의 native <select>로 입력
 * - mobile에서는 native scroll picker, desktop에서는 native dropdown으로 렌더되어
 *   브라우저 종속 시계 UI(아날로그 다이얼) 대신 일관된 dropdown UX 제공
 *
 * value: "" | "HH:MM"  (빈 문자열 허용 — placeholder 동작)
 * onChange: (v: string) => void   "HH:MM" 또는 ""
 *
 * 분 단위(minuteStep, 기본 1)로 옵션 생성. 30분 단위로 제한하려면 30 전달.
 * allowNextDay=true 이면 hour 옵션이 24~36까지 확장되며 24+는 "(명일) HH"로 표기.
 */

import { useMemo } from 'react'

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

  const hourOptions = useMemo(
    () => Array.from({ length: maxHour + 1 }, (_, i) => pad2(i)),
    [maxHour]
  )
  const minuteOptions = useMemo(() => {
    const arr: string[] = []
    for (let i = 0; i < 60; i += safeStep) arr.push(pad2(i))
    if (minuteStr && !arr.includes(minuteStr)) {
      arr.push(minuteStr)
      arr.sort()
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

  const baseSelectCls =
    'select-tight block h-10 rounded-[10px] border border-border-strong bg-surface ' +
    'text-sm tabular-nums focus:outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 px-3 py-2 ' +
    'disabled:bg-surface-muted disabled:text-text-disabled disabled:cursor-not-allowed'

  return (
    <div className={`flex items-center gap-2 ${className ?? ''}`}>
      <select
        aria-label={ariaLabelHour}
        disabled={disabled}
        value={hourStr}
        onChange={(e) => emit(e.target.value, minuteStr)}
        className={`${baseSelectCls} flex-1 min-w-0`}
      >
        <option value="">시</option>
        {hourOptions.map(h => {
          const hn = parseInt(h, 10)
          const display = hn >= 24 ? `(명일) ${pad2(hn - 24)}` : h
          return <option key={h} value={h}>{display}</option>
        })}
      </select>
      <span className="text-text-muted text-sm select-none">:</span>
      <select
        aria-label={ariaLabelMinute}
        disabled={disabled}
        value={minuteStr}
        onChange={(e) => emit(hourStr, e.target.value)}
        className={`${baseSelectCls} flex-1 min-w-0`}
      >
        <option value="">분</option>
        {minuteOptions.map(m => (
          <option key={m} value={m}>{m}</option>
        ))}
      </select>
    </div>
  )
}
