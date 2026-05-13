/**
 * POST /api/missing-reports/notify
 *
 * 미보고 현황 탭에서 리더/관리자가 [팀즈 알림] 버튼을 누르면 호출됨.
 * 해당 사용자의 팀 출근/퇴근보고 채널 스레드에 reply로 발송됨.
 *
 * 권한:
 *   - admin: 전체 대상
 *   - leader (team scope): 본인 팀 멤버만
 *   - leader (division scope): 본인 본부 멤버만
 *   - 일반 사용자: 거부 (본인에게 알림 보내는 것도 거부 — 의미 없음)
 *
 * Body:
 *   {
 *     date: "YYYY-MM-DD",
 *     email: "target@company.com",
 *     missingType: "missing_all" | "missing_checkout"
 *   }
 */

import { NextResponse } from 'next/server'
import { requireLeaderOrAdmin } from '@/lib/admin-check'
import { createAdminClient } from '@/lib/supabase/admin'
import { notifyMissingReport } from '@/lib/notifications/teams'

export const maxDuration = 30

export async function POST(request: Request) {
  // 권한 + scope
  const auth = await requireLeaderOrAdmin()
  if (!auth) {
    return NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 })
  }
  const { user: sender, scope } = auth

  let body: { date?: string; email?: string; missingType?: string } | null = null
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const date = (body?.date ?? '').trim()
  const targetEmail = (body?.email ?? '').trim().toLowerCase()
  const missingType = body?.missingType
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'date 형식 오류' }, { status: 400 })
  }
  if (!targetEmail) {
    return NextResponse.json({ error: 'email 누락' }, { status: 400 })
  }
  if (missingType !== 'missing_all' && missingType !== 'missing_checkout') {
    return NextResponse.json({ error: 'missingType 값 오류' }, { status: 400 })
  }

  const adminClient = createAdminClient()

  // 1) 대상자 profile 조회
  const { data: targetProfile, error: targetErr } = await adminClient
    .from('user_profiles')
    .select('email, display_name, division, team, is_active')
    .eq('email', targetEmail)
    .maybeSingle()
  if (targetErr) {
    console.warn('[missing-reports/notify] target lookup error:', targetErr.message)
    return NextResponse.json({ error: '대상자 조회 실패' }, { status: 500 })
  }
  if (!targetProfile) {
    return NextResponse.json({ error: '대상 사용자를 찾을 수 없습니다.' }, { status: 404 })
  }
  if (!targetProfile.is_active) {
    return NextResponse.json({ error: '비활성 사용자에게는 알림을 보낼 수 없습니다.' }, { status: 400 })
  }
  const division = (targetProfile.division ?? '').trim()
  const team = (targetProfile.team ?? '').trim()
  if (!division || !team) {
    return NextResponse.json({
      error: '대상자의 본부/팀 정보가 없어 알림을 보낼 수 없습니다.',
    }, { status: 400 })
  }

  // 2) scope 검증 — leader는 자기 범위 밖 알림 발송 금지
  if (scope.kind === 'team') {
    if (team !== scope.team) {
      return NextResponse.json({
        error: '본인 팀 멤버에게만 알림을 보낼 수 있습니다.',
      }, { status: 403 })
    }
  } else if (scope.kind === 'division') {
    if (division !== scope.division) {
      return NextResponse.json({
        error: '본인 본부 멤버에게만 알림을 보낼 수 있습니다.',
      }, { status: 403 })
    }
  }
  // admin은 제한 없음

  // 3) 발송자 표시명 (이메일 노출 금지)
  const { data: senderProfile } = await adminClient
    .from('user_profiles')
    .select('display_name')
    .eq('email', sender?.email ?? '')
    .maybeSingle()
  const senderName = senderProfile?.display_name?.trim() || '관리자'

  // 4) 발송
  const result = await notifyMissingReport({
    name: targetProfile.display_name ?? targetEmail,
    date,
    missingType,
    division,
    team,
    senderName,
  })

  if (!result.ok) {
    return NextResponse.json({
      ok: false,
      error: result.reason ?? '발송 실패',
    }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
