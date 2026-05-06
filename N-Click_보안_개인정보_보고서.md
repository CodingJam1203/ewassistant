# N-Click 보안 및 개인정보 처리 현황 보고서

**작성일**: 2026-05-06
**서비스**: N-Click 출퇴근보고 시스템 (사내 도구)
**문서 목적**: 사내 보안 / 개인정보 담당자 검토 및 운영 승인 자료

---

## 1. 한 줄 요약

N-Click은 사내 구성원의 출퇴근을 효율적으로 보고하고 EW 시스템 입력을 자동화하는 도구입니다. 본 문서는 본 서비스가 적용 중인 **인증·접근 통제·암호화·감사·PII 보호** 등 12개 영역의 보안 통제 현황을 정리합니다.

**핵심 통제 요약**:

| 영역 | 적용 통제 |
|------|-----------|
| 인증 | Google OAuth 2.0 + Supabase Auth (JWT + Refresh Token), 30일 세션 만료 |
| 권한 | 역할 기반(Role-based) + 행 단위 보안(RLS) — 본인 데이터만 조회 |
| 통신 | HTTPS 전 구간, 쿠키 httpOnly + Secure + SameSite=Lax |
| 입력 검증 | zod 스키마 + 길이 상한 + 화이트리스트 도메인 |
| 감사 | 관리자 / 사용자 주요 작업 audit_logs 자동 기록 (IP·User-Agent 포함) |
| PII | 알림 메시지에서 이메일 등 개인 식별자 제거 (이름 또는 라벨로 대체) |
| 비밀 관리 | service_role / OAuth secret / API key 모두 서버 환경변수로 격리 |

---

## 2. 서비스 개요

### 2.1 목적과 범위

- 사내 구성원의 출퇴근 시각·근무지·휴게·휴가 입력 자동화
- EW(Effective Work) 시스템 입력 텍스트 자동 생성 + 클립보드 복사
- 팀 내 출퇴근 현황 실시간 공유 (Microsoft Teams 자동 알림)
- 본 서비스는 **외부에 공개되지 않은 사내 도구**입니다.

### 2.2 사용자 유형

| 유형 | 권한 |
|------|------|
| 일반 사용자 | 본인 출퇴근 보고 작성·수정·조회 |
| 관리자 | 사용자 / 본부 / 팀 / 공지 관리 + 모든 사용자 보고 조회·수정 |
| 부트스트랩 관리자 | 환경변수에 등록된 슈퍼 관리자 (DB 장애 시에도 관리 콘솔 접근 가능) |

### 2.3 시스템 구성

```
[브라우저] ─ HTTPS ─→ [Vercel: Next.js 16]
                          ├─ Server Components (인증된 사용자만)
                          ├─ Route Handlers (API)
                          └─ Middleware (요청별 인증/권한 검증)
                            │
                            ↓
                     [Supabase: Postgres + Auth + RLS]
                            │
                  ┌─────────┼──────────┐
                  ↓         ↓          ↓
              [Resend]  [Make.com]  [Apps Script]
              (메일)   (Teams 알림) (휴가 캘린더)
```

---

## 3. 처리하는 개인정보 항목 (최소 수집)

| 항목 | 수집 근거 | 보유 기간 |
|------|-----------|-----------|
| 이메일 | 로그인 식별자 | 계정 활성 기간 |
| 이름 (display_name) | 보고 작성자 표기 | 계정 활성 기간 |
| 본부 / 팀 / 표시 순서 | 조직 분류, 알림 채널 라우팅 | 계정 활성 기간 |
| 출근 시각 / 퇴근 시각 / 근무지 / 휴게 / 휴가 | 보고 본문 | 계정 활성 기간 또는 회사 정책에 따른 보존 |
| 약관·개인정보 처리방침 동의 시각 + 버전 | 동의 이력 관리 | 회사 정책 |
| 마지막 로그인 시각 | 미사용 계정 식별 | 계정 활성 기간 |
| IP 주소 / User-Agent | **감사 로그(audit_logs)**의 일부 — 관리자·본인 핵심 작업 추적 | 회사 보안 정책 |

**수집하지 않는 정보**:

- 주민등록번호, 신용카드, 의료/생체 정보
- 위치 정보 (GPS) — 근무지는 사용자 입력 텍스트일 뿐
- 단말 식별자 / 디바이스 fingerprint
- 외부 마케팅 데이터

---

## 4. 인증 (Authentication)

### 4.1 로그인 방식

- **1차**: Google OAuth 2.0 (회사 메일 도메인만 허용)
- **2차(보조)**: 이메일 OTP (Magic Link) — Supabase Auth 표준
- 비밀번호 저장 / 검증 로직 자체 보유 안 함 (Identity Provider 위임)

### 4.2 도메인 화이트리스트

