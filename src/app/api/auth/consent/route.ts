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
    // 무한 로딩 fix — silent fail 방지를 위해 INSERT 결과 명시적 체크 + 로그.
    // 테이블 없음·RLS 차단 등의 에러를 무시하지 않고 명확하게 throw.
    const { error: consentInsertError } = await adminClient
      .from('user_policy_consents')
      .insert({
        user_email: user.email,
        terms_version: CURRENT_TERMS_VERSION,
        privacy_version: CURRENT_PRIVACY_VERSION,
        terms_agreed_at: now,
        privacy_agreed_at: now,
      })
    if (consentInsertError) {
      console.error('[Consent] user_policy_consents INSERT error:', consentInsertError.code, consentInsertError.message)
      return NextResponse.json(
        { error: '동의 이력 저장 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.' },
        { status: 500 }
      )
    }

    // 2. user_profiles UPSERT — 무한 redirect fix.
    //
    // 옛 UPDATE는 row 없을 때 silent success (0 rows affected). 그 경우 middleware가
    // 다음 요청에서도 row 못 읽어 PGRST116 → /consent fail-close redirect 무한 루프.
    //
    // UPSERT로 변경 — auth/callback에서 INSERT 실패했어도 여기서 보정.
    // .select()로 결과 검증 + 0 affected rows 시 명시 에러.
    const { data: upsertedRow, error: upsertError } = await adminClient
      .from('user_profiles')
      .upsert({
        id: user.id,
        email: user.email,
        display_name: displayName,
        terms_version: CURRENT_TERMS_VERSION,
        privacy_version: CURRENT_PRIVACY_VERSION,
        terms_agreed_at: now,
        privacy_agreed_at: now,
        // 신규 row INSERT 시 default — 사전 승인 X 라 잠금. callback에서 만든 row면 보존됨 (id 매칭 conflict).
        is_active: prevProfile?.is_active ?? false,
        role: 'user',
        last_login_at: now,
      }, { onConflict: 'id' })
      .select('id, is_active, terms_version, privacy_version')
      .single()

    if (upsertError || !upsertedRow) {
      console.error('[Consent] user_profiles UPSERT error:', upsertError?.code, upsertError?.message)
      return NextResponse.json({ error: '프로필 저장 중 오류가 발생했습니다.' }, { status: 500 })
    }

    // 검증 — 실제 갱신됐는지
    if (upsertedRow.terms_version !== CURRENT_TERMS_VERSION) {
      console.error('[Consent] UPSERT returned but terms_version not applied', upsertedRow)
      return NextResponse.json({ error: '동의 처리가 반영되지 않았습니다. 다시 시도해주세요.' }, { status: 500 })
    }

    // 동의 완료 후 is_active 확인 → 클라이언트가 redirect 경로 결정에 사용
    // upsertedRow에서 바로 읽음 (별도 쿼리 불필요)
    const profile = { is_active: upsertedRow.is_active }

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
