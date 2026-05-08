'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ExternalLink } from 'lucide-react'
import { cn } from '@/lib/utils/cn'

const EW_URL = 'https://working.univ.me/Home'
const NPM_URL = 'https://intra.univ.me/Approval/AprCreateDoc'

export interface NavbarLinksProps {
  links: Array<{ href: string; label: string }>
}

/**
 * Navbar의 메뉴 영역(클라이언트). active 상태 표시를 위해 분리.
 * Layout: desktop은 inline 링크 + border-bottom, mobile은 가로 스크롤 chip.
 */
export default function NavbarLinks({ links }: NavbarLinksProps) {
  const pathname = usePathname() || ''

  const isActive = (href: string) => {
    if (pathname === href) return true
    // /home 등 정확 일치 외에는 startsWith로 하위 경로 포함
    if (href !== '/' && pathname.startsWith(href + '/')) return true
    return false
  }

  return (
    <>
      {/* Desktop links */}
      <div className="hidden sm:flex sm:items-center sm:gap-1 sm:ml-2">
        {links.map(({ href, label }) => {
          const active = isActive(href)
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'relative inline-flex items-center h-16 px-3 text-sm transition-colors',
                active
                  ? 'text-primary-600 font-semibold'
                  : 'text-text-secondary hover:text-text-primary font-medium',
              )}
            >
              {label}
              {active ? (
                <span
                  className="absolute left-3 right-3 bottom-0 h-0.5 bg-primary-600 rounded-full"
                  aria-hidden
                />
              ) : null}
            </Link>
          )
        })}
        <ExternalNavLink href={EW_URL}>EW 바로가기</ExternalNavLink>
        <ExternalNavLink href={NPM_URL}>NPM 바로가기</ExternalNavLink>
      </div>

      {/* Mobile horizontal chip nav */}
      <div className="sm:hidden -mx-4 mt-0 border-t border-border bg-surface">
        <div className="flex overflow-x-auto px-4 py-2 gap-1.5 scrollbar-hide">
          {links.map(({ href, label }) => {
            const active = isActive(href)
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  'inline-flex items-center h-9 px-3 rounded-full text-[13px] font-medium whitespace-nowrap transition-colors shrink-0',
                  active
                    ? 'bg-primary-50 text-primary-600 font-semibold'
                    : 'text-text-secondary hover:bg-surface-muted',
                )}
              >
                {label}
              </Link>
            )
          })}
          <a
            href={EW_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 h-9 px-3 rounded-full text-[13px] font-medium whitespace-nowrap text-primary-600 hover:bg-primary-50 transition-colors shrink-0"
          >
            EW 바로가기
            <ExternalLink className="h-3 w-3" aria-hidden />
          </a>
          <a
            href={NPM_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 h-9 px-3 rounded-full text-[13px] font-medium whitespace-nowrap text-primary-600 hover:bg-primary-50 transition-colors shrink-0"
          >
            NPM 바로가기
            <ExternalLink className="h-3 w-3" aria-hidden />
          </a>
        </div>
      </div>
    </>
  )
}

function ExternalNavLink({
  href,
  children,
}: {
  href: string
  children: React.ReactNode
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 h-16 px-3 text-sm font-medium text-primary-600 hover:text-primary-700 transition-colors"
    >
      {children}
      <ExternalLink className="h-3.5 w-3.5" aria-hidden />
    </a>
  )
}
