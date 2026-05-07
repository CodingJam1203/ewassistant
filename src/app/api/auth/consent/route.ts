import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { CURRENT_TERMS_VERSION, CURRENT_PRIVACY_VERSION } from '@/lib/policies'
import { sendConsentCompletedEmail } from '@/lib/notifications/email'

const consentSchema = z.object({
  displayName: z.string().trim().min(1, '이름을 입력해 주세요.').max(50, '이름은 50자 이하로 입력해 주세요.'),
})

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // body에서 displayName 파싱 (필수)
    let displayName: string
    try {
      const body = await request.json()
      const parsed = consentSchema.safeParse(body)
      if (!parsed.success) {
        const firstIssue = parsed.error.issues[0]
        return NextResponse.json(
          { error: firstIssue?.message ?? '입력값이 올바르지 않습니다.' },
          { status: 400 }
        )
      }
      displayName = parsed.data.displayName
    } catch {
      return NextResponse.json({ error: '이름을 입력해 주세요.' }, { status: 400 })
    }

    const adminClient = createAdminClient()
    const now = new Date().toISOString()

    // 0. 동의 전 상태 조회 — 신규 가입(미승인) 케이스 판별용
    //    is_active=false 면 1차 OAuth 알림만 받았던 상태 → 이름 포함 후속 알림 발송
    //    is_active=true  면 약관 버전 갱신 재동의 → 알림 스킵 (스팸 방지)
    const { data: prevProfile } = await adminClient
      .from('user_profiles')
      .select('is_active, display_name')
      .eq('id', user.id)
      .single()

    // 1. user_policy_consents에 기록 (이력 관리)
    await adminClient.from('user_policy_consents').insert({
      user_email: user.email,
      terms_version: CURRENT_TERMS_VERSION,
      privacy_version: CURRENT_PRIVACY_VERSION,
      terms_agreed_at: now,
      privacy_agreed_at: now,
    })

    // 2. user_profiles에 최신 동의 상태 + 이름 업데이트 (빠른 확인용)
    const { error: updateError } = await adminClient
      .from('user_profiles')
      .update({
        display_name: displayName,
        terms_version: CURRENT_TERMS_VERSION,
        privacy_version: CURRENT_PRIVACY_VERSION,
        terms_agreed_at: now,
        privacy_agreed_at: now,
      })
      .eq('id', user.id)

    if (updateError) {
      console.error('Consent Profile Update Error:', updateError)
      return NextResponse.json({ error: '서버 에러가 발생했습니다.' }, { status: 500 })
    }

    // 동의 완료 후 is_active 확인 → 클라이언트가 redirect 경로 결정에 사용
    const { data: profile } = await adminClient
      .from('user_profiles')
      .select('is_active')
      .eq('id', user.id)
      .single()

    // 신규 가입(미승인) 케이스에서만 이름 포함 후속 알림 발송
    // - prevProfile.is_active === false: 1차 OAuth 알림만 받았던 상태 → 이름 포함 알림 보내 admin이 식별
    // - 기존 활성 사용자가 약관 갱신 재동의: 알림 스킵
    if (prevProfile?.is_active === false && user.email) {
      // fire-and-forget — 메일 실패가 동의 처리를 막지 않도록 await 안 함
      sendConsentCompletedEmail({
        email: user.email,
        displayName,
        completedAt: now,
      }).catch((err) => {
        console.error('[Consent] sendConsentCompletedEmail failed:', err)
      })
    }

    const redirectTo = profile?.is_active === false ? '/blocked' : '/team'
    return NextResponse.json({ success: true, redirectTo })
  } catch (err: unknown) {
    console.error('Consent API Error:', err)
    return NextResponse.json({ error: '서버 에러가 발생했습니다.' }, { status: 500 })
  }
}
