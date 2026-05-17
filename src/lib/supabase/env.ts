/**
 * Supabase 연결 정보 — 환경별 분기 helper.
 *
 * 정책:
 *   Vercel Production 빌드: `_2` 변수 없음 → 기본(운영) 값 사용
 *   Vercel Preview 빌드 (stg/dev 브랜치): `_2` 변수 set → DEV/STG 공용 값 사용
 *
 * Vercel UI에서 같은 이름 변수를 환경별로 따로 못 만드는 제약 회피.
 * 운영 env는 절대 안 건드리고, Preview 환경에 `_2` 접미사로 신규 변수만 추가하면
 * 자동 분기됨.
 *
 * NEXT_PUBLIC_ 변수는 빌드 타임에 인라인되므로 빌드별로 다른 값이 박힘.
 *   - Production 빌드: `_2` 미정의 → `undefined ?? PROD` → PROD 값
 *   - Preview 빌드:    `_2` 정의됨 → `DEVSTG ?? PROD` → DEVSTG 값
 */

export const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL_2 ?? process.env.NEXT_PUBLIC_SUPABASE_URL!

export const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY_2 ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY_2 ?? process.env.SUPABASE_SERVICE_ROLE_KEY!
