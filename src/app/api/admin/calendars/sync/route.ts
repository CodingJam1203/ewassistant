/**
 * POST /api/admin/calendars/sync
 *
 * 수동 동기화 — admin 페이지의 "동기화 실행" 버튼이 호출.
 * cron 트리거(/api/cron/calendar-sync, CRON_SECRET)와 동일한 sync 로직을
 * 사용자 세션 + admin 권한 기반으로 호출.
 *
 * 권한: admin only
 */
import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-check'
import { createAdminClient } from '@/lib/supabase/admin'
import { syncAllCalendars } from '@/lib/org-calendar/sync'

// iCal fetch + node-ical dynamic import 사용. Node 런타임 명시.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST() {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    const client = createAdminClient()
    const result = await syncAllCalendars(client)
    return NextResponse.json({ ok: true, ...result })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[admin/calendars/sync] error:', message)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
