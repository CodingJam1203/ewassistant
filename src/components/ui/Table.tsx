import type { HTMLAttributes, ThHTMLAttributes, TdHTMLAttributes, ReactNode } from 'react'
import { cn } from '@/lib/utils/cn'

/**
 * 디자인 시스템 테이블 셸.
 *
 * 사용 예:
 *   <TableContainer>
 *     <Table>
 *       <thead><tr><Th>...</Th></tr></thead>
 *       <tbody><tr><Td>...</Td></tr></tbody>
 *     </Table>
 *   </TableContainer>
 *
 * 모바일에서는 `<TableContainer>`가 가로 스크롤을 처리. 페이지에서 카드 fallback이
 * 필요하면 별도 분기.
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
      <div className="overflow-x-auto">{children}</div>
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
        'w-full border-collapse text-[13px] text-text-primary',
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
        'px-4 py-3',
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
}

export function Td({ className, numeric, muted, children, ...props }: TdProps) {
  return (
    <td
      className={cn(
        'border-b border-border',
        'px-4 py-3',
        'align-middle text-[13px]',
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
