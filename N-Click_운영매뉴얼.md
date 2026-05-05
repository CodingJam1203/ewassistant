# N-Click 출퇴근보고 시스템 운영 매뉴얼

> 본 문서는 일반 사용자, 관리자, 운영 담당자(개발자 포함)가 N-Click 시스템을 이해하고 사용하기 위한 종합 매뉴얼입니다.

---

## 목차

1. 개요
2. 시스템 아키텍처
3. 시작하기 — 인증, 약관 동의, 세션
4. 메인 화면 — 상태 둘러보기
5. 출근 / 자리비움 / 퇴근 흐름
6. 출퇴근 보고서 작성 (WorkLogModal)
7. EW 계산 규칙
8. 휴가 및 반차
9. My Page — 본인 제출 내역
10. 전체 제출 내역
11. 출근보고 (사전 보고)
12. 휴가 캘린더 연동
13. Teams 알림
14. 관리자 기능
15. 공지사항
16. 보안 및 권한
17. 시스템 운영 및 환경 설정
18. 데이터베이스 구조
19. 외부 연동 셋업
20. 트러블슈팅
21. 부록 — 환경변수 / 용어집

---

## 1. 개요

### 1.1 시스템 목적

N-Click은 회사 구성원의 출퇴근 보고를 효율적으로 작성하고, EW(노동시간 측정) 시스템에 입력할 텍스트를 자동 생성하기 위한 사내 도구입니다. 매일 반복되는 보고 양식 작성 부담을 줄이고, 휴가/반차/야근/근무지 변경을 모두 한 곳에서 관리하며, Microsoft Teams 채널과 자동 연동되어 팀이 실시간으로 출퇴근 현황을 공유할 수 있습니다.

### 1.2 사용자 유형

- **일반 사용자**: 본인의 출퇴근만 보고. My Page에서 본인 제출 내역 조회/수정/삭제.
- **관리자**: 일반 사용자 권한 + 사용자 / 본부 / 팀 / 공지 관리.
- **부트스트랩 관리자**: env `ADMIN_EMAILS`에 등록된 슈퍼 관리자. DB 조회 실패 시에도 관리 콘솔 접근 가능.

### 1.3 주요 기능

- Google OAuth 기반 로그인 (브라우저 단위 30일 세션 유지)
- 한 화면에서 팀 전체의 실시간 출퇴근 상태 확인
- 출근 / 휴게 / 퇴근 / 근무지 변경 원클릭 처리
- 30분 단위 출퇴근 시각 / 휴게 / 휴가 입력
- EW 계산 자동화 + 클립보드 복사
- 휴가 / 반차 / 종일 / 부분 다양한 케이스 지원
- Microsoft Teams 채널 자동 알림 (팀별 라우팅)
- Google Sheets 캘린더 연동 (휴가 자동 인식)
- 관리자 페이지(사용자 / 조직구조 관리)
- 일일 자동 요약 (오전 7시) / 출근보고 리마인더 (20시 / 22시)
- 감사 로그 (관리자 작업, 본인 work_log 수정/삭제 기록)

---

## 2. 시스템 아키텍처

```
[브라우저]
  ↓
[Vercel — Next.js 16 (App Router, Turbopack)]
  ├─ Server Components / Route Handlers
  ├─ Middleware (proxy.ts → updateSession)
  └─ Vercel Cron (07:00 / 20:00 / 22:00 KST)
  ↓
[Supabase]
  ├─ Auth (JWT + Refresh Token + RLS)
  ├─ Postgres (work_logs, user_profiles, daily_work_status, …)
  └─ Storage (사용 안 함)
  ↓
[외부 연동]
  ├─ Google Sheets — Apps Script Web App (휴가 캘린더)
  ├─ Make.com Webhook → Microsoft Teams (팀 채널 메시지)
  └─ Resend (관리자 메일 알림)
```

### 2.1 인증 흐름

1. 사용자가 `/login`에서 Google OAuth 또는 이메일 OTP로 로그인
2. Supabase가 access_token (1시간) + refresh_token (30일) 발급
3. `@supabase/ssr` 라이브러리가 쿠키에 저장 (httpOnly, secure, sameSite=lax, maxAge 30일)
4. 매 요청마다 middleware가 토큰 검증 + 자동 갱신
5. 30일 후 또는 로그아웃 시 세션 종료

### 2.2 데이터 흐름

- **출근 / 휴게 / 퇴근 이벤트**: 클라이언트 → API Route → Postgres + Teams Webhook
- **work_log 제출**: WorkLogForm → POST /api/work-logs → Postgres + Teams Webhook
- **상태 조회**: 클라이언트 → GET /api/team-status → Postgres + 캘린더 캐시 → 카드 데이터 반환
- **휴가 캘린더**: cron(07:00) → Apps Script Web App → leave_calendar_cache 갱신 → 사용자 요청 시 캐시 응답 (Stale-While-Revalidate)

---

## 3. 시작하기

### 3.1 회원가입 / 첫 로그인

1. N-Click 주소(`https://your-domain.vercel.app`) 접속 → `/login` 화면 표시
2. **Google 계정으로 로그인** 클릭 → 회사 메일 계정 선택
3. 첫 로그인 시 Supabase Auth가 신규 user 생성 → callback 라우트가 동작
4. callback에서 케이스별 분기:
   - **사전 등록 계정 (pre_approved_emails 테이블)**: 즉시 활성화 + display_name / division / team 자동 설정
   - **완전 신규**: `is_active = false`로 user_profiles 생성 + jmkim@nhr.kr로 승인 요청 메일 발송
   - **재가입 (auth 재생성 / 잠금 재로그인)**: 약관 초기화 + 잠금 상태로 리셋 + 알림 메일 발송

