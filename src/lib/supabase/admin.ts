import { createClient } from '@supabase/supabase-js'
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from './env'

/**
 * Supabase Service Role 클라이언트 — RLS를 우회합니다.
 * 반드시 서버(API Route, Server Component)에서만 사용하세요.
 */
export function createAdminClient() {
  return createClient(
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}
