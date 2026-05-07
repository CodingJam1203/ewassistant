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
  const next = searchParams.get('next') ?? '/home'

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

      // 진단 로그 — 어떤 케이스로 떨어지는지 추적용
      console.log('[Auth Callback] 분기 진단', {
        email: user.email,
        authUserId: user.id,
        profileExists: !!existing,
        profileId: existing?.id ?? null,
        profileIsActive: existing?.is_active ?? null,
        isAuthRecreated,
        isLockedRelogin,
      })

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
            last_login_at: new Date().toISOString(),
          })
          await adminClient.from('pre_approved_emails').delete().eq('email', user.email)
          console.log(`[Auth Callback] 사전등록 계정 첫 로그인 승인: ${user.email}`)
        } else {
          // 완전 신규: 잠금 + 관리자 알림
          await adminClient.from('user_profiles').insert({
            id: user.id,
            email: user.email,
            last_login_at: new Date().toISOString(),
            is_active: false,
            role: 'user',
          })
          console.log(`[Auth Callback] 신규 계정 생성 및 잠금: ${user.email} → 메일 발송 시도`)
          sendNewAccountApprovalEmail({
            email: user.email,
            createdAt: new Date().toISOString(),
          }).catch(err =>
            console.error('[Email] 신규 계정 알림 발송 실패:', err)
          )
        }

      } else if (isAuthRecreated || isLockedRelogin) {
        // ── Auth 재생성 또는 잠금 계정 재로그인:
        //    약관 초기화 + 잠금 상태로 리셋 (재가입 취급)
        await adminClient
          .from('user_profiles')
          .update({
            id: user.id,
            last_login_at: new Date().toISOString(),
            is_active: false,
            terms_version: null,
            privacy_version: null,
            terms_agreed_at: null,
            privacy_agreed_at: null,
          })
          .eq('email', user.email)

        if (isAuthRecreated) {
          console.log(`[Auth Callback] Auth 재생성 계정 → 재가입 처리: ${user.email} → 메일 발송 시도`)
          sendNewAccountApprovalEmail({
            email: user.email,
            createdAt: new Date().toISOString(),
          }).catch(err =>
            console.error('[Email] 재가입 알림 발송 실패:', err)
          )
        } else {
          // 잠금 계정 재로그인도 관리자에게 알림 (재가입 의사 표시로 간주)
          console.log(`[Auth Callback] 잠금 계정 재로그인 → 약관 초기화 + 메일 발송 시도: ${user.email}`)
          sendNewAccountApprovalEmail({
            email: user.email,
            createdAt: new Date().toISOString(),
          }).catch(err =>
            console.error('[Email] 잠금 계정 재로그인 알림 발송 실패:', err)
          )
        }

      } else {
        // ── 정상 기존 유저: last_login_at만 갱신 ────────────────────────────
        await adminClient
          .from('user_profiles')
          .update({ last_login_at: new Date().toISOString() })
          .eq('email', user.email)

        console.log(`[Auth Callback] 기존 계정 로그인 갱신: ${user.email}`)
      }
    }
  } catch (err) {
    // 프로필 처리 실패 시 콘솔만 기록, 로그인 자체는 계속 진행
    console.error('[Auth Callback] 프로필 처리 중 오류:', err)
  }

  return NextResponse.redirect(`${origin}${next}`)
}
