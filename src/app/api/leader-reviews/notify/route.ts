/**
 * v1.73 Phase 2 — POST /api/leader-reviews/notify
 *
 * 리더 관리 뷰에서 리더가 [📢 알림] 버튼 클릭 시 호출.
 * 미상신/오상신으로 박힌 보고에 대해 해당 사용자의 팀 출근/퇴근보고 채널 thread에
 * reply로 알림 발송 (notifyMissingReport 패턴 동일).
 *
 * Body: { work_log_id, report_kind: 'check_in'|'check_out' }
 *   - report_kind는 어느 채널로 라우팅할지 결정 (퇴근보고 row가 default)
 *
 * 권한:
 *   - admin: 전체
 *   - leader (team/division): 자기 범위 내만
 *
 * 발송 조건:
 *   - review row 존재 + status='missing' or 'wrong' 이어야 함 (체크완료는 알림 무의미)
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

  let body: { work_log_id?: string; report_kind?: string } | null = null
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const workLogId = (body?.work_log_id ?? '').trim()
  const rawKind = body?.report_kind
  const reportKind: 'check_in' | 'check_out' =
    rawKind === 'check_in' ? 'check_in' : 'check_out'  // default check_out

  if (!workLogId) {
    return NextResponse.json({ error: 'work_log_id 누락' }, { status: 400 })
  }

  const adminClient = createAdminClient()

  // 1) work_log + 대상자 profile
  const { data: wl } = await adminClient
    .from('work_logs')
    .select('id, user_email, leave_date')
    .eq('id', workLogId)
    .eq('is_deleted', false)
    .maybeSingle()
  if (!wl) {
    return NextResponse.json({ error: '대상 보고를 찾을 수 없습니다.' }, { status: 404 })
  }

  const { data: targetProfile } = await adminClient
    .from('user_profiles')
    .select('email, display_name, division, team, notify_team, is_active')
    .eq('email', wl.user_email)
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

  // 2) scope 검증
  if (scope.kind === 'team' && effectiveTeam !== scope.team) {
    return NextResponse.json({ error: '본인 팀 멤버에게만 알림을 보낼 수 있습니다.' }, { status: 403 })
  }
  if (scope.kind === 'division' && division !== scope.division) {
    return NextResponse.json({ error: '본인 본부 멤버에게만 알림을 보낼 수 있습니다.' }, { status: 403 })
  }

  // 3) review 조회 — 발송 조건 (missing/wrong)
  const { data: review } = await adminClient
    .from('work_log_leader_reviews')
    .select('status, note, reviewer_email')
    .eq('work_log_id', workLogId)
    .maybeSingle()
  if (!review) {
    return NextResponse.json({ error: '리더 피드백이 박혀있지 않습니다.' }, { status: 400 })
  }
  if (review.status !== 'missing' && review.status !== 'wrong') {
    return NextResponse.json({
      error: '미상신/오상신 상태만 알림 발송 가능합니다 (현재: ' + review.status + ').',
    }, { status: 400 })
  }

  // 4) 발송자(리더) 표시명
  const { data: reviewerProfile } = await adminClient
    .from('user_profiles')
    .select('display_name')
    .eq('email', reviewer?.email ?? '')
    .maybeSingle()
  const reviewerName = reviewerProfile?.display_name?.trim() || '리더'

  // 5) 발송
  const result = await notifyLeaderReview({
    name: targetProfile.display_name ?? wl.user_email,
    date: wl.leave_date as string,
    reportKind,
    status: review.status as 'missing' | 'wrong',
    division,
    team: effectiveTeam,
    reviewerName,
    note: review.note as string | null,
  })

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.reason ?? '발송 실패' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
