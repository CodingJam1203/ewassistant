/**
 * POST /api/calendar/refresh
 *   body: { force?: boolean }
 *
 * 페이지 진입 즉시 sync trigger — /calendar 사용자가 들어올 때 백엔드에서 active 캘린더를
 * iCal fetch → DB upsert 한 뒤 화면을 재load. 30분 cron(`/api/cron/calendar-sync`)과는
 * 별개로 "지금 당장" 최신화를 강제하는 경로.
 *
 * 정책:
 *   - 인증된 사용자라면 admin 권한 없어도 호출 가능. RLS·middleware 통과면 OK.
 *   - throttle: `org_calendar_events.synced_at` MAX가 30초 이내면 sync skip → status: 'throttled'.
 *     수동 새로고침은 body.force=true 로 throttle 우회. (종전 5분 → 30초로 단축 — 매 페이지
 *     진입이 사실상 fresh sync가 되도록. 30초 안 연속 reload만 backend 보호 차원에서 skip.)
 *   - sync 본체는 syncAllCalendars 재사용 (admin client, 동시성 5).
 *
 * 응답:
 *   { status: 'synced'    | 'throttled' | 'error',
 *     lastSyncedAt: ISO string | null,
 *     ageMs?: number,
 *     throttleMs?: number,
 *     ...syncResult? }
 *
 * GET /api/calendar/refresh — 마지막 sync 시점만 반환 (sync 실행 X).
 */
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { syncAllCalendars } from '@/lib/org-calendar/sync'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// 모든 active 캘린더 fetch + upsert + cleanup. 캘린더 N개 × 평균 1-3초.
export const maxDuration = 60

const THROTTLE_MS = 30 * 1000

async function readLastSyncedAt(admin: ReturnType<typeof createAdminClient>): Promise<string | null> {
  const { data } = await admin
    .from('org_calendar_events')
    .select('synced_at')
    .order('synced_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data?.synced_at ?? null
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body: { force?: boolean } = await request.json().catch(() => ({}))
  const force = body?.force === true

  const admin = createAdminClient()
  const lastSyncedAt = await readLastSyncedAt(admin)

  // throttle 체크 — force=false 인 경우만
  if (!force && lastSyncedAt) {
    const ageMs = Date.now() - new Date(lastSyncedAt).getTime()
    if (ageMs < THROTTLE_MS) {
      return NextResponse.json({
        status: 'throttled' as const,
        lastSyncedAt,
        ageMs,
        throttleMs: THROTTLE_MS,
      })
    }
  }

  try {
    const result = await syncAllCalendars(admin)
    return NextResponse.json({
      status: 'synced' as const,
      lastSyncedAt: new Date().toISOString(),
      ...result,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[calendar/refresh] error:', message)
    return NextResponse.json({
      status: 'error' as const,
      error: message,
      lastSyncedAt,
    }, { status: 500 })
  }
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const lastSyncedAt = await readLastSyncedAt(admin)
  return NextResponse.json({ lastSyncedAt })
}