```
ALLOWED_EMAIL_DOMAINS=nhr.kr (예시)
```

→ 회사 도메인이 아닌 메일로는 OTP 발송 자체가 거부됨.

### 4.3 OTP 폭주 방지 (Brute force)

- 동일 이메일 60초 cooldown (`otp_send_log` 테이블)
- 60초 내 재요청 시 HTTP 429 반환

### 4.4 신규 계정 자동 잠금 (Default Deny)

신규 계정은 가입 즉시 `is_active=false` 상태로 잠금되어 어떤 페이지도 접근 불가. 관리자가 수동으로 활성화해야 사용 가능.

흐름:

1. 신규 사용자 첫 로그인 → `user_profiles` 자동 생성 (잠금)
2. `/blocked` 페이지로 강제 리다이렉트
3. 시스템이 jmkim@nhr.kr로 승인 요청 메일 자동 발송 (Resend)
4. 관리자가 `/admin?highlight=email` 링크 클릭 → 검토 → 활성화

---

## 5. 세션 및 토큰 관리

| 항목 | 적용값 |
|------|--------|
| Access Token (JWT) 만료 | 1시간 (Supabase 기본) |
| Refresh Token 만료 | 30일 (브라우저 단위) |
| Refresh Token Rotation | 활성화 (재사용 탐지 시 자동 무효화) |
| 30일 세션 정책 | 코드 + Supabase Dashboard "Time-box user sessions" 양쪽에서 강제 |
| 쿠키 보안 옵션 | `httpOnly: true`, `secure: true(prod)`, `sameSite: lax`, `maxAge: 2,592,000초` |
| 다중 기기 격리 | 각 브라우저는 독립 세션 — 한 곳 로그아웃해도 다른 곳 영향 없음 |
| 강제 로그아웃 | Supabase Dashboard에서 사용자별 세션 즉시 무효화 가능 |

쿠키 옵션은 코드에서 강제됨 — Supabase 라이브러리가 받는 옵션을 무시하고 우리 정책으로 덮어쓰기 (`src/lib/supabase/cookie-options.ts`).

---

## 6. 권한 및 접근 통제

### 6.1 역할(Role) 기반

- DB `user_profiles.role` 컬럼: `'user' | 'admin'`
- 부트스트랩 관리자: env `ADMIN_EMAILS` (콤마 구분, 다중 지원). 코드 하드코딩 금지.

### 6.2 행 단위 보안 (Row-Level Security, RLS)

Supabase RLS 정책을 통해 데이터베이스 레벨에서 강제:

| 테이블 | SELECT 정책 | INSERT/UPDATE/DELETE |
|--------|--------------|----------------------|
| `work_logs` | 본인(`user_id = auth.uid()`) 또는 관리자만 | 서버(service_role)만 처리 |
| `user_profiles` | 본인 또는 관리자 | 본인 (제한된 필드) |
| `audit_logs` | 관리자만 | 서버만 |
| `app_settings` | 관리자만 | 관리자만 |

→ Supabase API key가 외부에 노출되더라도 다른 사용자의 work_log 조회 불가능.

### 6.3 미들웨어 가드 (요청별 검증)

모든 페이지 요청 시 `src/proxy.ts`의 미들웨어가 다음을 검증:

1. 인증 토큰 유효성
2. 약관·개인정보 동의 버전 일치 (불일치 시 `/consent`)
3. `is_active === false` 시 `/blocked`
4. 프로필 조회 실패 시 fail-close (통과시키지 않고 `/consent` 리다이렉트)

→ 잠금 / 미동의 / 권한 없는 사용자는 어떤 페이지도 진입 불가.

---

## 7. 입력 검증 (Input Validation)

모든 사용자 입력은 서버에서 검증:

| 영역 | 검증 |
|------|------|
| 일반 폼 | zod 스키마 + 타입 / 형식 / 길이 상한 |
| 이메일 | 형식 검증 + 도메인 화이트리스트 |
| 본부·팀명 | 공백 trim + 100자 상한 |
| 공지 제목 / 본문 | 200자 / 5000자 상한 |
| 사용자 이름 (display_name) | 50자 상한 |
| 출퇴근 시각 | 30분 단위 + 정규식 (`HH:mm`) 검증 |
| JSONB 타임라인 | 구조 검증 (개별 항목 type / startTime / kind 모두 점검) |

→ 거대 페이로드 / SQL injection / XSS payload 모두 1차 차단.

---

## 8. 감사 로그 (Audit Trail)

`audit_logs` 테이블에 다음 작업이 자동 기록됨:

