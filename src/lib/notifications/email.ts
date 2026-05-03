/**
 * 이메일 알림 유틸리티
 *
 * 현재: console.log / TODO 처리
 * 추후: Resend / SendGrid / Nodemailer 연결
 *
 * 환경변수:
 *   NOTIFICATION_EMAIL_TO   - 수신자 이메일 (기본: jmkim@nhr.kr)
 *   RESEND_API_KEY          - Resend 연결 시 사용
 *   SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS - SMTP 연결 시 사용
 */

const ADMIN_NOTIFICATION_EMAIL =
  process.env.NOTIFICATION_EMAIL_TO ?? 'jmkim@nhr.kr'

// ─── 타입 ────────────────────────────────────────────────────────────────────

export interface NewAccountApprovalPayload {
  email: string
  createdAt: string
}

// ─── 신규 계정 승인 요청 알림 ────────────────────────────────────────────────

/**
 * 미등록 Google 계정이 처음 로그인하여 is_active=false 로 생성될 때 관리자에게 알림
 *
 * TODO: 아래 주석을 해제하고 Resend 또는 SMTP 설정을 완료하면 실제 메일이 발송됩니다.
 */
export async function sendNewAccountApprovalEmail(
  payload: NewAccountApprovalPayload
): Promise<void> {
  const { email, createdAt } = payload

  const subject = '[출퇴근보고 시스템] 신규 계정 승인 요청'
  const body = `
신규 Google 로그인 계정이 생성되었습니다.

이메일:   ${email}
가입일시: ${new Date(createdAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}

관리자 페이지에서 본부/팀/이름을 설정하고 잠금을 해제해주세요.
https://${process.env.NEXT_PUBLIC_APP_URL ?? 'your-domain.com'}/admin
`.trim()

  // ── TODO: 실제 메일 발송 구현 ────────────────────────────────────────────
  //
  // [옵션 A] Resend (권장)
  // import { Resend } from 'resend'
  // const resend = new Resend(process.env.RESEND_API_KEY)
  // await resend.emails.send({
  //   from: 'noreply@your-domain.com',
  //   to: ADMIN_NOTIFICATION_EMAIL,
  //   subject,
  //   text: body,
  // })
  //
  // [옵션 B] Nodemailer (SMTP)
  // import nodemailer from 'nodemailer'
  // const transporter = nodemailer.createTransport({
  //   host: process.env.SMTP_HOST,
  //   port: Number(process.env.SMTP_PORT ?? 587),
  //   auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  // })
  // await transporter.sendMail({
  //   from: process.env.SMTP_USER,
  //   to: ADMIN_NOTIFICATION_EMAIL,
  //   subject,
  //   text: body,
  // })
  // ────────────────────────────────────────────────────────────────────────

  // 현재: 콘솔 출력으로 대체
  console.log('[Email] 신규 계정 승인 요청 알림 (미발송)')
  console.log('  To     :', ADMIN_NOTIFICATION_EMAIL)
  console.log('  Subject:', subject)
  console.log('  Body   :\n' + body)
}
