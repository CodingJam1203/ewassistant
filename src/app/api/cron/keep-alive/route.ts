/**
 * GET /api/cron/keep-alive
 *
 * Supabase Free Plan 컴퓨트 sleep 방지용 외부 cron 핑 엔드포인트.
 *
 * 배경: Supabase Free의 Postgres 컴퓨트는 일정 시간 미사용 시 idle scale-down되어
 *       첫 요청에서 6-60초 wake-up 지연이 발생한다. 사용자가 "Google로 계속하기"
 *       클릭 후 1분 멈춤 → 종종 ERR_CONNECTION_CLOSED로 떨어짐.
 *
 * 해법: 외부 cron(cron-job.org)이 5분 간격으로 본 엔드포인트를 호출, 가벼운
 *       Postgres SELECT 1건을 수행해 컴퓨트를 깨어있는 상태로 유지.
 *
 * Vercel Hobby 제약 회피: Vercel cron은 daily 1회·최대 2개 제한이라 분 단위 keep-alive
 *       cron 불가 → 외부 cron(cron-job.org)을 통해 5분 간격 호출.
 *
 * 인증: 기존 cron 라우트(reminder-20/22)와 동일한 Bearer CRON_SECRET 패턴 + FAIL-CLOSE.
 *
 * 모니터링: 응답의 `latencyMs` 값으로 sleep wake-up 발생 빈도 추적 가능.
 *           평소 100-300ms → 2000ms+ 떴으면 5분 사이 sleep 진입했단 신호.
 */

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const maxDuration = 30  // wake-up 발생 시 default 10s 초과 가능 → 여유 확보

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  // FAIL-CLOSE: env 미설정 시 무조건 거부 (다른 cron 라우트와 동일 가드)
  if (!secret) {
    console.error('[cron/keep-alive] CRON_SECRET env not set — rejecting all requests')
    return NextResponse.json({ error: 'Server misconfiguration' }, { status: 500 })
  }
  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const t0 = Date.now()
  const supabase = createAdminClient()
  // user_profiles는 항상 존재하는 테이블 + RLS 영향 없음(admin client) + LIMIT 1로 부하 최소
  const { error } = await supabase.from('user_profiles').select('id').limit(1)
  const latencyMs = Date.now() - t0

  if (error) {
    console.warn('[cron/keep-alive] query failed', error.code, error.message, `${latencyMs}ms`)
    return NextResponse.json(
      { ok: false, latencyMs, error: error.message },
      { status: 502 },
    )
  }

  // latency가 평소(100-300ms) 대비 길면 sleep wake-up 발생 신호 — 추후 간격 조정 판단 근거
  if (latencyMs > 2000) {
    console.warn(`[cron/keep-alive] slow response — possible compute wake-up: ${latencyMs}ms`)
  }

  return NextResponse.json({ ok: true, latencyMs })
}