| 작업 | 기록 내용 |
|------|-----------|
| 관리자가 사용자 정보 수정 | 변경된 필드 키 목록 + actor 이메일 + IP + UA |
| 관리자가 사용자 삭제 | 삭제 모드 (auth+cascade / profile-only) + actor |
| 본인 work_log 수정 | 변경된 필드 라벨 + 날짜 |
| 본인 / 관리자 work_log 삭제 | 날짜 + 이름 + actor |

조회 권한: 관리자만 (RLS로 강제).

→ 사고 시 누가 무엇을 언제 어디서 했는지 추적 가능.

---

## 9. PII 보호 (이메일 등 식별자 노출 최소화)

### 9.1 Microsoft Teams 알림에서 이메일 제거

이전 버전에서는 "수정자: user@example.com" 형식으로 메일이 노출됐으나, 2026.05 버전부터 다음과 같이 변경:

- **수정자 / 삭제자**: 이메일 → 표시 이름(`display_name`) 또는 "관리자" 라벨
- **신규 가입 알림**: 본문에서 이메일 라인 제거 (관리자는 페이지 링크 클릭으로 상세 확인)
- **시스템 로그**: 디버그용 콘솔에서도 이메일 대신 이름 사용

### 9.2 에러 메시지 일반화

DB / 라이브러리 에러는 클라이언트에 그대로 노출되지 않도록 일반화:

```
이전:  { "error": "duplicate key value violates unique constraint user_profiles_pkey..." }
이후:  { "error": "사용자 추가에 실패했습니다." }
```

→ 공격자가 시스템 내부 구조(테이블명·컬럼명·constraint)를 추측할 수 없음. 원본 에러는 서버 로그에만 남음.

### 9.3 URL 파라미터 PII 노출 방지

- 검색·페이지 라우팅에 이메일·이름을 평문으로 노출시키지 않음
- 단, 신규 가입 메일의 `/admin?highlight=email` 링크는 **관리자만 받는 메일** 안에 있어 노출 범위 제한적

---

## 10. 외부 연동 보안

| 외부 시스템 | 용도 | 보안 통제 |
|-------------|------|-----------|
| Microsoft Teams (via Make.com Webhook) | 출퇴근 알림 | Webhook URL은 서버 환경변수로만 보관, 클라이언트 노출 없음. 회사 Teams 채널만 발송 대상. |
| Resend | 신규 가입 승인 메일 | API Key는 서버 환경변수. 발송 대상은 단일 운영자(jmkim@nhr.kr). 도메인 verify 후 정식 발신 도메인 사용 권장 |
| Google Apps Script | 휴가 캘린더 조회 | URL은 서버 환경변수. 토큰 옵션 제공. 사용자 요청 핫패스에서 직접 호출 안 하고 DB 캐시 30분 경유. |
| Vercel Cron | 일일 요약 / 리마인더 | `Authorization: Bearer ${CRON_SECRET}` 검증. 환경변수 미설정 시 무조건 500 거부 (fail-close). |

---

## 11. 비밀 관리 (Secrets Management)

| 비밀 | 보관 위치 | 노출 범위 |
|------|-----------|-----------|
| `SUPABASE_SERVICE_ROLE_KEY` | Vercel 환경변수 (서버 전용) | 서버 컴포넌트 / Route Handler 만. `NEXT_PUBLIC_` 접두사 없이 클라이언트 미주입. |
| `RESEND_API_KEY` | Vercel 환경변수 (서버 전용) | 서버 메일 발송 함수만 |
| `MAKE_WEBHOOK_URL` | Vercel 환경변수 (서버 전용) | 서버 알림 발송 함수만 |
| `CRON_SECRET` | Vercel 환경변수 (서버 전용) | Cron 인증 검증만 |
| `LEAVE_CALENDAR_TOKEN` | Vercel 환경변수 (선택) | Apps Script 호출 시만 |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | 클라이언트 노출 OK | publishable key — 단독으로는 RLS에 의해 무력화됨 |

- `.env.local` 파일은 `.gitignore` 등록 (Git 이력에 비밀 누출 없음)
- Vercel 환경변수는 Production / Preview 환경별 분리 가능

---

## 12. 약관·개인정보 동의 흐름

1. 첫 로그인 직후 또는 약관 버전 업데이트 시 `/consent` 페이지로 자동 리다이렉트 (미들웨어 강제)
2. 사용자는 **약관**과 **개인정보처리방침**의 최신 버전(`2026.1`)을 명시적으로 확인
3. 동의 시각 + 버전이 `user_profiles` + `user_policy_consents` 테이블에 이력 누적
4. 동의 전에는 어떤 사내 페이지도 접근 불가
5. 향후 약관 개정 시 `CURRENT_TERMS_VERSION` 상수만 올리면 모든 사용자가 다음 로그인에서 다시 동의 절차

---

## 13. 데이터 보관·파기

### 13.1 계정 삭제

