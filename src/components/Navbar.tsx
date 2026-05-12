import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { LogOut } from 'lucide-react'
import { isBootstrapAdmin } from '@/lib/admin-check'
import NClickLogo from '@/components/NClickLogo'
import NavbarLinks from '@/components/NavbarLinks'

export default async function Navbar() {
  const supabase = await createClient()

  // getSession() — 쿠키 로컬 read (네트워크 X). userId 즉시 확보.
  const sessionResult = await supabase.auth.getSession()
  const session = sessionResult.data.session
  if (!session?.user?.id) return null

  // 인증 검증(getUser) + 프로필 쿼리를 병렬화 — 직렬이었던 2 round-trip을 1 max로 단축.
  const [userResult, profileResult] = await Promise.all([
    supabase.auth.getUser(),
    supabase
      .from('user_profiles')
      .select('role, display_name')
      .eq('id', session.user.id)
      .single(),
  ])
  const user = userResult.data.user
  if (!user) return null

  let isAdmin = isBootstrapAdmin(user.email)
  let isLeader = false
  let displayName = ''
  try {
    const profile = profileResult.data
    if (!profileResult.error && profile) {
      if (!isAdmin) isAdmin = profile.role === 'admin'
      isLeader = profile.role === 'leader'
      displayName = (profile.display_name || '').trim()
    }
  } catch (err) {
    console.warn('[Navbar] profile fetch failed', err)
  }
  // 이름이 없으면 '게스트' (이메일은 노출하지 않음)
  const headerLabel = displayName || '게스트'

  const navLinks = [
    { href: '/home',    label: 'MY PAGE' },
    { href: '/team',    label: '둘러보기' },
    { href: '/history', label: '제출 내역' },
    ...((isAdmin || isLeader) ? [{ href: '/work-hours', label: '근로시간 관리' }] : []),
    ...(isAdmin ? [{ href: '/admin', label: '관리자' }] : []),
  ]

  return (
    <nav className="bg-surface border-b border-border">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* 상단 행 — 로고 + desktop 메뉴 + 우측 사용자 정보 */}
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center min-w-0">
            <Link href="/home" className="flex items-center shrink-0" aria-label="N-Click 홈">
              <NClickLogo className="h-8 w-auto" />
            </Link>
            {/* desktop 메뉴만 상단 행에 (sm 이상) */}
            <NavbarLinks links={navLinks} placement="desktop" />
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <span
              className="hidden sm:block text-sm text-text-secondary"
              title={displayName ? '' : '이름 미등록'}
            >
              {headerLabel}
            </span>
            <form action={async () => {
              'use server'
              const supabaseServer = await createClient()
              await supabaseServer.auth.signOut()
              redirect('/login')
            }}>
              <button
                type="submit"
                className="inline-flex items-center justify-center h-9 w-9 rounded-[10px] text-text-muted hover:text-text-primary hover:bg-surface-muted transition-colors"
                title="로그아웃"
                aria-label="로그아웃"
              >
                <LogOut className="h-4 w-4" aria-hidden />
              </button>
            </form>
          </div>
        </div>
      </div>
      {/* 모바일 chip nav — 상단 행 아래 별도 블록 (sm 미만에서만 표시, 가로 스크롤) */}
      <NavbarLinks links={navLinks} placement="mobile" />
    </nav>
  )
}
