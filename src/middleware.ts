import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { withSessionCookieDefaults } from '@/lib/supabase/cookie-options'

/**
 * Route 레벨 인증 가드.
 *
 * 비인증 사용자가 보호 페이지/API URL을 직접 입력했을 때 페이지 JS 로드 + 401
 * 콘솔 노이즈가 발생하는 걸 막는다. 페이지 진입 전 즉시 /login 으로 리다이렉트.
 *
 * Supabase 공식 가이드를 따라 supabase.auth.getUser() 호출 — 세션 검증과 동시에
 * 만료 임박 토큰 갱신을 미들웨어에서 처리한다 (cookie passthrough 패턴).
 *
 * 권한(role) 검사는 API 라우트의 requireActiveUser / requireAdmin이 그대로 담당.
 * 미들웨어는 "로그인 됐냐"만 본다.
 *
 * 공개 경로:
 *   - /login, /terms, /privacy           — 로그인 전 접근 필요
 *   - /auth/callback                     — OAuth 교환 진행 중
 *   - /api/auth/send-otp                 — 로그인 OTP 발송
 *   - /api/cron/*                        — Vercel cron (CRON_SECRET로 별도 인증)
 *   - /api/health                        — 헬스체크
 *
 * 인증 후 특수:
 *   - /blocked, /consent                 — 세션은 있으나 차단/약관 미동의. 그냥 통과
 *                                         시키고 페이지에서 상태별 UI 처리.
 */

const PUBLIC_PAGE_PATHS = new Set<string>([
  '/login',
  '/terms',
  '/privacy',
  '/auth/callback',
])

const PUBLIC_API_PREFIXES = ['/api/auth/send-otp', '/api/cron/', '/api/health']

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PAGE_PATHS.has(pathname)) return true
  if (PUBLIC_API_PREFIXES.some(p => pathname === p || pathname.startsWith(p))) return true
  return false
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // 공개 경로는 인증 검사 스킵
  if (isPublicPath(pathname)) {
    return NextResponse.next()
  }

  // 쿠키 passthrough를 위한 응답 객체 — Supabase가 세션 갱신 시 새 쿠키를 set 함
  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          // request에 먼저 set (downstream에서 새 쿠키 보이게)
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          // 새 response 생성 + 응답 쿠키에도 30일 정책 적용
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, withSessionCookieDefaults(options))
          })
        },
      },
    },
  )

  // 세션 검증 + 만료 임박 토큰 갱신
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    // API는 401 JSON, 페이지는 /login 으로 리다이렉트
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const loginUrl = request.nextUrl.clone()
    loginUrl.pathname = '/login'
    loginUrl.searchParams.set('next', pathname)
    return NextResponse.redirect(loginUrl)
  }

  return response
}

export const config = {
  /**
   * 모든 경로 매칭, 단 정적 자원 제외.
   * Next.js 내부(_next/static, _next/image)와 root 정적 파일(favicon, og 이미지,
   * sitemap, robots, manifest, 정적 이미지 확장자)은 미들웨어 안 거침.
   */
  matcher: [
    '/((?!_next/static|_next/image|favicon\\.ico|icon|apple-icon|opengraph-image|twitter-image|sitemap\\.xml|robots\\.txt|manifest\\.json|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico|woff2?|ttf|otf)$).*)',
  ],
}
