'use client'

/**
 * 날짜 input — 트리거 button + popover 캘린더 (react-day-picker 기반).
 *
 * Mac native <input type="date"> picker가 자동 닫히지 않는 문제를 해결하기 위해
 * react-day-picker로 교체. 선택 즉시 닫힘 / 외부 클릭 닫힘 / ESC 닫힘 일관 동작.
 *
 * Props 인터페이스는 기존 native 버전과 호환 — 호출부 수정 불필요.
 *   - value (YYYY-MM-DD), onChange (next: string)
 *   - inputProps (RHF register 결과 spread — hidden input에 전달돼서 form submit 포함됨)
 *   - min/max (YYYY-MM-DD), disabled, size, className 등
 */

import React, { forwardRef, useEffect, useMemo, useRef, useState } from 'react'
import { DayPicker } from 'react-day-picker'
import { ko } from 'date-fns/locale'
import { format, parseISO } from 'date-fns'
import { Calendar } from 'lucide-react'
import { dowKo } from '@/lib/utils/date'
import { cn } from '@/lib/utils/cn'
import 'react-day-picker/style.css'

type Size = 'sm' | 'md'

export interface DateInputWithDowProps {
  /** YYYY-MM-DD 형식 — 없으면 placeholder 표시 */
  value?: string
  /** 변경 콜백 — value를 직접 전달받음 */
  onChange?: (next: string) => void
  /** RHF register 결과 등 (hidden input에 spread). ref도 받음. */
  inputProps?: React.InputHTMLAttributes<HTMLInputElement> & {
    ref?: React.Ref<HTMLInputElement>
  }
  className?: string
  size?: Size
  disabled?: boolean
  min?: string
  max?: string
  placeholder?: string
  ariaLabel?: string
  id?: string
  name?: string
}

const SIZE_CLASS: Record<Size, string> = {
  sm: 'h-8 px-2.5 text-[12px]',
  md: 'h-10 px-3 text-sm',
}

function parseYMD(s: string | undefined): Date | null {
  if (!s) return null
  try {
    const d = parseISO(s)
    return isNaN(d.getTime()) ? null : d
  } catch {
    return null
  }
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
    const [open, setOpen] = useState(false)
    const containerRef = useRef<HTMLDivElement>(null)
    const inputRef = useRef<HTMLInputElement>(null)
    const setRef = (el: HTMLInputElement | null) => {
      inputRef.current = el
      if (typeof externalRef === 'function') externalRef(el)
      else if (externalRef) (externalRef as React.MutableRefObject<HTMLInputElement | null>).current = el
      const ipRef = inputProps?.ref
      if (typeof ipRef === 'function') ipRef(el)
      else if (ipRef) (ipRef as React.MutableRefObject<HTMLInputElement | null>).current = el
    }

    // 외부 클릭 / ESC 닫힘
    useEffect(() => {
      if (!open) return
      const handleClick = (e: MouseEvent) => {
        if (!containerRef.current?.contains(e.target as Node)) setOpen(false)
      }
      const handleKey = (e: KeyboardEvent) => {
        if (e.key === 'Escape') setOpen(false)
      }
      document.addEventListener('mousedown', handleClick)
      document.addEventListener('keydown', handleKey)
      return () => {
        document.removeEventListener('mousedown', handleClick)
        document.removeEventListener('keydown', handleKey)
      }
    }, [open])

    const isDisabled = !!(disabled || inputProps?.disabled)
    const dow = value ? dowKo(value) : ''
    const hasValue = !!value

    const selectedDate = useMemo(() => parseYMD(value), [value])
    const minDate = useMemo(() => parseYMD(min), [min])
    const maxDate = useMemo(() => parseYMD(max), [max])

    const handleSelect = (date: Date | undefined) => {
      if (!date) return
      const s = format(date, 'yyyy-MM-dd')
      // RHF register의 onChange 호환
      if (inputProps?.onChange) {
        const ev = {
          target: { value: s, name: name ?? inputProps.name ?? '' },
          currentTarget: { value: s, name: name ?? inputProps.name ?? '' },
        } as unknown as React.ChangeEvent<HTMLInputElement>
        inputProps.onChange(ev)
      }
      onChange?.(s)
      setOpen(false)
    }

    return (
      <div ref={containerRef} className={cn('relative inline-block', className)}>
        <button
          type="button"
          onClick={() => !isDisabled && setOpen(o => !o)}
          disabled={isDisabled}
          aria-label={ariaLabel ?? '날짜 선택'}
          aria-expanded={open}
          aria-haspopup="dialog"
          className={cn(
            'w-full inline-flex items-center justify-between rounded-[10px] border bg-surface',
            'border-border-strong hover:border-text-muted transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/20 focus-visible:border-primary-500',
            'disabled:opacity-50 disabled:cursor-not-allowed',
            SIZE_CLASS[size],
          )}
        >
          <span className="flex items-center gap-1.5 min-w-0">
            <span className={cn('tabular-nums truncate', !hasValue && 'text-text-muted')}>
              {value || placeholder}
            </span>
            {dow && <span className="text-text-muted shrink-0">({dow})</span>}
          </span>
          <Calendar className="h-4 w-4 text-text-muted ml-2 shrink-0" aria-hidden />
        </button>

        {/* hidden input — RHF register / form submit 호환 */}
        <input
          {...inputProps}
          ref={setRef}
          id={id ?? inputProps?.id}
          name={name ?? inputProps?.name}
          type="hidden"
          value={value ?? ''}
          onChange={() => { /* hidden — 변경은 popover 선택으로만 */ }}
          disabled={isDisabled}
        />

        {open && (
          <div
            role="dialog"
            className="absolute z-[100] mt-1 left-0 rounded-[10px] border border-border-strong bg-surface shadow-lg p-2"
          >
            <DayPicker
              mode="single"
              locale={ko}
              selected={selectedDate ?? undefined}
              onSelect={handleSelect}
              disabled={[
                ...(minDate ? [{ before: minDate }] : []),
                ...(maxDate ? [{ after: maxDate }] : []),
              ]}
              showOutsideDays
              weekStartsOn={0}
            />
          </div>
        )}
      </div>
    )
  },
)

export default DateInputWithDow
