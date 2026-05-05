/**
 * Supabase Auth 쿠키 정책 — 30일 세션 유지.
 *
 * Supabase ssr 클라이언트가 setAll로 넘기는 cookie option을 보안/세션수명
 * 정책에 맞게 보강하는 헬퍼.
 *
 * 정책 (프로젝트 합의):
 *   - 한 브라우저 기준 최대 30일 세션 유지
 *   - httpOnly true (XSS 보호)
 *   - secure true (production만, dev/localhost는 false 자동)
 *   - sameSite 'lax' (CSRF 보호 + OAuth redirect 호환)
 *   - path '/'
 *
 * 실제 강제 만료(30일 경과 시 재로그인)는 Supabase Dashboard의
 * "Time-box user sessions" 설정과 함께 동작해야 함.
 */

export const SESSION_DAYS = 30
export const SESSION_MAX_AGE_SECONDS = SESSION_DAYS * 24 * 60 * 60  // 2592000

/**
 * Supabase가 넘기는 쿠키 옵션을 30일 정책에 맞게 보강.
 * - 호출자가 명시한 sameSite/path는 우선 존중하되 누락 시 default 적용
 * - secure는 production에서만 true (localhost dev 호환)
 * - httpOnly는 강제 true
 * - maxAge는 강제 30일 (기본값이 더 짧을 수 있음)
 */
export function withSessionCookieDefaults(
  options: Record<string, unknown> | undefined
): Record<string, unknown> {
  const base: Record<string, unknown> = { ...(options ?? {}) }

  // 보안 강제
  base.httpOnly = true
  base.sameSite = base.sameSite ?? 'lax'
  base.path = base.path ?? '/'

  // production에서만 secure (localhost http는 secure=true면 안 적용됨)
  if (process.env.NODE_ENV === 'production') {
    base.secure = true
  }

  // 만료 — Supabase가 0(session) 또는 짧게 줄 수 있어 30일로 강제
  // 단, 사용자가 명시적으로 0이나 음수를 줬다면 (= 삭제 의도) 그대로 둠
  const incomingMaxAge = typeof options?.maxAge === 'number' ? options.maxAge as number : undefined
  if (incomingMaxAge === undefined || incomingMaxAge > 0) {
    base.maxAge = SESSION_MAX_AGE_SECONDS
  }
  // expires 필드를 동시에 쓰는 경우 maxAge와 일관되게 (둘 다 있으면 maxAge 우선이지만 안전)
  if (incomingMaxAge === undefined || incomingMaxAge > 0) {
    base.expires = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000)
  }

  return base
}
