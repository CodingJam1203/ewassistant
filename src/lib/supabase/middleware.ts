import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { withSessionCookieDefaults } from './cookie-options'

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
          // request side는 쿠키 값만 갱신 (옵션 무관)
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          // response side — 30일 maxAge + 보안 옵션 강제
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, withSessionCookieDefaults(options))
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
    let profile: {
      is_active: boolean | null
      terms_version: string | null
      privacy_version: string | null
    } | null = null
    let profileFetchFailed = false

    try {
      const { data, error } = await supabase
        .from('user_profiles')
        .select('is_active, terms_version, privacy_version')
        .eq('id', user.id)
        .single()
      if (error) {
        // PGRST116(row not found)은 신규 사용자 케이스 — fail-close로 /consent 이동
        profileFetchFailed = true
        console.warn('[middleware] profile fetch error', error.code, error.message)
      } else {
        profile = data
      }
    } catch (err) {
      profileFetchFailed = true
      console.error('[middleware] profile fetch exception', err)
    }

    // FAIL-CLOSE: 프로필 조회 실패 또는 없음 → /consent로 보내 onboarding 강제
    // (이전 동작: 통과 → 미가입자가 모든 페이지 접근 가능했음)
    if (profileFetchFailed || !profile) {
      const url = request.nextUrl.clone()
      url.pathname = '/consent'
      return NextResponse.redirect(url)
    }

    // 1. 약관 미동의 또는 구버전 → /consent 먼저 (잠금 계정도 동의는 먼저)
    const needsConsent =
      profile.terms_version !== CURRENT_TERMS_VERSION ||
      profile.privacy_version !== CURRENT_PRIVACY_VERSION
    if (needsConsent) {
      const url = request.nextUrl.clone()
      url.pathname = '/consent'
      return NextResponse.redirect(url)
    }

    // 2. 약관 동의 완료 후 잠금 계정 차단
    if (profile.is_active === false) {
      const url = request.nextUrl.clone()
      url.pathname = '/blocked'
      return NextResponse.redirect(url)
    }
  }

  // /consent 접근: 이미 동의 완료했으면 상태에 따라 redirect
  // 조회 실패 시 사용자는 /consent에 그대로 머물러 onboarding 가능 (fail-safe)
  if (user && isConsentRoute) {
    try {
      const { data: profile, error } = await supabase
        .from('user_profiles')
        .select('is_active, terms_version, privacy_version')
        .eq('id', user.id)
        .single()

      if (!error && profile &&
          profile.terms_version === CURRENT_TERMS_VERSION &&
          profile.privacy_version === CURRENT_PRIVACY_VERSION) {
        const url = request.nextUrl.clone()
        url.pathname = profile.is_active === false ? '/blocked' : '/team'
        return NextResponse.redirect(url)
      }
    } catch (err) {
      console.warn('[middleware] consent route profile fetch failed', err)
    }
  }

  return supabaseResponse
}
