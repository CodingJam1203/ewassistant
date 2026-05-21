/**
 * GET /api/calendar/range?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Phase 1.5a (2026-05-20) — 데이터 소스 swap: Apps Script/Sheets → org_calendar_events.
 * Phase 1.5f (2026-05-21) — 조회 로직을 `src/lib/org-calendar/lookup.ts` 공용 lib로 추출.
 *   둘러보기(team-status) + cron 알림과 동일 소스/정책 공유. 동작 보존.
 *
 * 본인 매칭(matched_user_emails contains 본인 이메일) 이벤트만 조회.
 * 응답 shape 그대로 유지 — MyHistoryCalendar / CheckInModal 등 클라이언트 영향 0.
 */
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { UserCalendarLookup } from '@/types/leave-calendar'
import { fetchOrgCalendarLookup } from '@/lib/org-calendar/lookup'

const MAX_DAYS = 45

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function GET(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const userEmail = (user.email ?? '').toLowerCase()
    if (!userEmail) return NextResponse.json({ enabled: false, byDate: {} })

    const { searchParams } = new URL(request.url)
    const from = (searchParams.get('from') || '').trim()
    const to   = (searchParams.get('to')   || '').trim()
    const isoRe = /^\d{4}-\d{2}-\d{2}$/
    if (!isoRe.test(from) || !isoRe.test(to)) {
      return NextResponse.json({ error: 'from/to are required (YYYY-MM-DD)' }, { status: 400 })
    }
    if (from > to) {
      return NextResponse.json({ error: 'from must be <= to' }, { status: 400 })
    }

    const start = new Date(`${from}T00:00:00Z`)
    const end   = new Date(`${to}T00:00:00Z`)
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return NextResponse.json({ error: 'Invalid date range' }, { status: 400 })
    }
    const days = Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1
    if (days > MAX_DAYS) {
      return NextResponse.json({ error: `Range too large (max ${MAX_DAYS} days)` }, { status: 400 })
    }
    const dates: string[] = []
    for (let i = 0; i < days; i++) {
      const d = new Date(start)
      d.setUTCDate(d.getUTCDate() + i)
      dates.push(d.toISOString().slice(0, 10))
    }

    const adminClient = createAdminClient()
    const result = await fetchOrgCalendarLookup({ adminClient, emails: [userEmail], dates })

    if (result.fetchFailed) {
      return NextResponse.json({ enabled: true, byDate: {}, fetchFailed: true }, { status: 200 })
    }

    const byDate: Record<string, UserCalendarLookup> =
      result.byEmail.get(userEmail) ?? {}

    return NextResponse.json({
      enabled: true,
      byDate,
    }, {
      headers: {
        'Cache-Control': 'private, max-age=60, stale-while-revalidate=300',
      },
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[calendar/range] error:', message)
    return NextResponse.json({ enabled: true, byDate: {}, fetchFailed: true }, { status: 200 })
  }
}
