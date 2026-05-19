/**
 * GET /api/cron/calendar-sync
 *
 * 정기 트리거 — Vercel Cron 또는 외부 cron-job.org에서 호출.
 * org_calendars 전체에 대해 iCal fetch → org_calendar_events upsert.
 *
 * 인증: Authorization: Bearer ${CRON_SECRET}
 *
 * 응답: { ok, totalCalendars, succeeded, failed, totalEvents, failures }
 */

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { syncAllCalendars } from '@/lib/org-calendar/sync'

// node-ical은 Node.js 전용 (BigInt 등 native 의존). Edge runtime에서 build 실패.
// 명시적으로 nodejs 지정.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// iCal fetch + upsert + delete. 캘린더 N개 × 평균 fetch 1-3초 → 여유.
export const maxDuration = 60

export async function GET(request: Request) {
  // CRON_SECRET 인증
  const authHeader = request.headers.get('authorization') ?? ''
  const expected = process.env.CRON_SECRET
  if (!expected) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 })
  }
  if (authHeader !== `Bearer ${expected}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const adminClient = createAdminClient()
    const result = await syncAllCalendars(adminClient)
    return NextResponse.json({ ok: true, ...result })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[calendar-sync] error:', message)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
