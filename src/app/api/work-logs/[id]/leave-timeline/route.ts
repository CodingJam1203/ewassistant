/**
 * PATCH /api/work-logs/[id]/leave-timeline (v1.60.4, 2026-05-30)
 *
 * leave_timeline 컬럼만 단독 업데이트하는 작은 endpoint.
 * 모달 안에서 [이 휴가 취소] / [일정 삭제] 액션이 confirm 후 즉시 호출.
 *
 * 의도 — 기존 PATCH /api/work-logs/[id]는 calculateEw + 전체 필드 patch + 알림 등
 * 부수효과가 큼. 휴가 단독 삭제 흐름에 그걸 다 태우면 사용자가 미처 입력 안 한
 * 시간/장소 default가 강제 저장되는 부작용. → 새 endpoint는 leave_timeline 하나만
 * 안전하게 업데이트, 다른 컬럼은 안 건드림.
 *
 * body — { leaveTimeline: LeaveTimeline | [] | null }
 *   - 빈 배열 / null → leave_timeline NULL 처리
 *   - 비어있지 않은 배열 → validateLeaveTimeline 통과 후 저장
 *
 * 권한 — 본인(user_id 매칭) 또는 admin.
 * 알림 — 미발송 (휴가 단독 삭제는 noisy 알림이라 silent).
 */

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdmin, requireActiveUser } from '@/lib/admin-check'
import { validateLeaveTimeline } from '@/lib/leave-timeline'
import { recordAudit, extractRequestMeta } from '@/lib/audit-log'
import { syncLeaveTimelineWithGoogle } from '@/lib/google-calendar/vacation-sync'
import type { LeaveTimeline } from '@/types/leave-timeline'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function PATCH(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params
  if (!id) {
    return NextResponse.json({ error: 'id 누락' }, { status: 400 })
  }

  const user = await requireActiveUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized or Inactive account' }, { status: 403 })
  }

  const adminClient = createAdminClient()

  // 권한 — 본인 또는 admin
  const { data: log } = await adminClient
    .from('work_logs')
    .select('id, user_id, user_email, name, leave_date, leave_timeline, is_deleted')
    .eq('id', id)
    .maybeSingle()
  if (!log) {
    return NextResponse.json({ error: 'work_log not found' }, { status: 404 })
  }
  if (log.is_deleted) {
    return NextResponse.json({ error: 'work_log already deleted' }, { status: 410 })
  }
  const isOwner = log.user_id === user.id || log.user_email === user.email
  const adminUser = await requireAdmin()
  if (!isOwner && !adminUser) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json().catch(() => null)
  if (body == null || typeof body !== 'object') {
    return NextResponse.json({ error: 'body 누락' }, { status: 400 })
  }

  // leaveTimeline 검증 — 빈 배열/null 모두 허용
  const incoming = (body as { leaveTimeline?: unknown }).leaveTimeline
  let nextLeaveTimeline: LeaveTimeline | null = null
  if (Array.isArray(incoming) && incoming.length > 0) {
    const errs = validateLeaveTimeline(incoming as LeaveTimeline)
    if (errs.length > 0) {
      return NextResponse.json(
        { error: '휴가 정보가 올바르지 않습니다: ' + errs.map(e => e.message).join(', ') },
        { status: 400 },
      )
    }
    nextLeaveTimeline = incoming as LeaveTimeline
  }

  // v1.60.7 — calendar source 항목 삭제 시 사용자가 명시 무시 의도를 표시.
  // true면 work_logs.calendar_prefill_dismissed=true로 같이 set → 다음 모달 진입 시
  // expected-timeline route가 source='calendar' 항목을 응답에서 제외.
  const dismissCalendarPrefill = (body as { dismissCalendarPrefill?: unknown }).dismissCalendarPrefill === true

  const prevLeaveTimeline = (Array.isArray(log.leave_timeline)
    ? (log.leave_timeline as LeaveTimeline)
    : []) as LeaveTimeline

  const updatePayload: Record<string, unknown> = {
    leave_timeline: nextLeaveTimeline,
    updated_at: new Date().toISOString(),
  }
  if (dismissCalendarPrefill) {
    updatePayload.calendar_prefill_dismissed = true
  }

  const { error: updErr } = await adminClient
    .from('work_logs')
    .update(updatePayload)
    .eq('id', id)
    .eq('is_deleted', false)
  if (updErr) {
    return NextResponse.json({ error: updErr.message }, { status: 500 })
  }

  // v1.60.6 — leave_timeline diff를 Google Vacation Calendar에도 반영 (best-effort).
  // 정책: N-Click ↔ Google Vacation Calendar 양방향 sync — full_day / 8H 미만 모두 push.
  // 사용자가 [이 휴가 취소] / [일정 삭제] 누르면 Google 측 이벤트도 같이 events.delete.
  // 실패해도 throw 안 함 (DB 변경은 이미 반영됨). 결과로 google_event_id 채워지면 work_logs 재update.
  try {
    const result = await syncLeaveTimelineWithGoogle({
      adminClient,
      userEmail: log.user_email ?? user.email!,
      userDisplayName: (log.name as string | null) ?? user.email!,
      leaveDate: log.leave_date as string,
      prev: prevLeaveTimeline,
      next: nextLeaveTimeline ?? [],
    })
    if (result.changed && result.updatedTimeline) {
      await adminClient
        .from('work_logs')
        .update({ leave_timeline: result.updatedTimeline })
        .eq('id', id)
    }
  } catch (err) {
    console.warn('[leave-timeline PATCH] vacation-sync failed (non-fatal):', err)
  }

  // Audit
  try {
    const meta = extractRequestMeta(request)
    await recordAudit({
      action: 'work_log_leave_timeline_patch',
      actorId: user.id,
      actorEmail: user.email ?? null,
      targetTable: 'work_logs',
      targetId: id,
      details: {
        leave_date: log.leave_date,
        user_email: log.user_email,
        prev: log.leave_timeline ?? null,
        next: nextLeaveTimeline,
        dismiss_calendar_prefill: dismissCalendarPrefill,
      },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    })
  } catch {
    // silent
  }

  return NextResponse.json({
    ok: true,
    id,
    leaveTimeline: nextLeaveTimeline,
  })
}