### 3.2 약관 / 개인정보 동의

- 첫 로그인 또는 약관 버전 변경 시 `/consent` 페이지로 자동 리다이렉트
- 현재 버전: `terms_version = 2026.1`, `privacy_version = 2026.1` (`src/lib/policies.ts`에서 관리)
- 동의 버튼 클릭 → user_profiles에 동의 시각 기록 + user_policy_consents 테이블에 이력 누적

### 3.3 계정 승인 흐름

신규 계정은 기본적으로 잠금(`is_active = false`)되어 있어 `/blocked` 페이지로 리다이렉트됩니다. 관리자는:

1. 메일 알림(jmkim@nhr.kr)에서 "관리자 페이지에서 확인" 버튼 클릭
2. `/admin?highlight=user@example.com`으로 자동 이동 → 해당 row 강조됨
3. 본부 / 팀 / 이름 설정 (편집 모달)
4. 잠금 해제 토글 클릭 → `is_active = true`로 변경
5. 다음 로그인부터 정상 사용 가능

### 3.4 30일 세션 유지 정책

- 한 브라우저에서 한 번 로그인하면 30일간 자동 로그인 유지
- 브라우저 닫고 다시 열어도 30일 이내면 그대로 유지
- 다른 브라우저 / 다른 기기는 별도 세션 (공유 안 됨)
- 30일 경과 시 자동 로그아웃 → 재로그인 필요
- 로그아웃 버튼 클릭 시 즉시 세션 / 쿠키 삭제

기술적으로는 `src/lib/supabase/cookie-options.ts`의 `withSessionCookieDefaults()`가 모든 sb 쿠키에 다음 옵션을 강제합니다:

| 옵션 | 값 |
|------|------|
| maxAge | 2,592,000 (30일) |
| httpOnly | true |
| secure | true (production) / false (localhost) |
| sameSite | lax |
| path | / |

### 3.5 잠금 / 비활성 / 차단

- `is_active = false` → middleware가 `/blocked` 리다이렉트
- 약관 버전 미일치 → `/consent` 리다이렉트 (필수 동의 후 진입)
- 프로필 조회 실패 → `/consent` 리다이렉트 (fail-close 정책)

### 3.6 로그아웃

상단 Navbar 우측의 로그아웃 아이콘 클릭 → 서버에서 Supabase signOut() 호출 → 모든 sb 쿠키 즉시 삭제 → `/login`으로 리다이렉트

---

## 4. 메인 화면 — 상태 둘러보기 (`/team`)

로그인 후 기본 진입 페이지입니다.

### 4.1 화면 구성

- **상단 헤더**: 좌측 N-Click 로고, 우측 사용자 이름 + 로그아웃 아이콘
- **본부 / 팀 / 날짜 필터**: 기본은 본인의 본부와 팀, 오늘 날짜
- **새로고침 버튼**: 우측 — 카드 데이터를 즉시 갱신
- **카드 그리드**: 팀원별 카드 (display_order 순)

### 4.2 카드 표시 정보

각 카드에는 다음 정보가 표시됩니다:

- 이름 / 본부 / 팀 / 자기 자신 표시
- 상태 색상 (초록 = 근무 중, 노랑 = 휴게, 회색 = 퇴근 / 미출근, 파랑 = 휴가)
- 상태 텍스트 ("출근 09:00", "휴게 중", "퇴근 18:00 / EW 8.0" 등)
- 현재 근무지 (사무실 / 재택 / 외근 등)
- 출근 / 휴게 / 퇴근 시각
- EW 값 (퇴근 후)
- 마지막 이벤트 시각 (work_status_events 기준)
- 캘린더 휴가 배지 (Google Sheets 캘린더에 휴가 키워드 있을 때)

### 4.3 본인 카드 액션 버튼

본인 카드에는 시점에 따라 다른 버튼이 표시됩니다:

| 상태 | 표시되는 버튼 |
|------|---------------|
| 미출근 | 출근, 출근시각 직접 입력 |
| 출근 후 | 휴게 시작, 근무지 변경, 퇴근, 출근 취소 |
| 휴게 중 | 휴게 종료 |
| 퇴근 후 | 퇴근보고 작성 (없으면), 퇴근 취소 |
| 보고 작성 후 | 보고 수정 (My Page에서) |

### 4.4 다른 팀원 카드 보기

다른 팀원 카드는 정보만 표시됩니다(액션 버튼 없음). 관리자라도 다른 사람 대신 출퇴근을 찍을 수는 없습니다(Teams 알림 발신자 정확성 보장).

### 4.5 부서 / 팀 / 날짜 필터

- **본부 / 팀**: 드롭다운 — 본부 변경 시 팀 옵션 자동 갱신
- **날짜**: 좌우 화살표 또는 직접 입력 — 과거/미래 모두 가능
- 본인이 일반 사용자면 본인 본부 안에서만 선택 가능 (관리자는 모든 본부)

---

## 5. 출근 / 자리비움 / 퇴근 흐름

### 5.1 출근

- **출근 버튼**: 즉시 현재 시각으로 출근 처리. 30분 단위로 자동 반올림되지 않음(실시간 시각). 다만 work_log 작성 시 30분 단위로 반올림.
- **출근시각 직접 입력**: 모달이 뜨고 30분 단위 select에서 시각을 선택. 늦은 출근 / 깜빡한 출근에 사용.

출근 시:
- daily_work_status에 `checked_in_at` 기록
- work_status_events에 'check_in' 이벤트 추가
- work_location_timeline에 첫 항목 (사무실 등) 추가
- Teams 출근보고 채널에 알림 발송

### 5.2 휴게 시작 / 종료

