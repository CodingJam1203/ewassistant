import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export default async function BlockedPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  // 로그인 안 된 경우 로그인 페이지로
  if (!user) redirect('/login')

  const handleSignOut = async () => {
    'use server'
    const supabaseServer = await createClient()
    await supabaseServer.auth.signOut()
    redirect('/login')
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col justify-center items-center px-4">
      <div className="max-w-md w-full bg-white rounded-xl shadow-sm border border-gray-200 p-8 text-center space-y-6">
        <div className="flex justify-center">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center">
            <svg className="w-8 h-8 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            </svg>
          </div>
        </div>

        <div>
          <h1 className="text-xl font-bold text-gray-900">비활성화된 계정</h1>
          <p className="mt-2 text-sm text-gray-500">
            비활성화된 계정입니다. 관리자에게 문의해주세요.
          </p>
          <p className="mt-1 text-xs text-gray-400">{user.email}</p>
        </div>

        <form action={handleSignOut}>
          <button
            type="submit"
            className="w-full py-2 px-4 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 transition-colors"
          >
            로그아웃
          </button>
        </form>
      </div>
    </div>
  )
}
