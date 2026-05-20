/**
 * POST /api/debug/vacation-replay?date=YYYY-MM-DD
 *
 * Phase 1.5b 진단용 — 본인 work_log 의 leave_timeline 을 변경 없이 Google sync 재시도.
 * 사이드이펙트:
 *   - 이미 google_event_id 채워진 entry → skip (insert 안 함)
 *   - google_event_id 없는 entry → insert 시도, 성공 시 work_logs.leave_timeline 갱신
 *   - 알림/recordSubmission 등 다른 사이드이펙트 없음
 *
 * 응답:
 *   {
 *     date, leaveTimeline,
 *     syncResult: { changed, updatedTimeline, skipped, debug: { calendarMatched, calendarRawId, inserted, updated, deleted, errors[] } }
 *   }
 *
 * 사용 예 (브라우저 콘솔, 로그인 상태):
 *   fetch('/api/debug/vacation-replay?date=2026-04-22', { method: 'POST' }).then(r => r.json()).then(console.log)
 */

import { NextResponse } from 'next/server'
import { requireActiveUser } from '@/lib/admin-check'
import { createAdminClient } from '@/lib/supabase/admin'
import { syncLeaveTimelineWithGoogle } from '@/lib/google-calendar/vacation-sync'
import type { LeaveTimeline } from '@/types/leave-timeline'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function POST(request: Request) {
  const user = await requireActiveUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { searchParams } = new URL(request.url)
  const date = (searchParams.get('date') ?? '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'date=YYYY-MM-DD required' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data: row, error: rowErr } = await admin
    .from('work_logs')
    .select('id, name, leave_timeline')
    .eq('user_email', user.email!)
    .eq('leave_date', date)
    .eq('is_deleted', false)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (rowErr) return NextResponse.json({ error: `work_log fetch: ${rowErr.message}` }, { status: 500 })
  if (!row)   return NextResponse.json({ error: 'work_log row not found for this user/date' }, { status: 404 })

  const lt: LeaveTimeline = Array.isArray(row.leave_timeline) ? row.leave_timeline : []
  if (lt.length === 0) {
    return NextResponse.json({ error: 'no leave_timeline entries on this row' }, { status: 400 })
  }

  // prev = lt, next = lt — 이미 google_event_id 채워진 건 skip, 비어있는 건 insert 시도
  const result = await syncLeaveTimelineWithGoogle({
    adminClient: admin,
    userEmail: user.email!,
    userDisplayName: row.name ?? user.email!,
    leaveDate: date,
    prev: lt,
    next: lt,
  })

  if (result.changed && result.updatedTimeline) {
    await admin
      .from('work_logs')
      .update({ leave_timeline: result.updatedTimeline })
      .eq('id', row.id)
  }

  return NextResponse.json({
    date,
    workLogId: row.id,
    userEmail: user.email,
    leaveTimeline: lt,
    syncResult: result,
  })
}
