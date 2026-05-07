/**
 * 이메일 알림 유틸리티
 *
 * Resend API 사용 (https://resend.com).
 * 환경변수 미설정 시 콘솔 출력으로 fallback (개발 환경 안전).
 *
 * 환경변수:
 *   NOTIFICATION_EMAIL_TO  - 수신자 이메일 (기본: jmkim@nhr.kr)
 *   RESEND_API_KEY         - Resend API 키 (https://resend.com/api-keys)
 *   RESEND_FROM            - 발신 주소 (기본: 'N-Click <onboarding@resend.dev>')
 *                            ※ Production은 도메인 verify 후 'noreply@your-domain.com' 권장.
 *                              미설정 + 미verified 상태에서는 onboarding@resend.dev 로 fallback.
 *   NEXT_PUBLIC_APP_URL    - 메일 본문에 들어가는 베이스 URL (없으면 APP_URL 또는 도메인 사용)
 */

const ADMIN_NOTIFICATION_EMAIL =
  process.env.NOTIFICATION_EMAIL_TO ?? 'jmkim@nhr.kr'

// Resend free tier에서 verify 없이 쓸 수 있는 sender
const DEFAULT_FROM = 'N-Click <onboarding@resend.dev>'

const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL ??
  process.env.APP_URL ??
  'https://your-domain.com'

// === 타입 ===

export interface NewAccountApprovalPayload {
  email: string
  createdAt: string
}

export interface ConsentCompletedPayload {
  email: string
  displayName: string
  completedAt: string
}

interface SendArgs {
  to: string
  subject: string
  text: string
  html?: string
}

/**
 * Resend API로 메일 발송. throw 안 함.
 */
async function sendViaResend(args: SendArgs): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    console.log('[Email] RESEND_API_KEY 미설정 — 발송 스킵 (콘솔 출력으로 대체)')
    console.log('  To     :', args.to)
    console.log('  Subject:', args.subject)
    console.log('  Body   :\n' + args.text)
    return
  }

  const from = process.env.RESEND_FROM || DEFAULT_FROM

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [args.to],
        subject: args.subject,
        text: args.text,
        ...(args.html ? { html: args.html } : {}),
      }),
    })

    if (!res.ok) {
      const errBody = await res.text().catch(() => '')
      console.error(`[Email] Resend 발송 실패: ${res.status} ${res.statusText}`, errBody)
      return
    }

    const json = await res.json().catch(() => null) as { id?: string } | null
    console.log(`[Email] Resend 발송 성공: id=${json?.id ?? '?'} to=${args.to}`)
  } catch (err) {
    console.error('[Email] Resend 발송 예외:', err)
  }
}

// === 신규 계정 승인 요청 알림 ===

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * 미등록 Google 계정이 처음 로그인하여 is_active=false 로 생성될 때 관리자에게 알림.
 * 본문 링크: ${APP_URL}/admin?highlight=<email> — 클릭 시 관리자 페이지에서 해당 row가 자동 강조됨.
 */
