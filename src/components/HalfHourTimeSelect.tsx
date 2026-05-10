'use client'

/**
 * HalfHourTimeSelect — 30분 단위 단일 select.
 *
 * 시/분 분리 select(TimeSelect) 대신, 09:00 / 09:30 / 10:00 ... 한 번에 고를 수 있는 UX.
 * value: 'HH:mm' 또는 ''
 * allowNextDay=true: 24:00 ~ 36:00 ('명일 00:00' ~ '명일 12:00') 옵션 추가
 */

import { useMemo } from 'react'

interface Props {
  value?: string
  onChange: (next: string) => void
  /** 24:00~36:00 (명일) 옵션 허용 */
  allowNextDay?: boolean
  disabled?: boolean
  className?: string
  ariaLabel?: string
  /** placeholder 텍스트 (기본: '시간 선택') */
  placeholder?: string
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

export default function HalfHourTimeSelect({
  value,
  onChange,
  allowNextDay = false,
  disabled,
  className,
  ariaLabel,
  placeholder = '시간 선택',
}: Props) {
  const maxHour = allowNextDay ? 36 : 23

  const options = useMemo(() => {
    const arr: string[] = []
    for (let h = 0; h <= maxHour; h++) {
      arr.push(`${pad2(h)}:00`)
      arr.push(`${pad2(h)}:30`)
    }
    return arr
  }, [maxHour])

  // value 정규화 — HH:mm 형식이 아니거나 30분 단위 아니면 빈 문자열
  const normalized = useMemo(() => {
    const v = (value ?? '').trim()
    const m = v.match(/^(\d{1,2}):(\d{2})$/)
    if (!m) return ''
    const h = parseInt(m[1], 10)
    const mi = parseInt(m[2], 10)
    if (!Number.isFinite(h) || h < 0 || h > maxHour) return ''
    if (mi !== 0 && mi !== 30) return ''
    return `${pad2(h)}:${pad2(mi)}`
  }, [value, maxHour])

  return (
    <select
      value={normalized}
      onChange={e => onChange(e.target.value)}
      disabled={disabled}
      aria-label={ariaLabel}
      className={
        `select-tight block h-10 w-full rounded-[10px] border border-border-strong bg-surface ` +
        `text-sm tabular-nums px-3 py-2 ` +
        `focus:outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 ` +
        `disabled:bg-surface-muted disabled:text-text-disabled disabled:cursor-not-allowed ` +
        (className ?? '')
      }
    >
      <option value="">{placeholder}</option>
      {options.map(t => {
        const h = parseInt(t.split(':')[0], 10)
        const display = h >= 24
          ? `(명일) ${pad2(h - 24)}:${t.split(':')[1]}`
          : t
        return <option key={t} value={t}>{display}</option>
      })}
    </select>
  )
}
