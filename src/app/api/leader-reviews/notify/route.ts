/**
 * v1.73 + v1.74 — POST /api/leader-reviews/notify
 *
 * 리더가 [📢 알림] 클릭 시 호출. 미상신/오상신 review에 대해 대상자 팀 채널에 알림 발송.
 *
 * Body: { target_user_email, target_date, report_kind? }
 *   또는 { work_log_id, report_kind? }  (기존 호환)
 *
 * 발송 조건: review row 존재 + status='missing' or 'wrong'
 */

import { NextResponse } from 'next/server'
import { requireLeaderOrAdmin } from '@/lib/admin-check'
import { createAdminClient } from '@/lib/supabase/admin'
import { notifyLeaderReview } from '@/lib/notifications/teams'
import { resolveRoutingTeam } from '@/lib/org'

export const maxDuration = 30

export async function POST(request: Request) {
  const auth = await requireLeaderOrAdmin()
  if (!auth) {
    return NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 })
  }
  const { user: reviewer, scope } = auth

  let body: {
    work_log_id?: string | null
    target_user_email?: string
    target_date?: string
    report_kind?: string
    note?: string | null
  } | null = null
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const workLogId = (body?.work_log_id ?? '').trim() || null
  const rawKind = body?.report_kind
  const reportKind: 'check_in' | 'check_out' =
    rawKind === 'check_in' ? 'check_in' : 'check_out'
  // v1.74.9 — 알림 발송 시점에만 받는 메모. body에 있으면 우선 사용, 없으면 review.note fallback.
  const bodyNote = typeof body?.note === 'string' ? body.note.trim() || null : undefined

  const adminClient = createAdminClient()

  // target 추출
  let targetEmail = (body?.target_user_email ?? '').trim().toLowerCase()
  let targetDate = (body?.target_date ?? '').trim()
  if (workLogId) {
    const { data: wl } = await adminClient
      .from('work_logs')
      .select('user_email, leave_date, is_deleted')
      .eq('id', workLogId)
      .maybeSingle()
    if (!wl || wl.is_deleted) {
      return NextResponse.json({ error: '대상 보고를 찾을 수 없습니다.' }, { status: 404 })
    }
    targetEmail = (wl.user_email as string).toLowerCase()
    targetDate = wl.leave_date as string
  }
  if (!targetEmail || !/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
    return NextResponse.json({ error: 'target_user_email + target_date 또는 work_log_id 필요' }, { status: 400 })
  }

  const { data: targetProfile } = await adminClient
    .from('user_profiles')
    .select('email, display_name, division, team, notify_team, is_active')
    .eq('email', targetEmail)
    .maybeSingle()
  if (!targetProfile) {
    return NextResponse.json({ error: '대상자 프로필 없음' }, { status: 404 })
  }
  if (!targetProfile.is_active) {
    return NextResponse.json({ error: '비활성 사용자에게 알림을 보낼 수 없습니다.' }, { status: 400 })
  }
  const division = (targetProfile.division ?? '').trim()
  const team = (targetProfile.team ?? '').trim()
  const effectiveTeam = resolveRoutingTeam(team, targetProfile.notify_team ?? null)
  if (!division || !effectiveTeam) {
    return NextResponse.json({
      error: team
        ? '대상자의 본부/팀 정보가 없어 알림을 보낼 수 없습니다.'
        : '본부 직속 인원은 알림 받을 팀(notify_team)이 지정되어야 합니다.',
    }, { status: 400 })
  }

  // scope 검증
  if (scope.kind === 'team' && effectiveTeam !== scope.team) {
    return NextResponse.json({ error: '본인 팀 멤버에게만 알림을 보낼 수 있습니다.' }, { status: 403 })
  }
  if (scope.kind === 'division' && division !== scope.division) {
    return NextResponse.json({ error: '본인 본부 멤버에게만 알림을 보낼 수 있습니다.' }, { status: 403 })
  }

  // review 조회
  const { data: review } = await adminClient
    .from('work_log_leader_reviews')
    .select('status, note')
    .eq('target_user_email', targetEmail)
    .eq('target_date', targetDate)
    .maybeSingle()
  if (!review) {
    return NextResponse.json({ error: '리더 피드백이 박혀있지 않습니다.' }, { status: 400 })
  }
  if (review.status !== 'missing' && review.status !== 'wrong') {
    return NextResponse.json({
      error: '미상신/오상신 상태만 알림 발송 가능합니다 (현재: ' + review.status + ').',
    }, { status: 400 })
  }

  const { data: reviewerProfile } = await adminClient
    .from('user_profiles')
    .select('display_name')
    .eq('email', reviewer?.email ?? '')
    .maybeSingle()
  const reviewerName = reviewerProfile?.display_name?.trim() || '리더'

  const result = await notifyLeaderReview({
    name: targetProfile.display_name ?? targetEmail,
    date: targetDate,
    reportKind,
    status: review.status as 'missing' | 'wrong',
    division,
    team: effectiveTeam,
    reviewerName,
    // v1.74.9 — body.note(prompt 입력) 우선, 없으면 review.note(영구 저장) fallback
    note: bodyNote !== undefined ? bodyNote : (review.note as string | null),
  })

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.reason ?? '발송 실패' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