- **휴게 시작**: 카드 색상이 노랑으로 변경. `break_started_at` 기록.
- **휴게 종료**: 카드 색상 복귀. `break_ended_at` 기록 + `break_auto_actual_minutes`에 누적.
- 휴게 시작 → 종료 사이 시간이 자동으로 work_log의 휴게시간에 포함됩니다.
- 점심시간(예: 12:00 ~ 13:00)은 EW 계산기가 자동으로 제외하므로, 추가로 휴게로 입력하지 않아도 됩니다.

### 5.3 근무지 변경

- 카드의 "근무지 변경" 버튼 → 모달에서 새 근무지(사무실/재택/외근/기타) + 변경 시각 선택
- work_location_timeline에 새 항목 추가됨
- Teams에 근무지 변경 알림 발송 (출근보고 채널)

### 5.4 퇴근 / 퇴근보고

퇴근에는 두 가지 흐름이 있습니다.

**A. 단순 퇴근 (보고서는 나중에)**
- "퇴근" 버튼 클릭 → daily_work_status `checked_out_at` 기록 → Teams 알림 발송
- work_log는 아직 미작성 상태 → 카드에 "퇴근보고 작성" 버튼이 남음

**B. 퇴근 + 보고서 동시 작성** (권장)
- "퇴근보고 작성" 버튼 클릭 → WorkLogModal 열림
- 본인의 오늘 work_location_timeline / 휴게 / 출퇴근 시각이 자동으로 prefill됨
- 모달에서 검토 후 "제출 및 복사하기" 클릭 → work_log 저장 + 자동 퇴근 처리 + EW 텍스트 클립보드 복사

### 5.5 출근 / 퇴근 취소

잘못 누른 경우 카드의 "출근 취소" / "퇴근 취소" 버튼으로 즉시 되돌릴 수 있습니다. Teams에도 정정 알림이 발송됩니다.

---

## 6. 출퇴근 보고서 작성 (WorkLogModal)

### 6.1 모달 구조

- 좌측 2/3: WorkLogForm (입력 영역)
- 우측 1/3: CalculationPreview (실시간 EW 계산 결과)
- 헤더: 제목 + 날짜 + 닫기 버튼

### 6.2 입력 필드

#### 근무유형
- **기본근무 등록**: 일반 평일 근무
- **간주근로 등록**: 외근 / 출장 등 근무 시간 측정 어려운 경우
- **공휴일근로 등록**: 공휴일 출근 시

#### 근무장소 타임라인
- 출근 시점부터 퇴근까지의 근무지 이력
- 시각(30분 단위) + 종류 (사무실/재택/외근/기타) + 기타일 경우 직접 입력
- 출근 후 자동 누적된 timeline이 prefill되며, 필요시 추가 / 수정 가능
- 마지막 항목은 자동으로 `'checkout'` kind로 표시됨

#### 휴가 / 반차 타임라인
- 휴가나 반차 사용 시 입력
- 종류 (종일 / 오전반차 / 오후반차) + 시작 시각 + 종료 시각 + 차감 시간
- 자동 차감 시간 (종일 8h, 반차 4h)에서 사용자가 select로 변경 가능
- EW 계산기가 자동으로 leaveMinutes를 work_minutes에서 차감

#### 출근 / 퇴근 시각
- 30분 단위 select (00:00 ~ 23:30)
- 본문 timeline의 첫 항목 / 마지막 항목 시각이 자동 반영됨
- 조정하면 timeline도 자동 조정

#### 휴게시간
- **자동 모드** (기본): 휴게 시작-종료 누적값 + 30분 반올림
- **수동 모드**: 직접 입력 (30분 단위)
- 점심시간(11:30 ~ 13:30)은 EW 계산기가 자동 처리하므로 별도 입력 불필요
- 휴게사유 (선택): 자유 입력

#### 근무내용
- 오늘 한 일 간단히 (자유 텍스트)
- Teams 메시지에도 포함됨

#### 지각 / 당일수정
- 지각이거나 출근 후 시간이 변경된 경우에 사용
- "예" 선택 시 추가 필드 등장: 이전 보고시각, 변경 보고시각, 지각 사유

#### 다음 출근 예정 (출근보고 진행 시만)
- attendance_record_type = "출근보고 진행 (주말출근, 휴가 포함)" 선택 시 표시
- 다음 근무일 + 시각 + 근무지 + 휴가/반차 입력
- 매일 저녁 20시 / 22시 cron이 출근보고 미작성자에게 리마인더 발송

### 6.3 EW 계산 미리보기

우측 패널에서 입력값에 따라 실시간으로 EW 값이 계산됩니다.

- 실근무시간 = 퇴근 - 출근 - 휴게 - 점심 - 휴가
- 30분 단위 반올림
- 야간 / 주말 / 공휴일 보정 자동 적용

### 6.4 EW 복사 텍스트

제출 시 자동 생성되어 클립보드에 복사되는 텍스트 예시:

```
2026-05-04
이름 : 김민재
출근 : 09:00 (사무실)
퇴근 : 18:00 (사무실)
실근무 : 8.0
휴게 : 1.0 (점심)
근무내용 : 보안 패치 + 가이드 작성
EW : 8.0
```

(실제 형식은 messages.ts의 `worklog_*` 케이스 참조)

### 6.5 제출 흐름

1. **제출 및 복사하기** 클릭
2. POST /api/work-logs → DB 저장
3. (편집 모드면 PATCH) → 변경 필드만 비교해서 수정 알림
4. 신규 모드 → check-out API 자동 호출 (퇴근 처리)
5. Teams 알림 발송 (worklog_submitted 또는 worklog_updated)
6. 클립보드에 EW 텍스트 복사
7. 모달 닫힘 + 카드 새로고침

### 6.6 수정 모드

