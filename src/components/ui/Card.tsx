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
  /** hover 시 살짝 떠올림 (클릭 가능한 카드) — border 색이 아니라 그림자로 강조 */
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
        interactive && 'transition-shadow hover:shadow-[var(--shadow-popover)] cursor-pointer',
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
  success: 'border-l-success-text',
  warning: 'border-l-warning-text',
  danger:  'border-l-danger-text',
  info:    'border-l-info-text',
  neutral: 'border-l-border-strong',
}

/**
 * 좌측에 semantic 색 띠를 가진 카드.
 *
 * `border-l-[5px]`로 좌측만 두꺼운 border를 적용하면 카드의 `rounded-2xl`을
 * 따라 좌상/좌하 모서리가 자연스럽게 깎인다. (이전 `before:` pseudo-element
 * 방식은 직각이라 어색했음.)
 *
 * hover는 색이 아니라 그림자로 — border-l 색상이 hover 때문에 흐트러지지 않게.
 */
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
        'bg-surface rounded-2xl',
        'border border-border border-l-[5px]',
        STATUS_BORDER[tone],
        shadow && 'shadow-[var(--shadow-card)]',
        PAD[padding],
        interactive && 'transition-shadow hover:shadow-[var(--shadow-popover)]',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  )
}