export async function sendNewAccountApprovalEmail(
  payload: NewAccountApprovalPayload
): Promise<void> {
  const { email, createdAt } = payload

  const createdAtKst = new Date(createdAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })
  const adminLink = `${APP_URL}/admin?highlight=${encodeURIComponent(email)}`

  const subject = '[N-Click] 신규 계정 승인 요청'

  const text = [
    '신규 Google 로그인 계정이 생성되었습니다.',
    '',
    `이메일:   ${email}`,
    `가입일시: ${createdAtKst}`,
    '',
    '관리자 페이지에서 본부/팀/이름을 설정하고 잠금을 해제해주세요.',
    adminLink,
  ].join('\n')

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif; max-width: 560px; margin: 0 auto; color: #1f2937;">
      <h2 style="font-size: 18px; margin: 0 0 16px;">신규 계정 승인 요청</h2>
      <p style="margin: 0 0 16px; font-size: 14px; line-height: 1.6;">
        새 Google 로그인 계정이 생성되어 <strong>승인 대기</strong> 상태입니다.
      </p>
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 14px;">
        <tr>
          <td style="padding: 8px 0; color: #6b7280; width: 90px;">이메일</td>
          <td style="padding: 8px 0; font-weight: 500;">${escapeHtml(email)}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #6b7280;">가입일시</td>
          <td style="padding: 8px 0;">${escapeHtml(createdAtKst)} (KST)</td>
        </tr>
      </table>
      <p style="margin: 0 0 20px; font-size: 14px; line-height: 1.6;">
        아래 버튼을 누르면 관리자 페이지로 이동하며, 해당 계정이 자동으로 강조됩니다.
        본부 / 팀 / 이름을 설정한 뒤 잠금을 해제해주세요.
      </p>
      <p style="margin: 0 0 24px;">
        <a href="${escapeHtml(adminLink)}"
           style="display: inline-block; padding: 10px 20px; background: #2563eb; color: #ffffff; text-decoration: none; border-radius: 8px; font-size: 14px; font-weight: 500;">
          관리자 페이지에서 확인
        </a>
      </p>
      <p style="margin: 0; font-size: 12px; color: #9ca3af;">
        본 메일은 N-Click 시스템에서 자동 발송되었습니다.
      </p>
    </div>
  `.trim()

  await sendViaResend({
    to: ADMIN_NOTIFICATION_EMAIL,
    subject,
    text,
    html,
  })
}

// === 약관동의 완료 알림 (이름 포함) ===

/**
 * 신규 가입자가 /consent 에서 이름 입력 + 약관동의 완료한 시점에 호출.
 * 1차 OAuth 알림에는 이메일밖에 없어 누군지 식별 불가 — 이 알림으로 이름까지 같이 받아 admin이 누군지 바로 인지.
 */
export async function sendConsentCompletedEmail(
  payload: ConsentCompletedPayload
): Promise<void> {
  const { email, displayName, completedAt } = payload

  const completedAtKst = new Date(completedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })
  const adminLink = `${APP_URL}/admin?highlight=${encodeURIComponent(email)}`

  const subject = `[N-Click] 가입 동의 완료 — ${displayName}`

  const text = [
    `${displayName} 님이 약관동의 및 이름 입력을 완료했습니다.`,
    '',
    `이름:     ${displayName}`,
    `이메일:   ${email}`,
    `동의일시: ${completedAtKst}`,
    '',
    '관리자 페이지에서 본부/팀을 설정하고 잠금을 해제해주세요.',
    adminLink,
  ].join('\n')

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif; max-width: 560px; margin: 0 auto; color: #1f2937;">
      <h2 style="font-size: 18px; margin: 0 0 16px;">가입 동의 완료</h2>
      <p style="margin: 0 0 16px; font-size: 14px; line-height: 1.6;">
        <strong>${escapeHtml(displayName)}</strong> 님이 약관동의 및 이름 입력을 완료했습니다.<br/>
        본부 / 팀 설정 후 잠금을 해제해주세요.
      </p>
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 14px;">
        <tr>
          <td style="padding: 8px 0; color: #6b7280; width: 90px;">이름</td>
          <td style="padding: 8px 0; font-weight: 600;">${escapeHtml(displayName)}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #6b7280;">이메일</td>
          <td style="padding: 8px 0;">${escapeHtml(email)}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #6b7280;">동의일시</td>
          <td style="padding: 8px 0;">${escapeHtml(completedAtKst)} (KST)</td>
        </tr>
      </table>
      <p style="margin: 0 0 24px;">
        <a href="${escapeHtml(adminLink)}"
           style="display: inline-block; padding: 10px 20px; background: #2563eb; color: #ffffff; text-decoration: none; border-radius: 8px; font-size: 14px; font-weight: 500;">
          관리자 페이지에서 확인
        </a>
      </p>
      <p style="margin: 0; font-size: 12px; color: #9ca3af;">
        본 메일은 N-Click 시스템에서 자동 발송되었습니다.
      </p>
    </div>
  `.trim()

  await sendViaResend({
    to: ADMIN_NOTIFICATION_EMAIL,
    subject,
    text,
    html,
  })
}
