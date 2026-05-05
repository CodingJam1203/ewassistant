import { createClient } from '@/lib/supabase/server'

export const ADMIN_EMAIL = 'hrb.main@gmail.com'

/**
 * 현재 로그인한 사용자가 관리자인지 확인합니다.
 * - 이메일이 ADMIN_EMAIL이면 관리자
 * - user_profiles.role === 'admin' 이면 관리자
 */
export async function isAdmin(): Promise<boolean> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return false
  if (user.email === ADMIN_EMAIL) return true

  try {
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('role')
      .eq('id', user.id)
      .single()
    return profile?.role === 'admin'
  } catch {
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

  if (user.email === ADMIN_EMAIL) return user

  try {
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('role')
      .eq('id', user.id)
      .single()
    return profile?.role === 'admin' ? user : null
  } catch {
    return null
  }
}

/**
 * API Route에서 현재 사용자가 활성화된(is_active) 상태인지 검증합니다.
 * 활성 사용자면 user 객체를, 비활성이면 null을 반환합니다.
 */
export async function requireActiveUser() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  // 관리자 계정은 항상 활성으로 간주
  if (user.email === ADMIN_EMAIL) return user

  try {
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('is_active')
      .eq('id', user.id)
      .single()
    return profile?.is_active ? user : null
  } catch {
    return null
  }
}
