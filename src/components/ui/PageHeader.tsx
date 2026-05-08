import type { ReactNode } from 'react'
import { cn } from '@/lib/utils/cn'

export interface PageHeaderProps {
  title: ReactNode
  description?: ReactNode
  /** 우측 액션 버튼 슬롯 (Button 등을 직접 children으로) */
  actions?: ReactNode
  className?: string
}

/**
 * 페이지 상단 헤더 (h1 + 설명 + 우측 액션).
 *
 * 모바일에서 actions는 자동으로 줄바꿈되어 아래로 떨어짐.
 */
export function PageHeader({ title, description, actions, className }: PageHeaderProps) {
  return (
    <div
      className={cn(
        'flex flex-col gap-3',
        'sm:flex-row sm:items-end sm:justify-between sm:gap-6',
        className,
      )}
    >
      <div className="min-w-0">
        <h1 className="text-2xl sm:text-[28px] font-bold leading-tight tracking-tight text-text-primary">
          {title}
        </h1>
        {description ? (
          <p className="mt-1.5 text-sm text-text-secondary">{description}</p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex flex-wrap items-center gap-2 sm:shrink-0">{actions}</div>
      ) : null}
    </div>
  )
}
