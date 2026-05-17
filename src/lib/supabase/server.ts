import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { withSessionCookieDefaults } from './cookie-options'
import { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY } from './env'

export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient(
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            // 30일 maxAge + 보안 옵션 강제
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, withSessionCookieDefaults(options))
            })
          } catch {
            // The `set` method was called from a Server Component.
            // This can be ignored if you have middleware refreshing user sessions.
          }
        },
      },
    }
  )
}

// For Admin actions (bypassing RLS)
export async function createAdminClient() {
  return createServerClient(
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
    {
      cookies: {
        getAll() { return [] },
        setAll() {}
      }
    }
  )
}