My Page / 전체 제출 내역에서 "수정" 아이콘 클릭 시 모달이 그대로 열리며, 모든 필드가 prefill됩니다. 변경 후 "제출 및 복사하기" 클릭 시 PATCH 요청 + Teams `worklog_updated` 알림 발송.

---

## 7. EW 계산 규칙

### 7.1 기본 공식

```
실근무 (분) = 퇴근시각 - 출근시각 - 휴게시간 - 점심시간 - 휴가차감
EW (시간)   = 실근무 / 60 (30분 단위 반올림)
```

### 7.2 점심시간 처리

- 출근 ≤ 11:30 AND 퇴근 ≥ 13:30 → 자동으로 60분 차감 (점심)
- 그 외에는 차감 안 함
- 휴가가 점심시간을 포함하면 중복 차감 방지 로직 적용 (`leaveIncludesLunch`)

### 7.3 휴가 / 반차 차감

- 휴가차감 = leaveMinutes (휴가 timeline의 차감 시간 합)
- 종일 휴가 → 480분 (8h) 차감 → EW 0
- 오전 반차 + 오후 근무 → 240분 차감 + 실제 근무한 시간 계산

### 7.4 30분 단위 반올림

- 실근무 분이 30분 미만 → 0으로 반올림
- 30 ~ 59분 → 30분
- 60 ~ 89분 → 60분 (1.0h)
- ...

### 7.5 야간 / 주말 / 공휴일 보정

- 22:00 이후 또는 06:00 이전 근무는 야간으로 표시 (별도 보정 없음 — EW 시스템이 자체 처리)
- 주말 / 공휴일 근로는 work_type_label로 구분되어 EW 메시지에 반영

---

## 8. 휴가 및 반차

### 8.1 휴가 종류

- **종일 휴가** (full_day): 8시간 차감
- **오전 반차** (morning_half): 4시간 차감 (보통 09:00~13:00)
- **오후 반차** (afternoon_half): 4시간 차감 (보통 14:00~18:00)

### 8.2 차감 시간 사용자 조정

기본 차감(8h / 4h)에서 select로 변경 가능합니다. 예를 들어:

- 오전 반차인데 30분 일찍 와서 09:00~12:30 4시간을 정확히 차감 → 4h 그대로
- 오후 반차인데 14:00~16:30만 사용 → 2.5h로 변경

### 8.3 휴가 + 출근 (반차)

반차 사용 시 휴가 외 시간은 정상 출근/근무로 처리됩니다. 예: 오전 반차 후 13:00 출근 → check-in 시각 13:00, 휴가 차감 4h.

### 8.4 종일 휴가 카드 표시

종일 휴가를 입력한 사람은 카드가 파란 색상 + "휴가" 배지로 표시됩니다. 출퇴근 버튼 대신 휴가 안내가 보입니다.

---

## 9. My Page (`/my-logs`)

### 9.1 기능

- 본인이 제출한 모든 work_log 목록
- 컬럼: 제출일시, 근무일, 이름, 근무장소, 출퇴근, 실근무/휴게, EW, 유형, 메모, 수정/삭제
- 복사 버튼: 각 행의 EW 텍스트 클립보드 복사
- 수정 아이콘: WorkLogModal 열림 → 수정 모드
- 삭제 아이콘: 확인 후 삭제 (Teams 삭제 알림 발송)

### 9.2 날짜 필터

상단 입력란에 특정 날짜 입력 시 해당 날짜 보고만 필터링.

### 9.3 정렬

기본 최신 순 (created_at 내림차순). API 기본 limit 200건.

---

## 10. 전체 제출 내역 (`/history`)

### 10.1 기능

- 모든 사람의 work_log 조회 (본인의 본부 / 팀 단위)
- 관리자는 본부 / 팀 필터로 모든 데이터 조회 가능
- 컬럼은 My Page와 동일

### 10.2 필터

- 본부 / 팀 / 이름 / 날짜 / 본인만
- 본부 변경 시 팀 옵션 자동 갱신

### 10.3 권한

- 일반 사용자: 본인의 본부 / 팀 안에서만 조회
- 관리자: 모든 본부 / 팀 조회 + 다른 사람 work_log 수정 / 삭제 가능

---

## 11. 출근보고 (사전 보고)

### 11.1 목적

야근 / 주말근무 / 외근 등으로 평소 출근 패턴이 아닌 경우, 다음 근무일을 미리 보고하기 위한 기능.

### 11.2 작성 방법

퇴근보고 모달에서 attendance_record_type을 "출근보고 진행 (주말출근, 휴가 포함)" 선택 → "다음 출근 예정" 섹션 표시 → 날짜 / 시각 / 근무지 / 휴가 입력.

### 11.3 자동 리마인더

- 매일 20:00 KST: `/api/cron/reminder-20` → 본부별로 다음 날 출근보고 미작성자 명단 발송
- 매일 22:00 KST: `/api/cron/reminder-22` → 동일 (재차 알림)

### 11.4 메시지 형식

```
🕘[ 2026/05/05(화) 출근 보고 ]
🔹 김민재
- 본부: HR마케팅본부
- 팀명: HR마케팅2팀
- 출근 예정 날짜: 2026-05-05
- 출근 예정 시간: 09:00
- 출퇴근 예정 장소: 사무실
- 출근기록 선택 유형: 출근보고 진행
```

---

## 12. 휴가 캘린더 연동

### 12.1 흐름

1. 회사가 운영하는 Google Sheets 캘린더에 본부별 휴가 / 일정 입력
2. Google Apps Script Web App이 시트 데이터를 JSON으로 노출
3. N-Click이 매일 07:00 cron + 사용자 요청 시 (cache miss) Apps Script 호출
4. `leave_calendar_cache` 테이블에 결과 저장 (TTL 30분, Stale-While-Revalidate)
5. 카드 / 모달에서 휴가 배지 자동 표시

