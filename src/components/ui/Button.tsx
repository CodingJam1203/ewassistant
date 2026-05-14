'use client'

import { forwardRef } from 'react'
import type { ButtonHTMLAttributes } from 'react'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils/cn'

export type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'ghost'
  | 'danger'
  | 'danger-soft'
  | 'warning-soft'

export type ButtonSize = 'sm' | 'md' | 'lg'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  /** true이면 spinner + disabled 처리 */
  loading?: boolean
  /** 아이콘만 들어있는 정사각형 버튼 (32/40/48 width=height) */
  iconOnly?: boolean
  /** 버튼을 부모 폭만큼 채우기 */
  fullWidth?: boolean
  /** 외부 form ID에 연결 (예: 모달 우측 sticky 제출 버튼) */
  form?: string
}

const SIZE: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-[13px]',
  md: 'h-10 px-4 text-sm',
  lg: 'h-12 px-5 text-base',
}

const SIZE_ICON_ONLY: Record<ButtonSize, string> = {
  sm: 'h-8 w-8 p-0',
  md: 'h-10 w-10 p-0',
  lg: 'h-12 w-12 p-0',
}

const VARIANT: Record<ButtonVariant, string> = {
  primary: cn(
    'bg-primary-600 text-white border border-transparent',
    'hover:bg-primary-700',
    'active:bg-primary-700',
    'disabled:bg-primary-600/50 disabled:cursor-not-allowed',
  ),
  secondary: cn(
    'bg-surface text-text-primary border border-border-strong',
    'hover:bg-surface-muted',
    'disabled:bg-surface-muted disabled:text-text-disabled disabled:border-border disabled:cursor-not-allowed',
  ),
  ghost: cn(
    'bg-transparent text-text-secondary border border-transparent',
    'hover:bg-surface-muted hover:text-text-primary',
    'disabled:text-text-disabled disabled:cursor-not-allowed',
  ),
  danger: cn(
    'bg-danger-text text-white border border-transparent',
    'hover:bg-[#B91C1C]',
    'disabled:opacity-60 disabled:cursor-not-allowed',
  ),
  'danger-soft': cn(
    'bg-danger-bg text-danger-text border border-danger-border',
    'hover:bg-danger-bg/70',
    'disabled:opacity-60 disabled:cursor-not-allowed',
  ),
  'warning-soft': cn(
    'bg-warning-bg text-warning-text border border-warning-border',
    'hover:bg-warning-bg/70',
    'disabled:opacity-60 disabled:cursor-not-allowed',
  ),
}

const BASE = cn(
  'inline-flex items-center justify-center gap-1.5',
  'rounded-[10px]',
  'font-medium',
  'transition-colors',
  'select-none',
  'whitespace-nowrap',
  'cursor-pointer',
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-primary-500',
)

const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'secondary',
    size = 'md',
    loading,
    iconOnly,
    fullWidth,
    disabled,
    className,
    children,
    type = 'button',
    ...props
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={cn(
        BASE,
        iconOnly ? SIZE_ICON_ONLY[size] : SIZE[size],
        VARIANT[variant],
        fullWidth && 'w-full',
        className,
      )}
      {...props}
    >
      {loading ? (
        <Loader2 className={cn(iconOnly ? '' : 'mr-1', 'h-4 w-4 animate-spin')} aria-hidden />
      ) : null}
      {children}
    </button>
  )
})

export default Button
