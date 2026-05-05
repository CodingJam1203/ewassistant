import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

const COOLDOWN_SECONDS = 60

// 이메일 형식 가벼운 검증 — 너무 까다롭게 굴어서 false negative 내지는 않도록 최소한만
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}))
    const rawEmail = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''

    if (!rawEmail) {
      return NextResponse.json({ error: '이메일을 입력해주세요.' }, { status: 400 })
    }
    if (rawEmail.length > 320 || !EMAIL_RE.test(rawEmail)) {
      return NextResponse.json({ error: '올바른 이메일 형식이 아닙니다.' }, { status: 400 })
    }

    // Domain validation (Optional)
    const allowedDomainsStr = process.env.ALLOWED_EMAIL_DOMAINS || ''
    const allowedDomains = allowedDomainsStr
      ? allowedDomainsStr.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
      : []
    const domain = rawEmail.split('@')[1]
    if (allowedDomains.length > 0 && !allowedDomains.includes(domain)) {
      return NextResponse.json({ error: '허용되지 않은 이메일 도메인입니다.' }, { status: 403 })
    }

    // ─── Cooldown 체크 — 동일 이메일 60초 내 재요청 차단 ──────────────────────
    // otp_send_log 테이블에 last_sent_at을 기록. 마이그레이션 008/009에 정의됨.
    // 테이블이 없으면 throw 되지만 catch로 감싸 fail-open(보내기 시도)으로 둠.
    const adminClient = createAdminClient()
    try {
      const since = new Date(Date.now() - COOLDOWN_SECONDS * 1000).toISOString()
      const { data: recent } = await adminClient
        .from('otp_send_log')
        .select('email, last_sent_at')
        .eq('email', rawEmail)
        .gte('last_sent_at', since)
        .maybeSingle()

      if (recent) {
        const remaining = Math.ceil(
          (new Date(recent.last_sent_at).getTime() + COOLDOWN_SECONDS * 1000 - Date.now()) / 1000
        )
        return NextResponse.json(
          { error: `너무 빠른 재요청입니다. ${Math.max(remaining, 1)}초 후 다시 시도해주세요.` },
          { status: 429 }
        )
      }
    } catch (cdErr) {
      // cooldown 테이블 미생성 등 인프라 문제는 로깅만 하고 통과 (fail-open)
      console.warn('[send-otp] cooldown check skipped:', cdErr)
    }

    const supabase = await createClient()

    // Send OTP magic link
    const { error } = await supabase.auth.signInWithOtp({
      email: rawEmail,
      options: {
        emailRedirectTo: `${process.env.APP_URL}/auth/callback`,
      },
    })

    if (error) {
      console.error('Error sending OTP:', error)
      // 일반화된 에러 메시지 (구체적 에러 정보는 서버 콘솔에만 남김)
      return NextResponse.json({ error: '인증 메일 발송에 실패했습니다. 잠시 후 다시 시도해주세요.' }, { status: 500 })
    }

    // 발송 성공 시 cooldown 갱신 (테이블 없거나 실패해도 통과)
    try {
      await adminClient
        .from('otp_send_log')
        .upsert({ email: rawEmail, last_sent_at: new Date().toISOString() }, { onConflict: 'email' })
    } catch (logErr) {
      console.warn('[send-otp] cooldown upsert skipped:', logErr)
    }

    return NextResponse.json({ message: 'OTP sent successfully' })
  } catch (err: unknown) {
    console.error('API Error:', err)
    return NextResponse.json({ error: '서버 에러가 발생했습니다.' }, { status: 500 })
  }
}
