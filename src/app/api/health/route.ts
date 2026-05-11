import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * GET /api/health
 *
 * Supabase keep-alive ping. Vercel cron이 일정 주기로 호출 → DB에 가벼운 쿼리 1회 발생 →
 * Supabase Free Tier의 7일 비활성 자동 일시정지 방지. 로그인 시 wake-up 지연 (~30초) 해소.
 *
 * 모니터링 용도로도 사용 가능 — 200 OK가 돌아오면 DB 연결 정상.
 */
export const dynamic = 'force-dynamic'

export async function GET() {
  const startedAt = Date.now()
  try {
    const admin = createAdminClient()
    // 가벼운 쿼리 — count(*) 대신 limit(1)로 cost 최소화
    const { error } = await admin
      .from('user_profiles')
      .select('email', { head: true, count: 'exact' })
      .limit(1)
    if (error) throw error
    return NextResponse.json({
      ok: true,
      ts: new Date().toISOString(),
      latencyMs: Date.now() - startedAt,
    })
  } catch (err) {
    const message =
      err instanceof Error
        ? err.message
        : typeof err === 'object' && err !== null
          ? JSON.stringify(err)
          : String(err)
    console.error('[health] error:', err)
    return NextResponse.json(
      { ok: false, error: message, latencyMs: Date.now() - startedAt },
      { status: 500 },
    )
  }
}
