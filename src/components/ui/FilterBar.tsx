import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from '@/lib/utils/cn'

export interface FilterBarProps extends HTMLAttributes<HTMLDivElement> {
  children?: ReactNode
}

/**
 * 페이지 상단 필터/도구막대.
 * - 흰색 카드형 컨테이너 + radius xl + padding 16
 * - 자식은 `<FilterBar.Field label="...">…</FilterBar.Field>` 형태로 묶어 사용 (또는 자유 배치)
 */
export function FilterBar({ children, className, ...props }: FilterBarProps) {
  return (
    <div
      className={cn(
        'bg-surface border border-border rounded-2xl shadow-[var(--shadow-card)]',
        'p-4',
        className,
      )}
      {...props}
    >
      <div className="flex flex-wrap items-end gap-3">{children}</div>
    </div>
  )
}

export interface FilterFieldProps {
  label?: ReactNode
  htmlFor?: string
  className?: string
  children: ReactNode
}

function FilterField({ label, htmlFor, className, children }: FilterFieldProps) {
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      {label ? (
        <label
          htmlFor={htmlFor}
          className="text-[12px] font-semibold text-text-secondary"
        >
          {label}
        </label>
      ) : null}
      {children}
    </div>
  )
}

FilterBar.Field = FilterField
