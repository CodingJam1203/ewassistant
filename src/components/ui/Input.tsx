'use client'

import { forwardRef } from 'react'
import type { InputHTMLAttributes, SelectHTMLAttributes, ReactNode } from 'react'
import { cn } from '@/lib/utils/cn'

const FIELD_BASE = cn(
  'block w-full rounded-[10px] border border-border-strong bg-surface',
  'text-sm text-text-primary placeholder:text-text-muted',
  'transition-colors',
  'focus:outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20',
  'disabled:bg-surface-muted disabled:text-text-disabled disabled:cursor-not-allowed',
)

const FIELD_SIZE = {
  sm: 'h-9 px-3 py-1.5 text-[13px]',
  md: 'h-10 px-3 py-2 text-sm',
  lg: 'h-12 px-3.5 py-2.5 text-base',
} as const

type FieldSize = keyof typeof FIELD_SIZE

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  inputSize?: FieldSize
  invalid?: boolean
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { inputSize = 'md', invalid, className, ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      className={cn(
        FIELD_BASE,
        FIELD_SIZE[inputSize],
        invalid && 'border-danger-text focus:border-danger-text focus:ring-danger-text/20',
        className,
      )}
      {...props}
    />
  )
})

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  selectSize?: FieldSize
  invalid?: boolean
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { selectSize = 'md', invalid, className, children, ...props },
  ref,
) {
  return (
    <select
      ref={ref}
      className={cn(
        'select-tight',
        FIELD_BASE,
        FIELD_SIZE[selectSize],
        invalid && 'border-danger-text focus:border-danger-text focus:ring-danger-text/20',
        className,
      )}
      {...props}
    >
      {children}
    </select>
  )
})

/** 폼 라벨 + 필드 + 에러를 한 묶음으로 */
export interface FieldProps {
  label: ReactNode
  htmlFor?: string
  hint?: ReactNode
  error?: ReactNode
  required?: boolean
  children: ReactNode
  className?: string
}

export function Field({ label, htmlFor, hint, error, required, children, className }: FieldProps) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <label htmlFor={htmlFor} className="block text-[12px] font-semibold text-text-secondary">
        {label}
        {required ? <span className="text-danger-text ml-0.5" aria-hidden>*</span> : null}
      </label>
      {children}
      {hint && !error ? <p className="text-[12px] text-text-muted">{hint}</p> : null}
      {error ? <p className="text-[12px] text-danger-text">{error}</p> : null}
    </div>
  )
}
