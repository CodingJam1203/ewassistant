import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { LogOut } from 'lucide-react'
import { ADMIN_EMAIL } from '@/lib/admin-check'

export default async function Navbar() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) return null

  // 관리자 여부: 이메일 OR role (테이블 미생성 시 에러 무시)
  let isAdmin = user.email === ADMIN_EMAIL
  if (!isAdmin) {
    try {
      const { data: profile } = await supabase
        .from('user_profiles')
        .select('role')
        .eq('id', user.id)
        .single()
      isAdmin = profile?.role === 'admin'
    } catch {
      // user_profiles 테이블 미생성 시 무시
    }
  }

  const navLinks = [
    { href: '/team',    label: '팀원 둘러보기' },
    { href: '/my-logs', label: '내 제출 내역' },
    { href: '/history', label: '전체 제출 내역' },
    ...(isAdmin ? [{ href: '/admin', label: '관리자' }] : []),
  ]

  return (
    <nav className="bg-white shadow-sm border-b border-gray-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16">
          <div className="flex">
            <div className="flex-shrink-0 flex items-center">
              <Link href="/team" className="text-xl font-bold text-blue-600 hover:text-blue-700 transition-colors">
                EW Assistant
              </Link>
            </div>
            <div className="hidden sm:ml-6 sm:flex sm:space-x-8">
              {navLinks.map(({ href, label }) => (
                <Link
                  key={href}
                  href={href}
                  className="border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium transition-colors"
                >
                  {label}
                </Link>
              ))}
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
      <div className="sm:hidden flex overflow-x-auto border-t border-gray-100 py-2 px-4 space-x-4">
        {navLinks.map(({ href, label }) => (
          <Link key={href} href={href} className="text-sm font-medium text-gray-600 whitespace-nowrap">
            {label}
          </Link>
        ))}
      </div>
    </nav>
  )
}
