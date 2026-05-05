import { createClient } from '@/lib/supabase/server'

/**
 * 부트스트랩 관리자 이메일 (env로 관리, 콤마 구분 다중 지원).
 * - DB의 user_profiles.role === 'admin' 이 1차 권한이며,
 * - 이 env 목록은 (a) 초기 admin 부트스트랩 또는
 *   (b) DB 조회 실패 시에도 관리 콘솔에 들어갈 수 있는 슈퍼 관리자용 안전망.
 *
 * 운영 권장: 가능하면 DB role='admin'만으로 운영하고 본 env는 비워두기.
 * 코드에 절대 하드코딩하지 말 것 (PII).
 */
function getBootstrapAdminEmails(): string[] {
  const raw = process.env.ADMIN_EMAILS || ''
  return raw
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean)
}

/**
 * 이 이메일이 ADMIN_EMAILS env 목록에 포함된 부트스트랩 관리자인지 확인.
 * Navbar 등에서 단순 비교용으로 사용 가능.
 */
export function isBootstrapAdmin(email: string | null | undefined): boolean {
  if (!email) return false
  const list = getBootstrapAdminEmails()
  if (list.length === 0) return false
  return list.includes(email.toLowerCase())
}

/**
 * @deprecated 하위호환 export — 새 코드는 isBootstrapAdmin/getBootstrapAdminEmails 사용
 * 단일 ADMIN_EMAIL을 참조하던 기존 코드를 위한 fallback. 첫 번째 env 항목 또는 빈 문자열.
 */
export const ADMIN_EMAIL = (process.env.ADMIN_EMAILS || '').split(',')[0]?.trim() || ''

/**
 * 현재 로그인한 사용자가 관리자인지 확인합니다.
 * - DB user_profiles.role === 'admin' 이면 관리자
 * - 또는 ADMIN_EMAILS env 목록에 포함된 이메일이면 부트스트랩 관리자
 *
 * FAIL-CLOSE: 프로필 조회 실패 시 false 반환 (이전엔 catch가 비었음).
 */
export async function isAdmin(): Promise<boolean> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return false
  if (isBootstrapAdmin(user.email)) return true

  try {
    const { data: profile, error } = await supabase
      .from('user_profiles')
      .select('role')
      .eq('id', user.id)
      .single()
    if (error) {
      console.warn('[isAdmin] profile fetch error', error.code, error.message)
      return false
    }
    return profile?.role === 'admin'
  } catch (err) {
    console.error('[isAdmin] exception', err)
    return false
  }
}

/**
 * API Route에서 관리자 권한을 검증합니다.
 * 관리자가 아니면 null을 반환합니다.
 */
export async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  if (isBootstrapAdmin(user.email)) return user

  try {
    const { data: profile, error } = await supabase
      .from('user_profiles')
      .select('role')
      .eq('id', user.id)
      .single()
    if (error) {
      console.warn('[requireAdmin] profile fetch error', error.code, error.message)
      return null
    }
    return profile?.role === 'admin' ? user : null
  } catch (err) {
    console.error('[requireAdmin] exception', err)
    return null
  }
}

/**
 * API Route에서 현재 사용자가 활성화된(is_active) 상태인지 검증합니다.
 * 활성 사용자면 user 객체를, 비활성이면 null을 반환합니다.
 *
 * 부트스트랩 관리자는 is_active와 무관하게 통과 (관리 콘솔 잠금 방지용 안전망).
 */
export async function requireActiveUser() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  // 부트스트랩 관리자는 is_active 체크를 우회 (안전망)
  if (isBootstrapAdmin(user.email)) return user

  try {
    const { data: profile, error } = await supabase
      .from('user_profiles')
      .select('is_active')
      .eq('id', user.id)
      .single()
    if (error) {
      console.warn('[requireActiveUser] profile fetch error', error.code, error.message)
      return null
    }
    return profile?.is_active ? user : null
  } catch (err) {
    console.error('[requireActiveUser] exception', err)
    return null
  }
}