### 12.2 시트 형식

- 시트별 본부 (본부명 = 시트 이름)
- 첫 컬럼: 이름
- 날짜 컬럼: 셀 값에 휴가 키워드 / 시간 범위 / 일정명 등 자유 입력
- 키워드 인식: "휴가", "연차", "오전반차", "오후반차", "반차"
- 시간 범위: `<10:00~12:00> 미팅` 형식

### 12.3 Apps Script 셋업

`docs/apps-script-setup.md` 또는 `src/lib/leave-calendar.ts`의 주석 참조. 환경변수:

- `LEAVE_CALENDAR_WEBHOOK_URL`: Apps Script 배포 URL
- `LEAVE_CALENDAR_TOKEN`: 토큰 (선택, 보안 강화용)

### 12.4 캐시 정책

- 사용자 요청 hot path: cache hit이면 즉시 반환, stale이면 즉시 반환 + 백그라운드 갱신
- 캐시 자체 없음 (cold start): 4초 동기 호출, 실패 시 null
- cron 강제 갱신: 15초 timeout
- 결과: 사용자 체감 외부 fetch 대기 거의 0초

---

## 13. Teams 알림

### 13.1 발송 시점

| 이벤트 | 발송 채널 | 메시지 |
|--------|-----------|--------|
| 출근 (check_in) | 출근보고 | "{이름} : {날짜} {시각} 출근" + 근무지 / 휴가 정보 |
| 휴게 시작 | 출근보고 | "🍵{이름} 휴게 시작 / {날짜}" |
| 휴게 종료 | 출근보고 | "🍵{이름} 휴게 종료 / {날짜}" |
| 근무지 변경 | 출근보고 | "📍{이름} 근무지 변경" |
| 출근 취소 | 출근보고 | "❌{이름} 출근 취소" |
| 퇴근 (보고서 제출) | 퇴근보고 | EW / 근무내용 / 휴가 등 풀 정보 |
| 퇴근보고 재제출 | 퇴근보고 | "📌{이름} 퇴근보고 재제출" |
| 보고서 수정 | 보고서가 출근보고면 출근보고 채널, 퇴근보고면 퇴근보고 채널 | "[수정] {이름} 보고 수정" + 변경 필드 / 수정자 이름 |
| 보고서 삭제 | 퇴근보고 | "🗑️{이름} 기록 삭제" + 삭제자 이름 |
| 출근보고 (사전 보고) | 출근보고 | "📌{이름} 출근보고" |
| 일일 요약 (07:00) | 출근보고 | "🌅 [날짜] 출근 보고" + 휴가자 / 출근완료 / 출근필요 / 오후출근필요 섹션 |
| 출근보고 리마인더 (20/22시) | 출근보고 | 다음 날 출근보고 미작성자 명단 |

### 13.2 라우팅

`src/lib/notifications/teams-routing.ts`의 매핑 테이블에서 본부 + 팀 + 보고타입 → teamId / channelId / messageId 매핑. 매핑 누락 시 SKIPPED 로그 + DB notification_logs에 기록.

### 13.3 발송 방법

Make.com Webhook → Microsoft Teams "Reply to Channel Message" 액션. 매 메시지가 기존 thread에 reply 형태로 추가됨.

### 13.4 이메일 노출 금지

수정자 / 삭제자 / 신규 가입 알림에서는 이메일 대신 사용자 이름(display_name) 또는 "관리자" 라벨로 표시. PII 보호.

### 13.5 비활성화

env `ENABLE_*_NOTIFY=false`로 이벤트별 알림 끌 수 있음:
- `ENABLE_CHECKIN_NOTIFY`
- `ENABLE_CHECKOUT_NOTIFY`
- `ENABLE_BREAK_NOTIFY`
- `ENABLE_LOCATION_NOTIFY`
- `ENABLE_DAILY_REMINDER_NOTIFY`
- `ENABLE_MORNING_SUMMARY_NOTIFY`
- 등

---

## 14. 관리자 기능 (`/admin`)

관리자(role='admin' 또는 ADMIN_EMAILS)만 접근 가능. Navbar에 "관리자" 메뉴 표시.

### 14.1 사용자 관리

- 사용자 목록 (이메일, 이름, 본부, 팀, 권한, 상태, 표시 순서, 최근 로그인, 최근 제출)
- 편집: 본부 / 팀 / 이름 / 권한 / 표시 순서 / 이메일 변경
- 잠금 / 해제 토글
- 삭제 (관리자 계정은 보호됨)
- 새 계정 사전 등록 (pre_approved_emails)

### 14.2 신규 가입자 처리

메일 알림에서 `?highlight=email` 링크 클릭 → 자동 스크롤 + 노란색 강조 (6초). 클릭하지 않아도 사용자 목록 상단에 잠금 상태로 표시됨.

### 14.3 본부 / 팀 구조 관리

페이지 상단 "조직 구조 관리" 토글 → 본부 / 팀 추가 / 수정 / 삭제. 본부 삭제 시 하위 팀 모두 삭제됨.

### 14.4 알림 발송 내역 (`/admin/notifications`)

Teams 알림이 어떤 결과로 처리됐는지 확인 (SUCCESS / FAILURE / SKIPPED). 라우팅 누락 / Webhook 실패 디버그용.

### 14.5 감사 로그

`audit_logs` 테이블 — 다음 작업이 기록됨:
- admin/users PATCH (필드 키 목록)
- admin/users DELETE (auth+cascade 또는 profile-only 모드)
- work-logs PATCH (본인 또는 관리자, 변경 필드 라벨)
- work-logs DELETE (본인 또는 관리자, 날짜 / 이름)

