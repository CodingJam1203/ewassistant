/**
 * v1.76 — POST /api/my/leader-reviews/resolution-request
 *
 * 본인이 EW 미상신/오상신을 처리 완료한 후 리더에게 "해지 요청" 알림 발송.
 *
 * Body: { target_date: 'YYYY-MM-DD', report_kind?: 'check_in' | 'check_out' }
 *
 * 처리:
 *   1) 인증된 본인의 (target_user_email = user.email, target_date) 리뷰 조회
 *   2) 검증: status === 'missing' || 'wrong' && resolution_requested_at IS NULL
 *   3) resolution_requested_at = NOW() 업데이트 (1회만)
 *   4) Teams 알림 발송 (대상자 본부/팀 출근/퇴근보고 채널)
 *
 * 라우팅 본부/팀은 본인 user_profiles에서 조회 (resolveRoutingTeam로 본부 직속 흡수).
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { notifyLeaderReviewResolutionRequested } from '@/lib/notifications/teams'
import { resolveRoutingTeam } from '@/lib/org'

export const maxDuration = 30

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) {
    return NextResponse.json({ error: '로그인 필요' }, { status: 401 })
  }

  let body: { target_date?: string; report_kind?: string } | null = null
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const targetDate = (body?.target_date ?? '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
    return NextResponse.json({ error: 'target_date 형식 오류 (YYYY-MM-DD)' }, { status: 400 })
  }
  // report_kind는 알림 라우팅용. 미지정 시 'check_out'(퇴근보고) 기본.
  const reportKind: 'check_in' | 'check_out' =
    body?.report_kind === 'check_in' ? 'check_in' : 'check_out'

  const adminClient = createAdminClient()
  const email = user.email.toLowerCase()

  // 본인 리뷰 조회 (target_user_email + target_date)
  const { data: review, error: fetchErr } = await adminClient
    .from('work_log_leader_reviews')
    .select('id, status, resolution_requested_at')
    .eq('target_user_email', email)
    .eq('target_date', targetDate)
    .maybeSingle()
  if (fetchErr) {
    console.warn('[resolution-request] fetch error:', fetchErr.message)
    return NextResponse.json({ error: '조회 실패' }, { status: 500 })
  }
  if (!review) {
    return NextResponse.json({ error: '해당 일자에 리더 리뷰가 없습니다.' }, { status: 404 })
  }
  if (review.status !== 'missing' && review.status !== 'wrong') {
    return NextResponse.json({ error: '미상신/오상신 상태가 아닙니다.' }, { status: 400 })
  }
  if (review.resolution_requested_at) {
    return NextResponse.json({ error: '이미 해지요청을 보낸 일자입니다.' }, { status: 409 })
  }

  // resolution_requested_at 업데이트 (race-safe: NULL일 때만)
  const now = new Date().toISOString()
  const { error: updErr } = await adminClient
    .from('work_log_leader_reviews')
    .update({ resolution_requested_at: now })
    .eq('id', review.id)
    .is('resolution_requested_at', null)
  if (updErr) {
    console.warn('[resolution-request] update error:', updErr.message)
    return NextResponse.json({ error: '저장 실패' }, { status: 500 })
  }

  // 본인 profile 조회 (이름 + 본부/팀 라우팅)
  const { data: profile } = await adminClient
    .from('user_profiles')
    .select('display_name, division, team, notify_team')
    .eq('email', email)
    .maybeSingle()

  const name = (profile?.display_name as string | null)?.trim() || email
  const division = (profile?.division as string | null) ?? null
  const effectiveTeam = resolveRoutingTeam(
    (profile?.team as string | null) ?? null,
    (profile?.notify_team as string | null) ?? null,
  )

  // Teams 알림 발송 (실패해도 DB 업데이트는 유지 — 사용자 재시도 불가)
  let notifyResult: { ok: boolean; reason?: string } = { ok: false, reason: '본부/팀 정보 없음' }
  if (division && effectiveTeam) {
    notifyResult = await notifyLeaderReviewResolutionRequested({
      name,
      date: targetDate,
      reportKind,
      status: review.status as 'missing' | 'wrong',
      division,
      team: effectiveTeam,
    })
  } else {
    console.warn('[resolution-request] notify skipped — missing division/team for', email)
  }

  return NextResponse.json({
    ok: true,
    resolution_requested_at: now,
    notify: notifyResult,
  })
}