관리자가 사용자 삭제 시:
- `auth.admin.deleteUser` 호출 → 인증 시스템에서 사용자 제거
- ON DELETE CASCADE에 의해 `user_profiles` 자동 삭제
- 이전 work_logs는 익명화 처리 또는 회사 정책에 따라 별도 처리 (현재는 user_id로 연결 유지)

### 13.2 work_logs 소프트 삭제

- 사용자가 본인 보고 삭제 시 `is_deleted=true` 표시 (하드 삭제 아님)
- 감사 / 분쟁 대응을 위해 일정 기간 보관 후 회사 정책에 따라 일괄 파기

### 13.3 백업

- Supabase Pro 플랜의 자동 백업 (일 단위 / Point-in-Time Recovery)
- 백업 데이터도 동일 보안 수준으로 보호됨

---

## 14. 모니터링 및 사고 대응

| 항목 | 체계 |
|------|------|
| 인프라 모니터링 | Vercel Analytics + Logs |
| DB 모니터링 | Supabase Dashboard (쿼리 / 에러 / 사용량) |
| 인증 이벤트 | Supabase Auth Logs (성공·실패 로그인 추적) |
| 애플리케이션 에러 | 서버 콘솔 (Vercel Logs로 통합) |
| 알림 발송 결과 | DB `notification_logs` 테이블 (성공·실패·스킵 사유) |
| 감사 작업 | DB `audit_logs` |

**사고 대응 절차** (보안 이슈 발견 시):

1. 운영 담당자 즉시 통보 (사내 메신저)
2. Vercel에서 영향 범위 확인 (Logs)
3. 필요시 Supabase에서 해당 사용자 세션 강제 만료
4. 코드 hotfix → push → 자동 배포 (Vercel)
5. audit_logs / notification_logs로 영향 사용자 식별
6. 회사 보안팀에 보고 (CISO / DPO)

---

## 15. 적용 통제 요약 — 컴플라이언스 체크리스트

| 항목 | 적용 | 비고 |
|------|:----:|------|
| HTTPS 전 구간 | ✅ | Vercel 자동 SSL |
| 비밀번호 자체 저장 X (IdP 위임) | ✅ | Google OAuth + Supabase Auth |
| 다단계 인증 (MFA) 옵션 | ✅ | Google 계정의 MFA 그대로 활용 |
| 세션 타임아웃 | ✅ | 30일 + Supabase Time-box |
| 다중 기기 세션 격리 | ✅ | 브라우저 단위 |
| 쿠키 보안 (HttpOnly / Secure / SameSite) | ✅ | 코드에서 강제 |
| 역할 기반 접근 통제 | ✅ | user / admin |
| 행 단위 보안 (RLS) | ✅ | 마이그레이션 008 |
| 입력 검증 (zod / 길이 상한) | ✅ | 서버 측 |
| 감사 로그 (Audit Trail) | ✅ | audit_logs 테이블 |
| 에러 메시지 일반화 | ✅ | DB 에러 미노출 |
| 비밀 관리 (환경변수 분리) | ✅ | service_role 서버 전용 |
| Cron 인증 (Bearer Token) | ✅ | CRON_SECRET fail-close |
| OTP 폭주 방지 | ✅ | 60초 cooldown |
| Default Deny (신규 계정 잠금) | ✅ | is_active=false 시작 |
| 약관·개인정보 동의 강제 | ✅ | 미들웨어 가드 |
| PII 노출 최소화 | ✅ | 알림에 이메일 미노출 |
| 외부 연동 비밀 격리 | ✅ | 모든 secret 서버 전용 |
| 자동 백업 | ✅ | Supabase Pro 플랜 |
| 침해 사고 모니터링 | ✅ | Vercel + Supabase + audit_logs |
| 데이터 최소 수집 원칙 | ✅ | 출퇴근 운영에 필요한 항목만 |
| 도메인 화이트리스트 | ✅ | 회사 도메인만 OTP 발송 |

---

## 16. 향후 보강 계획

- 도메인 verify 완료 시 Resend 발신 주소를 회사 도메인으로 정식 전환
- 보안 침해 시도(브루트포스) 자동 IP 차단 추가
- audit_logs 보관 기간·이관 정책 회사 보안팀과 협의
- 매년 약관·개인정보 처리방침 재검토 (`CURRENT_TERMS_VERSION` 갱신)
- 개인정보영향평가(PIA) 요청 시 본 문서 기반으로 진행

---

## 17. 문의

- 시스템 운영 담당: HR임팩트본부 김민재 (jmkim@nhr.kr)
- 보안 / 사고 신고: 사내 보안팀 / CISO
- 본 문서 개정 이력: 1.0 (2026-05-06) — 최초 작성

---

**문서 끝**

본 문서는 사내 검토용으로만 사용되며 외부 배포를 금지합니다.