기록 컬럼: actor_id, actor_email, action, target_table, target_id (text), details (jsonb), ip_address, user_agent, created_at

---

## 15. 공지사항

`service_notices` 테이블에 관리자가 작성하는 공지를 저장. (UI 노출 위치는 별도 페이지 또는 Navbar 배지로 — 현재 구현 단계에 따라 다름.)

### 15.1 공지 필드

- title (200자 max)
- content (5000자 max)
- notice_type (general / maintenance 등)
- is_pinned (상단 고정)
- is_active (표시 여부)
- starts_at / ends_at (표시 기간)
- created_by (관리자 이메일)

---

## 16. 보안 및 권한

### 16.1 인증

- Supabase Auth (JWT + Refresh Token)
- 30일 세션 (브라우저 단위)
- 쿠키: httpOnly, secure(prod), sameSite=lax, maxAge 30일

### 16.2 역할

- `user`: 일반 사용자 (기본값)
- `admin`: 관리자 (DB role 또는 ADMIN_EMAILS env)

### 16.3 RLS (Row Level Security)

마이그레이션 008에서 정의됨:

- **work_logs SELECT**: 본인 (`user_id = auth.uid()`) 또는 관리자 (`is_admin()`)만
- **profiles UPDATE**: 본인만 (admin 변경은 service_role API 통해서만)
- **audit_logs SELECT**: 관리자만
- **app_settings**: 관리자만 SELECT/UPDATE

### 16.4 입력 검증

- zod 스키마: admin/notices, auth/profile 등
- 길이 상한: 이름 100자, 제목 200자, 본문 5000자, display_name 50자
- 이메일 형식 검증 (send-otp 등)

### 16.5 에러 메시지 일반화

운영 환경에서는 DB / 라이브러리 에러를 그대로 클라이언트에 노출하지 않음. 일반화된 메시지 ("저장 중 오류가 발생했습니다.") 반환 + 서버 로그에는 원본 에러 기록.

### 16.6 CRON_SECRET 검증

`/api/cron/*` 라우트는 `Authorization: Bearer ${CRON_SECRET}` 헤더 검증. env 미설정 시 무조건 500 반환 (fail-close).

### 16.7 Send-OTP Cooldown

같은 이메일에 60초 내 재발송 차단 (otp_send_log 테이블).

### 16.8 부트스트랩 관리자 보호

ADMIN_EMAILS 등록된 계정은 다음에서 보호됨:
- 다른 관리자가 비활성화 / 삭제 / 권한 강등 불가
- 이메일 변경 불가

### 16.9 미들웨어 fail-close

middleware에서 user_profiles 조회 실패 시 통과시키지 않고 `/consent`로 리다이렉트 (이전 버전은 통과시켜 보안 hole 있었음).

---

## 17. 시스템 운영 및 환경 설정

### 17.1 배포 환경

- **호스팅**: Vercel (Hobby / Pro 플랜)
- **프레임워크**: Next.js 16.2.4 (App Router, Turbopack)
- **런타임**: Node.js 20+
- **빌드**: `npm run build`

### 17.2 환경 변수

#### 필수

| 변수 | 설명 | 예시 |
|------|------|------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase Project URL | `https://xxxx.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key (publishable) | `eyJhb...` |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role key (서버 전용) | `eyJhb...` |
| `APP_URL` | 배포 도메인 | `https://your-domain.vercel.app` |
| `NEXT_PUBLIC_APP_URL` | 클라이언트 노출용 도메인 | 동일 |
| `ALLOWED_EMAIL_DOMAINS` | OTP 허용 도메인 콤마 구분 | `nhr.kr,company.com` |

#### 관리자 / 알림

| 변수 | 설명 |
|------|------|
| `ADMIN_EMAILS` | 부트스트랩 관리자 이메일 (콤마 구분) |
| `MAKE_WEBHOOK_URL` | Make.com 웹훅 URL |
| `RESEND_API_KEY` | Resend 메일 API 키 |
| `RESEND_FROM` | 발신 주소 (도메인 verify 후) |
| `NOTIFICATION_EMAIL_TO` | 가입 알림 수신 (기본 jmkim@nhr.kr) |
| `CRON_SECRET` | Vercel Cron 인증용 |

#### 휴가 캘린더

| 변수 | 설명 |
|------|------|
| `LEAVE_CALENDAR_WEBHOOK_URL` | Apps Script Web App URL |
| `LEAVE_CALENDAR_TOKEN` | 토큰 (선택) |

#### 기능 토글

| 변수 | 설명 |
|------|------|
| `ENABLE_CHECKIN_NOTIFY` | 출근 알림 (기본 true) |
| `ENABLE_CHECKOUT_NOTIFY` | 퇴근 알림 |
| `ENABLE_BREAK_NOTIFY` | 휴게 알림 |
| `ENABLE_LOCATION_NOTIFY` | 근무지 변경 알림 |
| `ENABLE_DAILY_REMINDER_NOTIFY` | 20/22시 리마인더 |
| `ENABLE_MORNING_SUMMARY_NOTIFY` | 07시 요약 |
| `ENABLE_TEAMS_NOTIFY` | Teams 알림 마스터 토글 |

### 17.3 Vercel Cron 설정

`vercel.json`의 crons 섹션 (또는 Vercel 대시보드):

```json
{
  "crons": [
    { "path": "/api/cron/morning-summary", "schedule": "0 22 * * *" },
    { "path": "/api/cron/reminder-20",     "schedule": "0 11 * * *" },
    { "path": "/api/cron/reminder-22",     "schedule": "0 13 * * *" }
  ]
}
```

