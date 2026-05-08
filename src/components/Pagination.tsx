'use client'

/**
 * Pagination
 * - 클라이언트 측 in-memory 페이지네이션 컨트롤
 * - 페이지 번호 / 이전·다음 / 페이지당 개수(select) / 총 N건 표시
 *
 * 부모는 page, pageSize state와 totalCount만 넘기면 됨.
 * 데이터 슬라이싱은 부모에서 처리:
 *   const start = (page - 1) * pageSize
 *   const paged = filtered.slice(start, start + pageSize)
 *
 * 필터/정렬이 변경됐을 때 page를 1로 리셋하는 책임은 부모에게 있음.
 */

import { ChevronLeft, ChevronRight } from 'lucide-react'

interface PaginationProps {
  totalCount: number
  page: number              // 1-based
  pageSize: number
  onPageChange: (next: number) => void
  onPageSizeChange?: (next: number) => void
  pageSizeOptions?: number[]
  /** 좌측 라벨 prefix (기본: "총") — "총 124건" */
  totalLabelPrefix?: string
  /** 단위 — "건", "명" 등 (기본: "건") */
  unit?: string
  className?: string
}

const DEFAULT_PAGE_SIZE_OPTIONS = [10, 25, 50, 100]

/** 표시할 페이지 번호 윈도우 (현재 페이지 기준 ±2) */
function buildPageWindow(current: number, totalPages: number): (number | '...')[] {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, i) => i + 1)
  }
  const arr: (number | '...')[] = []
  const left  = Math.max(2, current - 2)
  const right = Math.min(totalPages - 1, current + 2)
  arr.push(1)
  if (left > 2) arr.push('...')
  for (let p = left; p <= right; p++) arr.push(p)
  if (right < totalPages - 1) arr.push('...')
  arr.push(totalPages)
  return arr
}

export default function Pagination({
  totalCount,
  page,
  pageSize,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = DEFAULT_PAGE_SIZE_OPTIONS,
  totalLabelPrefix = '총',
  unit = '건',
  className,
}: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(totalCount / Math.max(1, pageSize)))
  const safePage = Math.min(Math.max(1, page), totalPages)
  const start = totalCount === 0 ? 0 : (safePage - 1) * pageSize + 1
  const end   = Math.min(totalCount, safePage * pageSize)

  const goPrev = () => onPageChange(Math.max(1, safePage - 1))
  const goNext = () => onPageChange(Math.min(totalPages, safePage + 1))
  const goTo   = (p: number) => onPageChange(Math.min(totalPages, Math.max(1, p)))

  const pages = buildPageWindow(safePage, totalPages)

  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-t border-border text-[12px] tabular-nums ${className ?? ''}`}
    >
      {/* 좌측: 총 건수 + 현재 표시 범위 */}
      <div className="text-text-secondary">
        {totalLabelPrefix} <span className="font-semibold text-text-primary">{totalCount.toLocaleString()}</span>{unit}
        {totalCount > 0 && (
          <span className="ml-2 text-text-muted">
            ({start.toLocaleString()}-{end.toLocaleString()})
          </span>
        )}
      </div>

      {/* 우측: 페이지 컨트롤 + page size */}
      <div className="flex items-center gap-3 flex-wrap">
        {onPageSizeChange && (
          <div className="flex items-center gap-1.5">
            <span className="text-text-secondary">페이지당</span>
            <select
              value={pageSize}
              onChange={(e) => {
                const next = Number(e.target.value)
                onPageSizeChange(next)
                onPageChange(1)
              }}
              className="select-tight h-7 rounded-[8px] border border-border-strong bg-surface px-2 text-[12px] focus:outline-none focus:border-primary-500"
            >
              {pageSizeOptions.map(n => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </div>
        )}

        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={goPrev}
            disabled={safePage <= 1}
            className="inline-flex items-center justify-center h-7 w-7 rounded-[8px] text-text-secondary hover:bg-surface-muted hover:text-text-primary disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
            title="이전 페이지"
            aria-label="이전 페이지"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden />
          </button>

          {pages.map((p, i) =>
            p === '...' ? (
              <span key={`dots-${i}`} className="px-1 text-text-muted select-none">…</span>
            ) : (
              <button
                key={p}
                type="button"
                onClick={() => goTo(p)}
                className={`min-w-[28px] h-7 px-2 rounded-[8px] text-[12px] font-medium transition-colors ${
                  p === safePage
                    ? 'bg-primary-600 text-white'
                    : 'text-text-secondary hover:bg-surface-muted hover:text-text-primary'
                }`}
                aria-current={p === safePage ? 'page' : undefined}
              >
                {p}
              </button>
            )
          )}

          <button
            type="button"
            onClick={goNext}
            disabled={safePage >= totalPages}
            className="inline-flex items-center justify-center h-7 w-7 rounded-[8px] text-text-secondary hover:bg-surface-muted hover:text-text-primary disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
            title="다음 페이지"
            aria-label="다음 페이지"
          >
            <ChevronRight className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </div>
    </div>
  )
}
