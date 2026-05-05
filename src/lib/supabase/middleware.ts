import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

const CURRENT_TERMS_VERSION   = '2026.1'
const CURRENT_PRIVACY_VERSION = '2026.1'

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll() },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl
  const isAuthRoute    = pathname.startsWith('/login') || pathname.startsWith('/auth')
  const isBlockedRoute = pathname === '/blocked'
  const isApiRoute     = pathname.startsWith('/api')
  const isConsentRoute = pathname === '/consent'
  const isPolicyRoute  = pathname === '/terms' || pathname === '/privacy'

  // 비로그인 → 로그인 페이지로
  if (!user && !isAuthRoute && !isApiRoute && !isPolicyRoute) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  // 이미 로그인된 상태에서 /login 접근 → /team으로
  if (user && pathname === '/login') {
    const url = request.nextUrl.clone()
    url.pathname = '/team'
    return NextResponse.redirect(url)
  }

  // 로그인된 상태에서 접근 제한 체크 (예외 라우트 제외)
  if (user && !isAuthRoute && !isBlockedRoute && !isApiRoute && !isPolicyRoute && !isConsentRoute) {
    try {
      const { data: profile } = await supabase
        .from('user_profiles')
        .select('is_active, terms_version, privacy_version')
        .eq('id', user.id)
        .single()

      if (profile) {
        // 1. 약관 미동의 또는 구버전 → /consent 먼저 (잠금 계정도 