UTC 기준이므로 KST = UTC+9. 22:00 UTC = 07:00 KST.

### 17.4 Supabase Dashboard 설정

#### Authentication → Sessions

- **Time-box user sessions**: ON, 2592000초 (30일)
- **Inactivity timeout**: OFF (또는 매우 길게)

#### Authentication → JWT Settings

- **Access token (JWT) expiry time**: 3600 (1시간) — 기본값 그대로

#### Authentication → URL Configuration

- **Site URL**: `https://your-domain.vercel.app`
- **Redirect URLs**: `https://your-domain.vercel.app/auth/callback` 추가

#### Authentication → Providers → Google

- Google OAuth Client ID / Secret 등록
- Authorized redirect URIs에 Supabase가 알려주는 callback URL 추가 (Google Cloud Console에서)

### 17.5 마이그레이션 적용 순서

```
001_init.sql                  ← 초기 스키마
002_add_fields.sql            ← 추가 필드
003_notification_logs.sql     ← Teams 알림 로그
004_work_location_timeline.sql
005_work_location_timeline.sql
006_leave_and_break.sql       ← 휴가 timeline + 휴게 4컬럼
007_leave_calendar_cache.sql  ← 캘린더 캐시 테이블
008_security_hardening.sql    ← RLS 좁히기 + audit_logs 정리
009_perf_indexes.sql          ← 성능 인덱스
```

새 환경에 처음 적용할 때는 위 순서대로 SQL Editor에서 실행. 기존 환경은 008/009만 적용하면 됨.

---

## 18. 데이터베이스 구조 (주요 테이블)

### 18.1 user_profiles
- `id` (uuid, PK, references auth.users)
- `email` (text, unique)
- `display_name`, `division`, `team`
- `role` ('user' / 'admin')
- `is_active` (bool)
- `display_order` (int)
- `terms_version`, `privacy_version`, `terms_agreed_at`, `privacy_agreed_at`
- `last_login_at`, `last_submitted_at`

### 18.2 work_logs
- `id` (uuid, PK)
- `user_id`, `user_email`, `name`
- `work_type_label`, `work_type_code`
- `leave_date`, `start_time`, `end_time`
- `break_time`, `break_reason`, `break_auto_*`, `break_manual_*`, `break_final_*`
- `work_location`, `work_content`
- `late_or_attendance_status`, `previous_report_time`, `current_report_time`, `late_reason`
- `report_type`, `expected_start_date`, `expected_work_time`, `expected_work_location`
- `work_location_timeline` (jsonb), `expected_work_location_timeline` (jsonb)
- `leave_timeline` (jsonb), `expected_leave_timeline` (jsonb)
- `actual_work_time`, `ew_value`, `copy_text`
- `is_deleted`, `deleted_at`, `deleted_by`
- `updated_at`, `updated_by`

### 18.3 daily_work_status
- 사용자별 오늘 상태 캐시 (출근/퇴근/휴게 시각, 현재 근무지)
- `user_email`, `work_date`, `current_location`, `checked_in_at`, `checked_out_at`, `break_started_at`, `break_ended_at`, `is_on_break`

### 18.4 work_status_events
- 모든 출퇴근 이벤트 raw 로그
- `user_email`, `work_date`, `event_type`, `event_value` (jsonb), `event_at`

### 18.5 audit_logs
- `actor_id`, `actor_email`, `action`, `target_table`, `target_id` (text), `details` (jsonb), `ip_address`, `user_agent`, `created_at`

### 18.6 notification_logs
- Teams 알림 발송 결과
- `event_type`, `status` (SUCCESS/FAILURE/SKIPPED), `department`, `team`, `channel_id`, `payload` (jsonb), `error_message`

### 18.7 기타
- `org_divisions`, `org_teams` (조직 구조)
- `pre_approved_emails` (사전 등록)
- `service_notices` (공지사항)
- `leave_calendar_cache` (캘린더 캐시)
- `otp_send_log` (OTP cooldown)
- `app_settings` (운영 설정)
- `user_policy_consents` (약관 동의 이력)

---

## 19. 외부 연동 셋업

### 19.1 Make.com → Microsoft Teams

1. Make.com에서 새 Scenario 생성
2. Webhook (Custom) 모듈 추가 → URL 복사 → Vercel env `MAKE_WEBHOOK_URL`에 등록
3. Microsoft Teams 모듈 추가 → "Reply to Channel Message" 액션 선택
4. 라우팅 매핑 (teams-routing.ts에 정의):
   - `teamId`: Teams team ID
   - `channelId`: 채널 ID
   - `messageId`: 메시지 thread ID (reply 대상)
5. Webhook payload에서 `message`, `messageHtml`, `messageText`, `eventType` 사용

### 19.2 Resend (메일)

1. https://resend.com 가입
2. API Keys 메뉴 → Create API Key (Sending access) → 복사 → Vercel env `RESEND_API_KEY`
3. (선택) Domains → Add Domain → DNS 레코드 추가 → verify
4. (선택) Vercel env `RESEND_FROM = "N-Click <noreply@verified-domain.com>"`
5. verify 안 한 free tier에서는 `onboarding@resend.dev` 발신, 수신자는 Resend 가입 이메일로만 가능

### 19.3 Google Sheets / Apps Script

1. 본부별 시트가 있는 Google Spreadsheet 준비 (시트 이름 = 본부명)
2. Apps Script 편집기 열기 → 코드 붙여넣기 (별도 가이드 참조)
3. Web App으로 배포 (실행 권한: 본인, 액세스: 모든 사용자)
4. 배포 URL → Vercel env `LEAVE_CALENDAR_WEBHOOK_URL`
5. (선택) 토큰 추가: env `LEAVE_CALENDAR_TOKEN`

