import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendNewAccountApprovalEmail } from '@/lib/notifications/email'

/**
 * Google OAuth 콜백 핸들러
 *
 * 1. code → session 교환
 * 2. 신규 계정 감지 (auth.users.created_at 기준 60초 이내 = 첫 로그인)
 * 3. 신규 계정이면 is_active=FALSE로 잠금 + 관리자 알림 메일 (비동기)
 * 4. 대시보드로 리다이렉트 → 미들웨어가 is_active=false 이면 /blocked 처리
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/dashboard'

  if (!code) {
    console.error('[Auth Callback] code 파라미터 없음')
    return NextResponse.redirect(`${origin}/login?error=missing_code`)
  }

  const supabase = await createClient()
  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)

  if (exchangeError) {
    console.error('[Auth Callback] 세션 교환 실패:', exchangeError.message)
    return NextResponse.redirect(`${origin}/login?error=auth_failed`)
  }

  // ── 프로필 생성/갱신 + 신규 계정 잠금 (실패해도 로그인 진행) ──────────────
  try {
    const { data: { user } } = await supabase.auth.getUser()

    if (user?.email && user?.id) {
      const adminClient = createAdminClient()

      // 기존 프로필 조회 (email 기준, id도 함께 조회)
      const { data: existing } = await adminClient
        .from('user_profiles')
        .select('id, email, is_active')
        .eq('email', user.email)
        .maybeSingle()

      // 케이스 판별
      const isAuthRecreated = existing && existing.id !== user.id  // Auth 재생성
      const isLockedRelogin = existing && !isAuthRecreated && existing.is_active === false

      if (!existing) {
        // ── 신규 유저: pre_approved_emails 확인 ─────────────────────────────
        const { data: preApproved } = await adminClient
          .from('pre_approved_emails')
          .select('*')
          .eq('email', user.email)
          .maybeSingle()

        if (preApproved) {
          // 사전등록된 유저: is_active=true로 프로필 생성 + pre_approved_emails 삭제
          await adminClient.from('user_profiles').insert({
            id: user.id,
            email: user.email,
            display_name: preApproved.display_name ?? null,
            division: preApproved.division ?? null,
            team: preApproved.team ?? null,
            role: preApproved.role ?? 'user',
            is_active: true,
            last_login_a