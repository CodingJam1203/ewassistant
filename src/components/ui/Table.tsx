import type { HTMLAttributes, ThHTMLAttributes, TdHTMLAttributes, ReactNode } from 'react'
import { cn } from '@/lib/utils/cn'

/**
 * 디자인 시스템 테이블 셸.
 *
 * 권장 사용:
 *   <TableContainer>
 *     <TableScroll>
 *       <Table>
 *         <thead><tr><Th>...</Th></tr></thead>
 *         <tbody><tr><Td>...</Td></tr></tbody>
 *       </Table>
 *     </TableScroll>
 *     <Pagination ... />            ← 스크롤 영역 밖. 가로 스크롤에 휩쓸리지 않음.
 *   </TableContainer>
 *
 * `TableScroll`이 가로 스크롤을 담당하므로 Pagination이나 헤더 바 같은 형제 노드는
 * 스크롤되지 않는다. 모바일에서도 동일.
 */

export function TableContainer({
  className,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'bg-surface border border-border rounded-2xl shadow-[var(--shadow-card)]',
        'overflow-hidden',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  )
}

/** Table을 직접 감싸 가로 스크롤 처리. Pagination/툴바는 이 바깥에 둔다. */
export function TableScroll({
  className,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('overflow-x-auto', className)} {...props}>
      {children}
    </div>
  )
}

export function Table({
  className,
  children,
  ...props
}: HTMLAttributes<HTMLTableElement>) {
  return (
    <table
      className={cn(
        // min-w-full + content-driven 폭. 컨테이너의 overflow-x-auto가 가로 스크롤을 처리.
        // (w-full을 쓰면 컬럼이 컨테이너 폭에 맞춰 압축되어 셀 텍스트가 강제 줄바꿈됨)
        'min-w-full border-collapse text-[13px] text-text-primary',
        className,
      )}
      {...props}
    >
      {children}
    </table>
  )
}

export function Th({
  className,
  children,
  ...props
}: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={cn(
        'sticky top-0 z-10',
        'bg-background',
        'border-b border-border',
        'px-3 py-2.5',
        'text-left text-[12px] font-semibold text-text-secondary',
        'whitespace-nowrap',
        className,
      )}
      {...props}
    >
      {children}
    </th>
  )
}

export interface TdProps extends TdHTMLAttributes<HTMLTableCellElement> {
  numeric?: boolean
  muted?: boolean
  /**
   * 기본값 false — 셀은 `whitespace-nowrap`. 즉 텍스트가 한 줄에 유지되고
   * 너비가 부족하면 컬럼이 넓어져 가로 스크롤이 생긴다.
   * `wrap`을 true로 주면 셀 안에서 자연 줄바꿈을 허용 (예: 변경 필드 목록).
   */
  wrap?: boolean
}

export function Td({ className, numeric, muted, wrap, children, ...props }: TdProps) {
  return (
    <td
      className={cn(
        'border-b border-border',
        'px-3 py-2',
        'align-middle text-[13px]',
        !wrap && 'whitespace-nowrap',
        muted && 'text-text-muted',
        numeric && 'tabular-nums',
        className,
      )}
      {...props}
    >
      {children}
    </td>
  )
}

export function TableEmpty({
  colSpan,
  children,
  className,
}: {
  colSpan: number
  children?: ReactNode
  className?: string
}) {
  return (
    <tr>
      <td
        colSpan={colSpan}
        className={cn(
          'px-4 py-12 text-center text-[13px] text-text-muted',
          className,
        )}
      >
        {children ?? '데이터가 없습니다.'}
      </td>
    </tr>
  )
}

/** body 행에 hover 효과를 주는 className 헬퍼 — 모든 tbody tr에 적용 권장 */
export const TR_HOVER = 'hover:bg-surface-muted transition-colors'