---

## 20. 트러블슈팅

### 20.1 로그인 안 됨

- Google OAuth 연동 확인: Supabase Auth → Providers → Google 활성 / Client ID·Secret 정확
- Authorized redirect URI: `https://<project>.supabase.co/auth/v1/callback`이 Google Cloud에 등록됐는지
- Vercel env `APP_URL`이 정확한지 (callback redirect 대상)

### 20.2 가입 알림 메일 안 옴

- Resend Logs (https://resend.com/emails) 확인
  - 0건: RESEND_API_KEY env 미설정 → Vercel env 확인 + redeploy
  - 403: free tier 제약 → NOTIFICATION_EMAIL_TO를 Resend 가입 이메일로 변경 또는 도메인 verify
  - 200 OK인데 안 옴: 스팸함 / Gmail 필터 확인

### 20.3 Teams 알림 안 옴

- Vercel Logs에 `[Teams notify skipped]` 또는 `[Teams notify attempt]` 검색
- "Missing organization": 사용자 프로필의 division/team 값 확인
- "Route target not found": teams-routing.ts 매핑 누락 — 본부+팀+보고타입에 해당하는 매핑 추가
- ENABLE_TEAMS_NOTIFY=false 인지 확인

### 20.4 EW 값이 이상함

- 휴가 timeline의 차감 시간 확인
- 점심시간 자동 차감 조건 (출근 ≤ 11:30 AND 퇴근 ≥ 13:30) 충족 여부
- 휴게시간 자동 누적값과 수동 입력값 충돌 (수동 모드 전환 후 다시 자동으로 돌아오는지)
- 30분 단위 반올림 주의

### 20.5 카드가 빈 화면

- /api/team-status 응답 확인 (Network 탭)
- user_profiles에 본인이 있고 is_active=true인지
- 본인 프로필에 division/team이 설정됐는지 (없으면 필터에 안 잡힘)

### 20.6 work_log 수정 시 권한 거부

- 본인 work_log만 수정 가능 (user_id 일치)
- 관리자는 다른 사람 것도 수정 가능
- is_deleted=true 인 row는 수정 불가 (410 반환)

### 20.7 빌드 실패 (Vercel)

- 최근 변경 파일 확인 (TypeScript 에러 / JSX 닫는 태그 누락 등)
- Vercel build 로그에서 정확한 에러 줄 번호 확인
- 로컬에서 `npx tsc --noEmit`으로 타입 체크 먼저

### 20.8 Cron이 동작 안 함

- Vercel Cron 설정 확인 (vercel.json)
- CRON_SECRET 일치 확인 (Vercel env 와 cron 호출 헤더)
- /api/cron/* 라우트 매번 500 → CRON_SECRET 미설정

---

## 21. 부록

### 21.1 환경변수 전체 목록

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# 도메인
APP_URL=https://your-domain.vercel.app
NEXT_PUBLIC_APP_URL=https://your-domain.vercel.app

# 인증
ALLOWED_EMAIL_DOMAINS=nhr.kr,company.com
ADMIN_EMAILS=admin1@nhr.kr,admin2@nhr.kr
SESSION_DAYS=30  # 참고용, 실제 적용은 코드 상수

# Cron
CRON_SECRET=long-random-string

# Make / Teams
MAKE_WEBHOOK_URL=https://hook.make.com/xxxxxx
ENABLE_TEAMS_NOTIFY=true
ENABLE_CHECKIN_NOTIFY=true
ENABLE_CHECKOUT_NOTIFY=true
ENABLE_BREAK_NOTIFY=true
ENABLE_LOCATION_NOTIFY=true
ENABLE_DAILY_REMINDER_NOTIFY=true
ENABLE_MORNING_SUMMARY_NOTIFY=true

# Resend
RESEND_API_KEY=re_xxxxxxxx
RESEND_FROM="N-Click <noreply@your-domain.com>"
NOTIFICATION_EMAIL_TO=jmkim@nhr.kr

# 캘린더
LEAVE_CALENDAR_WEBHOOK_URL=https://script.google.com/macros/s/xxx/exec
LEAVE_CALENDAR_TOKEN=optional-token
```

### 21.2 용어집

- **EW**: Effective Work — 회사가 측정하는 실효 근무시간
- **work_log**: 출퇴근 보고 1건 (하루 단위)
- **WorkLogModal**: 보고 작성 / 수정 모달
- **timeline**: 시간 순서대로 누적되는 근무지 / 휴가 이력 (jsonb 배열)
- **leave_type**: full_day / morning_half / afternoon_half
- **attendance_record_type**: 출근보고 진행 (주말출근, 휴가 포함) / 스킵 등
- **부트스트랩 관리자**: ADMIN_EMAILS env에 등록된 슈퍼 관리자 (DB role과 별개로 항상 admin 권한)
- **fail-close**: 검증 실패 시 통과시키지 않고 차단 / 리다이렉트
- **Stale-While-Revalidate (SWR)**: 캐시가 만료돼도 일단 stale 값 반환 + 백그라운드 갱신

### 21.3 약관 / 개인정보 버전 관리

- `src/lib/policies.ts`의 `CURRENT_TERMS_VERSION`, `CURRENT_PRIVACY_VERSION` 변경 시 모든 사용자가 다음 로그인에서 다시 동의해야 함
- 이력은 `user_policy_consents` 테이블에 보관

### 21.4 라이선스 / 저작권

- 사내 도구 — 외부 배포 금지
- Next.js / Supabase / Make / Resend / Apps Script 각 라이브러리의 라이선스 준수

---

**문서 끝**

운영 중 추가 질문 / 버그 리포트는 사내 메신저 또는 이슈 트래커로 전달해주세요.
