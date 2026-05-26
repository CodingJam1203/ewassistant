/**
 * Phase B.6 — 시트 entry.name ↔ user_profiles.display_name 매칭 정규화 + 동명이인 처리.
 *
 * 정책:
 *   - normalizeName: NFC + 공백/전각공백 제거 + lowercase + trim.
 *     한글은 lowercase 영향 X. 영문 혼용/공백 변형/trailing whitespace 흡수.
 *   - 매칭 우선순위:
 *       1) sheet_name_overrides (운영자 명시 매핑) — 본부 무관 적용
 *       2) 본부 내 자동 매칭 N=1 → 그 user
 *       3) N=0 또는 N≥2 → 매칭 보류 (사고 방지)
 */

/** 매칭용 이름 정규화 */
export function normalizeName(s: string | null | undefined): string {
  if (!s) return ''
  return s
    .normalize('NFC')
    .replace(/[\s　]+/g, '')  // 일반 공백 + 전각 공백
    .toLowerCase()                  // 한글 무영향, 영문 혼용 흡수
    .trim()
}
