import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { LogOut, ExternalLink } from 'lucide-react'
import { ADMIN_EMAIL } from '@/lib/admin-check'
import NClickLogo from '@/components/NClickLogo'

const EW_URL = 'https://working.univ.me/Home'

export default async function Navbar() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) return null

  let isAdmin = user.email === ADMIN_EMAIL
  if (!isAdmin) {
    try {
      const { data: profile } = await supabase
        .from('user_profiles')
        .select('role')
        .eq('id', user.id)
        .single()
      isAdmin = profile?.role === 'admin'
    } catch {}
  }

  const navLinks = [
    { href: '/team',    label: '상태 둘러보기' },
    { href: '/my-logs', label: 'My Page' },
    { href: '/history', label: '전체 제출 내역' },
    ...(isAdmin ? [{ href: '/admin', label: '관리자' }] : []),
  ]

  return (
    <nav className="bg-white dark:bg-gray-900 shadow-sm border-b border-gray-200 dark:border-gray-700">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16">
          <div className="flex">
            <div className="flex-shrink-0 flex items-center">
              <Link href="/team" className="flex items-center">
                <NClickLogo className="h-8 w-auto" />
              </Link>
            </div>
            <div className="hidden sm:ml-6 sm:flex sm:space-x-8">
              {navLinks.map(({ href, label }) => (
                <Link
                  key={href}
                  href={href}
                  className="border-transparent text-gray-500 dark:text-gray-400 hover:border-gray-300 hover:text-gray-700 dark:hover:text-gray-200 inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium transition-colors"
                >
                  {label}
                </Link>
              ))}
              <a
                href={EW_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="border-transparent text-blue-500 hover:text-blue-700 inline-flex items-center gap-1 px-1 pt-1 border-b-2 text-sm font-medium transition-colors"
              >
                EW 바로가기
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          </div>
          <div className="flex items-center space-x-4">
            <span className="text-sm text-gray-700 hidden sm:block">{user.email}</span>
            <form action={async () => {
              'use server'
              const supabaseServer = await createClient()
              await supabaseServer.auth.signOut()
              redirect('/login')
            }}>
              <button type="submit" className="text-gray-500 hover:text-gray-700 p-2" title="로그아웃">
                <LogOut className="h-5 w-5" />
              </button>
            </form>
          </div>
        </div>
      </div>
      {/* Mobile nav */}
      <div className="sm:hidden flex overflow-x-auto border-t border-gray-100 dark:border-gray-700 py-2 px-4 space-x-4">
        {navLinks.map(({ href, label }) => (
          <Link key={href} href={href} className="text-sm font-medium text-gray-600 dark:text-gray-300 whitespace-nowrap">
            {label}
          </Link>
        ))}
        <a
          href={EW_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm font-medium text-blue-600 whitespace-nowrap flex items-center gap-1"
        >
          EW 바로가기
          <ExternalLink className="h-3 w-3" />
        </a>
      </div>
    </nav>
  )
}
