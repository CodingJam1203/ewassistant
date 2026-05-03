import { createClient } from '@supabase/supabase-js'

/**
 * Supabase Service Role 클라이언트 — RLS를 우회합니다.
 * 반드시 서버(API Route, Server Component)에서만 사용하세요.
 */
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}
