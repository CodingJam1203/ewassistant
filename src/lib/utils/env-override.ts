/**
 * Vercel env var의 Preview 환경 override helper.
 *
 * Vercel UI에서 같은 이름 변수를 환경별로 따로 못 만드는 제약 회피용.
 * `_2` 접미사를 붙인 변수가 있으면 우선 적용.
 *
 *   envOverride('ENABLE_TEAMS_NOTIFY')
 *     → process.env.ENABLE_TEAMS_NOTIFY_2 ?? process.env.ENABLE_TEAMS_NOTIFY
 *
 * Production 빌드:  `_2` 미정의 → 운영 값 사용
 * Preview 빌드 (stg/dev): `_2` 정의됨 → Preview 전용 값 사용
 *
 * 주의: NEXT_PUBLIC_ 변수는 빌드 타임 인라인이라 process.env[key] 동적 lookup이
 * 안 됨. NEXT_PUBLIC 변수용은 src/lib/supabase/env.ts처럼 정적 ?? 사용.
 */
export function envOverride(key: string): string | undefined {
  return process.env[`${key}_2`] ?? process.env[key]
}
