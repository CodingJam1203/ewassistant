/**
 * 서버 로그 PII 마스킹.
 *
 * Vercel 로그는 팀원이 열람 가능하고 일정 기간 보관되므로 이메일 등 평문 PII를
 * 그대로 남기지 않는다. 디버그 식별자가 필요하면 user_id (UUID)나 display_name을
 * 함께 로깅.
 */

/**
 * 이메일 마스킹.
 *
 * @example
 *   maskEmail('hrb.main@gmail.com')         → 'h*****n@gmail.com'
 *   maskEmail('ab@nhr.kr')                  → 'a*@nhr.kr'
 *   maskEmail('a@nhr.kr')                   → '*@nhr.kr'
 *   maskEmail(null)                         → 'null'
 *   maskEmail('invalid')                    → 'invalid'  (atsign 없으면 그대로)
 */
export function maskEmail(email: string | null | undefined): string {
  if (!email) return 'null'
  const at = email.indexOf('@')
  if (at < 0) return email
  const local = email.slice(0, at)
  const domain = email.slice(at)  // '@...' 포함
  if (local.length <= 1) return `*${domain}`
  if (local.length === 2) return `${local[0]}*${domain}`
  // 첫 글자 + (*** ...) + 끝 글자
  return `${local[0]}${'*'.repeat(local.length - 2)}${local[local.length - 1]}${domain}`
}
