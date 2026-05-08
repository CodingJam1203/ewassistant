import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from '@/lib/utils/cn'

type CardPadding = 'none' | 'sm' | 'md' | 'lg'
const PAD: Record<CardPadding, string> = {
  none: '',
  sm: 'p-4',
  md: 'p-5',
  lg: 'p-6',
}

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  padding?: CardPadding
  /** hover 시 primary border (예: 클릭 가능한 카드) */
  interactive?: boolean
  /** shadow 적용 여부 (기본 true) */
  shadow?: boolean
}

export function Card({
  padding = 'md',
  interactive,
  shadow = true,
  className,
  children,
  ...props
}: CardProps) {
  return (
    <div
      className={cn(
        'bg-surface border border-border rounded-2xl',
        shadow && 'shadow-[var(--shadow-card)]',
        PAD[padding],
        interactive && 'transition-colors hover:border-primary-200',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  )
}

/** 통계 카드 — 라벨 / 값 / (선택) hint */
export interface StatCardProps extends HTMLAttributes<HTMLDivElement> {
  label: ReactNode
  value: ReactNode
  hint?: ReactNode
  /** 값 색상 강조 — 기본 neutral. 의미 강조가 필요한 KPI에 사용. */
  tone?: 'neutral' | 'primary' | 'success' | 'warning' | 'danger'
  /** 좌측 작은 아이콘 슬롯 */
  icon?: ReactNode
}

const STAT_TONE: Record<NonNullable<StatCardProps['tone']>, string> = {
  neutral: 'text-text-primary',
  primary: 'text-primary-600',
  success: 'text-success-text',
  warning: 'text-warning-text',
  danger:  'text-danger-text',
}

export function StatCard({
  label,
  value,
  hint,
  tone = 'neutral',
  icon,
  className,
  ...props
}: StatCardProps) {
  return (
    <div
      className={cn(
        'bg-surface border border-border rounded-2xl shadow-[var(--shadow-card)]',
        'p-5',
        className,
      )}
      {...props}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-[12px] font-semibold tracking-tight text-text-secondary">{label}</p>
        {icon ? <span className="text-text-muted shrink-0">{icon}</span> : null}
      </div>
      <p className={cn('mt-2 text-2xl font-bold tabular-nums leading-none', STAT_TONE[tone])}>
        {value}
      </p>
      {hint ? <p className="mt-2 text-[12px] text-text-muted">{hint}</p> : null}
    </div>
  )
}

/** 좌측 4px semantic border가 들어간 상태 카드 */
export type StatusCardTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral'

export interface StatusCardProps extends Omit<CardProps, 'children'> {
  tone: StatusCardTone
  children?: ReactNode
}

const STATUS_BORDER: Record<StatusCardTone, string> = {
  success: 'before:bg-success-text',
  warning: 'before:bg-warning-text',
  danger:  'before:bg-danger-text',
  info:    'before:bg-info-text',
  neutral: 'before:bg-border-strong',
}

export function StatusCard({
  tone,
  padding = 'md',
  interactive,
  shadow = true,
  className,
  children,
  ...props
}: StatusCardProps) {
  return (
    <div
      className={cn(
        'relative bg-surface border border-border rounded-2xl overflow-hidden',
        shadow && 'shadow-[var(--shadow-card)]',
        // 좌측 4px semantic bar
        'before:content-[""] before:absolute before:left-0 before:top-0 before:bottom-0 before:w-1',
        STATUS_BORDER[tone],
        PAD[padding],
        interactive && 'transition-colors hover:border-primary-200',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  )
}
