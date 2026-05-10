'use client'

/**
 * 날짜 input — 요일을 input 박스 안에 함께 표시.
 *
 * 네이티브 `<input type="date">`는 텍스트 옆에 라벨을 끼워넣을 수 없어,
 * 시각적 디스플레이는 별도로 그리고 native input은 overlay로 깔아 picker를 호출.
 *
 * 사용:
 *   <DateInputWithDow value={date} onChange={setDate} />
 *
 * react-hook-form 제어용 변형이 필요하면 `register('field')` 결과를
 * inputProps prop으로 그대로 전달:
 *   <DateInputWithDow value={watch('field')} inputProps={register('field')} />
 */

import React, { forwardRef, useRef } from 'react'
import { Calendar } from 'lucide-react'
import { dowKo } from '@/lib/utils/date'
import { cn } from '@/lib/utils/cn'

type Size = 'sm' | 'md'

export interface DateInputWithDowProps {
  /** YYYY-MM-DD 형식 — 없으면 placeholder 표시 */
  value?: string
  /** 변경 콜백 — value를 직접 전달받음 */
  onChange?: (next: string) => void
  /** native input에 직접 spread (RHF register 결과 등) */
  inputProps?: React.InputHTMLAttributes<HTMLInputElement>
  className?: string
  size?: Size
  disabled?: boolean
  min?: string
  max?: string
  /** 빈 값일 때 표시 텍스트 (기본 'YYYY-MM-DD') */
  placeholder?: string
  ariaLabel?: string
  id?: string
  name?: string
}

const SIZE_CLASS: Record<Size, string> = {
  sm: 'h-8 px-2.5 text-[12px]',
  md: 'h-10 px-3 text-sm',
}

const DateInputWithDow = forwardRef<HTMLInputElement, DateInputWithDowProps>(
  function DateInputWithDow(
    {
      value, onChange, inputProps, className, size = 'md',
      disabled, min, max, placeholder = 'YYYY-MM-DD',
      ariaLabel, id, name,
    },
    externalRef,
  ) {
    const localRef = useRef<HTMLInputElement>(null)
    const setRef = (el: HTMLInputElement | null) => {
      localRef.current = el
      if (typeof externalRef === 'function') externalRef(el)
      else if (externalRef) (externalRef as React.MutableRefObject<HTMLInputElement | null>).current = el
      const ipRef = inputProps?.ref
      if (typeof ipRef === 'function') ipRef(el)
      else if (ipRef) (ipRef as React.MutableRefObject<HTMLInputElement | null>).current = el
    }

    const open = () => {
      if (disabled || inputProps?.disabled) return
      const el = localRef.current
      if (!el) return
      // showPicker는 사용자 제스처 안에서만 동작 — 버튼 onClick에서 호출하면 OK
      type WithShowPicker = HTMLInputElement & { showPicker?: () => void }
      const withPicker = el as WithShowPicker
      if (typeof withPicker.showPicker === 'function') {
        try { withPicker.showPicker(); return } catch { /* fallback */ }
      }
      el.focus()
    }

    const dow = value ? dowKo(value) : ''
    const hasValue = !!value

    return (
      <button
        type="button"
        onClick={open}
        disabled={disabled || inputProps?.disabled}
        aria-label={ariaLabel ?? '날짜 선택'}
        className={cn(
          'relative inline-flex items-center justify-between rounded-[10px] border bg-surface',
          'border-border-strong hover:border-text-muted transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/20 focus-visible:border-primary-500',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          SIZE_CLASS[size],
          className,
        )}
      >
        <span className="flex items-center gap-1.5 min-w-0">
          <span className={cn('tabular-nums truncate', !hasValue && 'text-text-muted')}>
            {value || placeholder}
          </span>
          {dow && <span className="text-text-muted shrink-0">({dow})</span>}
        </span>
        <Calendar className="h-4 w-4 text-text-muted ml-2 shrink-0" aria-hidden />
        {/* 실제 native date input — 시각적으로 숨기고 picker만 사용 */}
        <input
          {...inputProps}
          ref={setRef}
          id={id ?? inputProps?.id}
          name={name ?? inputProps?.name}
          type="date"
          value={value}
          min={min ?? inputProps?.min}
          max={max ?? inputProps?.max}
          disabled={disabled || inputProps?.disabled}
          tabIndex={-1}
          aria-hidden
          onChange={e => {
            inputProps?.onChange?.(e)
            onChange?.(e.target.value)
          }}
          className="sr-only"
        />
      </button>
    )
  },
)

export default DateInputWithDow
