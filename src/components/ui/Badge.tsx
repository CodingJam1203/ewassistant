import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from '@/lib/utils/cn'

export type BadgeVariant = 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'primary'

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant
  /** 좌측 dot 표시 (status indicator) */
  dot?: boolean
  children?: ReactNode
}

const VARIANT: Record<BadgeVariant, string> = {
  success: 'bg-success-bg text-success-text border-success-border',
  warning: 'bg-warning-bg text-warning-text border-warning-border',
  danger:  'bg-danger-bg  text-danger-text  border-danger-border',
  info:    'bg-info-bg    text-info-text    border-info-border',
  primary: 'bg-primary-50 text-primary-600 border-primary-200',
  neutral: 'bg-surface-muted text-text-secondary border-border',
}

const DOT: Record<BadgeVariant, string> = {
  success: 'bg-success-text',
  warning: 'bg-warning-text',
  danger:  'bg-danger-text',
  info:    'bg-info-text',
  primary: 'bg-primary-600',
  neutral: 'bg-text-muted',
}

export default function Badge({
  variant = 'neutral',
  dot,
  className,
  children,
  ...props
}: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5',
        'h-6 px-2.5',
        'rounded-full border',
        'text-[12px] font-semibold leading-none whitespace-nowrap',
        VARIANT[variant],
        className,
      )}
      {...props}
    >
      {dot ? (
        <span className={cn('inline-block h-1.5 w-1.5 rounded-full', DOT[variant])} aria-hidden />
      ) : null}
      {children}
    </span>
  )
}
