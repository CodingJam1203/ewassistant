'use client'

/**
 * HalfHourTimeSelect — 30분 단위 단일 dropdown.
 *
 * 시/분 분리(TimeSelect) 대신 09:00 / 09:30 / 10:00 ... 한 번에 고를 수 있는 UX.
 * 2026-05-19 v1.14: native <select> → CustomDropdown 교체. 선택값이 popover
 * 열렸을 때 위에서 3번째 위치에 보이도록 스크롤 제어.
 *
 * value: 'HH:mm' 또는 ''
 * allowNextDay=true: 24:00 ~ 36:00 ('명일 00:00' ~ '명일 12:00') 옵션 추가
 */

import { useMemo } from 'react'
import CustomDropdown, { type CustomDropdownOption } from '@/components/ui/CustomDropdown'

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
  /** prefill fetch 중 — disabled + 선택값 숨김 + "불러오는 중…" 표시 */
  loading?: boolean
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
  loading = false,
}: Props) {
  const maxHour = allowNextDay ? 36 : 23

  const options: CustomDropdownOption[] = useMemo(() => {
    const arr: CustomDropdownOption[] = []
    for (let h = 0; h <= maxHour; h++) {
      for (const mi of [0, 30]) {
        const v = `${pad2(h)}:${pad2(mi)}`
        const label = h >= 24 ? `(명일) ${pad2(h - 24)}:${pad2(mi)}` : v
        arr.push({ value: v, label })
      }
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
    <CustomDropdown
      value={normalized}
      options={options}
      onChange={onChange}
      disabled={disabled}
      ariaLabel={ariaLabel}
      placeholder={placeholder}
      className={className}
      loading={loading}
    />
  )
}
