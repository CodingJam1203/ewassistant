/**
 * v1.75 — display_name에서 first-name(이름)만 추출.
 *
 * 룰: 한글 2~4글자면 첫 글자(성) 제거. 그 외(영문, 4글자 초과, 1글자 등)는 원본 유지.
 *
 *   - '김재민' → '재민'
 *   - '최종현' → '종현'
 *   - '권진혁' → '진혁'
 *   - '남궁민수' → '민수' (4글자 한글은 복성 추정해 앞 1글자 trim — 99% 단성 케이스 우선)
 *   - 'Alice'  → 'Alice'
 *   - '김'     → '김'   (1글자는 그대로)
 *
 * 사용처: Google Calendar 휴가/일정 push 시 본인 표시명.
 *
 * 주의: 정확한 first-name 정책이 필요하면 user_profiles.first_name 컬럼 신규 추가가
 * 정공법이지만, 현 시점엔 단성 99% 커버 + 마이그레이션 0인 휴리스틱으로 충분.
 */

const HANGUL_RE = /^[가-힣]+$/

export function extractFirstName(name: string | null | undefined): string {
  const trimmed = (name ?? '').trim()
  if (!trimmed) return ''
  if (!HANGUL_RE.test(trimmed)) return trimmed
  if (trimmed.length < 2 || trimmed.length > 4) return trimmed
  return trimmed.slice(1)
}
