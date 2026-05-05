import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { CURRENT_TERMS_VERSION, CURRENT_PRIVACY_VERSION } from '@/lib/policies'
import { notifyAccountPending } from '@/lib/notifications/teams'

export async function POST() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const adminClient = createAdminClient()
    const now = new Date().toISOString()

    // 1. user_policy_consents에 기록 (이력 관리)
    await adminClient.from('user_policy_consents').insert({
      user_email: user.email,
      terms_version: CURRENT_TERMS_VERSION,
      privacy_version: CURRENT_PRIVACY_VERSION,
      terms_agreed_at: now,
      privacy_agreed_at: now,
    })

    // 2. user_profiles에 최신 동의 상태 업데이트
    const { error: updateError } = await adminClient
      .from('user_profiles')
      .update({
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

    // 3. is_active + display_name 조회
    const { data: profile } = await adminClient
      .from('user_profiles')
      .select('is_active, display_name')
      .eq('id', user.id)
      .single()

    const redirectTo = profile?.is_active === false ? '/blocked' : '/team'

    // ─── 미승인 계정 가입 알림 (is_active=false → 관리자 승인 필요) ──────────
    if (redirectTo === '/blocked') {
      notifyAccountPending({
        name: profile?.display_name ?? '',
        email: user.email ?? '',
        createdAt: now,
      })
    }

    return NextResponse.json({ success: true, redirectTo })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('Consent API Error:', message)
    return NextResponse.json({ error: '서버 에러가 발생했습니다.' }, { status: 500 })
  }
}
