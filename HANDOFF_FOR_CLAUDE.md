# N-Click (NHR 내부 임직원용 출퇴근보고 웹서비스) 인수인계 문서

본 문서는 새로운 Claude AI 세션에서 프로젝트의 구조, 흐름, 문제 상황을 즉시 파악하고 이어서 작업을 수행할 수 있도록 작성된 인수인계용 가이드입니다.

---

## A. 프로젝트 개요
- **서비스 목적**: NHR 내부 임직원의 출근, 퇴근, 휴게, 근무지 정보 등을 기록하고 관리하는 출퇴근보고 웹서비스.
- **주요 사용자**: NHR 임직원 (일반 유저) 및 HR/운영 관리자.
- **핵심 기능**:
  - 소셜 로그인 (Google 등) 및 프로필(부서/팀) 등록
  - 당일 출퇴근 상태 조회 및 보고 (출근, 휴게, 퇴근, 근무지)
  - 본인 및 전체 임직원 근무/로그 내역 조회
  - 특정 액션(출근/퇴근/수정/삭제 등) 시 Teams 메시지 알림 (Make Webhook 활용)
  - 관리자용 대시보드 (사원 관리, 알림 내역 확인 등)

---

## B. 기술 스택
- **프레임워크**: Next.js 15 (App Router), React, TypeScript
- **스타일링**: TailwindCSS (postcss 사용)
- **데이터베이스/인증**: Supabase (PostgreSQL, Supabase Auth, Row Level Security)
- **알림 연동**: Make.com Webhook을 경유하여 Microsoft Teams 채널에 메시지 발송
- **배포 환경**: Vercel (UTC 환경으로 동작, `vercel.json` 설정 파일 존재)

---

## C. 폴더 및 파일 구조

- `src/app/` : Next.js App Router 구조
  - `admin/` : 관리자 전용 페이지 (유저 승인/수정, 알림 내역 등)
  - `api/` : API 라우트 (`auth`, `admin`, `cron`, `team-status`, `work-logs` 등)
  - `auth/` : 로그인 콜백 등 인증 처리
  - `team/` : 당일 출퇴근 현황판 페이지
  - `my-logs/`, `history/` : 근무 기록 조회 페이지
- `src/components/` : 재사용 가능한 UI 컴포넌트 (`WorkLogForm`, `CheckInModal` 등)
- `src/lib/` : 유틸리티 및 코어 로직
  - `notifications/` : Teams 알림 라우팅, 메시지 빌더, Webhook 전송 함수
  - `utils/date.ts` : KST(한국 표준시) 날짜 변환 관련 유틸리티 (추가됨)
  - `supabase/` : 클라이언트, 서버, 어드민용 Supabase 객체 생성 유틸
  - `ew-calculator.ts` : 초과 근무 등 시간/비용 계산 로직
- `src/types/` : TypeScript 타입 정의 파일 (예: `work-log.ts`)
- `supabase/migrations/` : Supabase 데이터베이스 스키마 및 RLS 정의 SQL 파일 (`001_init.sql` 등)

---

## D. 핵심 데이터 흐름

1. **로그인 및 프로필**:
   - Supabase Auth로 로그인 후, 최초 접속자는 프로필을 생성합니다. (본부/팀 선택)
   - 관리자가 승인(is_blocked = false)해야 정상 사용이 가능합니다.
2. **출근보고**:
   - 사용자가 출근보고 폼을 제출하면 `work_status_events` 테이블에 출근 이벤트가 기록되고 Teams로 알림이 발송됩니다.
3. **퇴근보고**:
   - 사용자가 퇴근 폼을 작성하면 EW(초과근무 등)가 계산되어 `work_logs`에 저장됩니다. EW 텍스트가 클립보드에 복사되며, Teams로 퇴근 메시지가 발송됩니다.
4. **퇴근취소 및 재제출**:
   - **퇴근 취소**: 사용자가 퇴근을 취소하면 `check-out-cancel` 이벤트가 생성됩니다.
   - **재제출**: 기존에 작성했던 퇴근 로그 ID(`resubmitLogId`)를 넘겨, 서버에서 기존 로그를 `is_deleted = true`로 소프트 삭제 처리하고 새로운 로그를 insert합니다. (`checkout_resubmitted` 알림 발송)
5. **휴게/근무지 수정**:
   - `team-status` API를 통해 현재 상태의 근무 장소나 휴게 시간을 업데이트하고 관련 Teams 알림을 보냅니다.
6. **Teams 알림 발송**:
   - `src/lib/notifications/teams.ts`의 로직에 따라 Make.com 웹훅을 호출합니다. Make 웹훅은 받은 Payload를 Teams Channel Reply 모듈로 전달합니다.

---

## E. Supabase 구조

- **`profiles`**: 사용자 정보 (id, email, name, role, is_blocked)
- **`work_logs`**: 퇴근 보고 시 저장되는 최종 근태 기록 로그 (출근, 퇴근, 휴게, 근무내용, EW 계산결과 등)
- **`work_status_events`**: 당일 실시간 출결 상태(출근, 휴게시작/종료, 퇴근, 근무지 변경 등)를 기록하는 테이블 (추정: 이벤트 소싱 패턴)
- **`notification_logs`**: (새로 추가됨) Teams 알림 발송 시도 내역과 결과(SUCCESS/FAILURE)를 저장하는 테이블
- **`app_settings`**, **`audit_logs`**: 기타 설정 및 감사 로그
- **보안(RLS)**:
  - 각 테이블은 RLS가 활성화되어 있으며, 일반 유저는 자신의 데이터만 조회/삽입할 수 있습니다.
  - 서버 측 API에서는 `SUPABASE_SERVICE_ROLE_KEY`를 사용하는 `adminClient`를 통해 RLS를 우회하여 전역 데이터를 관리(알림 로그 저장 등)합니다.

---

## F. Teams 알림 구조 (`src/lib/notifications`)

- **진입점**: `teams.ts` 내의 퍼블릭 함수들 (`notifyWorkLogSubmitted`, `notifyCheckoutResubmitted` 등)
- **라우팅 로직**: `teams-routing.ts`의 `resolveTeamsRouteReportType`를 통해 사용자의 본부, 팀, 이벤트 타입(출근/퇴근)을 기준으로 알맞은 Teams Channel ID와 원본 Message ID를 매핑합니다.
- **메시지 빌더**: `messages.ts`에서 각 이벤트 타입에 맞는 본문 텍스트를 구성하며 HTML/Markdown을 지원합니다.
- **전송 방식**: Make.com을 이용합니다. 단, Make 내부에서 라우팅/검증 로직을 제외하고 비용 최소화를 위해 N-Click 서버가 최종 payload(`teamId`, `channelId`, `messageId`, `messageHtml` 등)를 결정하여 단일 Make Custom Webhook URL(`MAKE_WEBHOOK_URL`)로 쏴줍니다.
- **알림 발송내역 저장**: Make 웹훅을 호출한 뒤 응답 성공/실패 여부를 `logNotification` 함수를 통해 DB의 `notification_logs` 테이블에 저장합니다.

---

## G. 시간/날짜 처리 구조

- **서버 환경**: Vercel 등 배포 환경의 서버 시간은 UTC일 가능성이 높습니다.
- **KST 변환 원칙**:
  - DB 필드 타입은 주로 `TIMESTAMPTZ`를 사용해 UTC로 저장하되 클라이언트에서 KST로 파싱하여 보여줍니다.
  - 날짜 비교 로직이나 "오늘 출근/퇴근" 판별은 철저하게 KST(Asia/Seoul) 문자열 기준이어야 합니다.
- **유틸리티**: `src/lib/utils/date.ts` 파일 내 `getKstTodayDateString()`, `toKstDateString()`를 전역적으로 사용하여 UTC로 인한 "하루 밀림" 현상을 방지합니다.

---

## H. 현재 알려진 문제 (사용자 제보 기준)

1. Teams 메시지의 N-Click 바로가기 URL에 하이퍼링크가 제대로 안 걸림
2. 알림 발송내역 화면에 아무것도 안 뜸
3. 퇴근취소 후 다시 작성해도 Teams 알림이 다시 안 감
4. 한국 기준 오늘이 2026-05-05인데 날짜가 어제처럼 잡히는 문제가 있음
5. 근무장소 변경 시 Teams 알림이 안 옴
6. Make webhook once 실행은 되지만 immediately as data arrives에서는 자동으로 안 오는 문제가 있음
7. Teams 메시지는 새 메시지가 아니라 기존 메시지의 reply로 가야 함
8. 로그에 실제 요청 시각 기록이 안 남는 케이스가 있음

*(참고: 1~4번은 최근 코드단에서 수정이 이루어졌으나, DB 스키마 생성(알림 로그 테이블) 등 후속 조치나 재검증이 필요할 수 있습니다.)*

---

## I. 수정 우선순위 제안

1. **KST 날짜/시간 기준 통일 검증**: (이미 1차 적용됨) 모든 API Route와 UI 컴포넌트에서 KST 문자열이 정확하게 매핑되는지 잔여 부분 확인.
2. **알림 발송내역 저장/조회 문제 해결**: `notification_logs` 테이블이 실제 Supabase에 생성되어 있는지 확인하고, Admin 뷰 정상 렌더링 확인.
3. **퇴근취소 후 재제출 알림 문제 해결**: `resubmitLogId` 파라미터가 폼에서 API로 정상 전달되고, `checkout_resubmitted` 이벤트가 발생해 Teams로 전송되는지 테스트.
4. **근무장소/휴게 변경 알림 추가**: `location` 및 `break-start`, `break-end` 이벤트 시 알림 함수(`notifyLocationChanged` 등)가 정상 작동하는지 점검.
5. **Teams reply 메시지 및 하이퍼링크 포맷 개선**: `channelId`, `messageId` 페이로드가 정확하게 Make로 넘어가는지 로깅. Make 설정 점검(자동 트리거 이슈 등).

---

## J. 새 Claude에게 줄 "작업 시작 프롬프트"

새로운 세션을 열었을 때 아래 프롬프트를 복사하여 붙여넣으세요.

```text
현재 작업 중인 프로젝트는 NHR 내부 임직원용 출퇴근보고 웹서비스(N-Click)입니다. Next.js(App Router), Supabase, TailwindCSS를 사용하고 있습니다. 

루트 경로에 있는 `HANDOFF_FOR_CLAUDE.md` 파일을 먼저 읽고 프로젝트의 배경 지식, 기술 스택, 핵심 데이터 흐름, 그리고 발생하고 있는 알려진 이슈들을 파악해주세요.

[현재 최우선 과제]
우선적으로 아래의 문제들을 해결해야 합니다:
1. Make Webhook이 "Immediately" 모드에서 자동으로 트리거되지 않는 문제 (Make 세팅 이슈 가능성 확인)
2. Teams 알림이 새 메시지가 아니라 지정된 messageId의 "Reply"로 정상적으로 타겟팅되는지 코드(TeamsPayload) 검증
3. 근무장소 변경 시 Teams 알림(`notifyLocationChanged`) 트리거 추가/수정
4. 알림 발송내역이 관리자 페이지(/admin/notifications)에 잘 뜨도록 Supabase 로그 저장 디버깅

[주의사항]
- .env.local 파일이나 환경변수의 실제 값(키 값 등)을 절대 채팅에 출력하지 마세요. 필요한 경우 변수명(예: process.env.MAKE_WEBHOOK_URL)만 언급하세요.
- 모든 날짜 판단(오늘 여부 등)은 반드시 UTC가 아닌 KST(Asia/Seoul)를 기준으로 해야 합니다. (`src/lib/utils/date.ts` 활용)
- 기존 코드를 수정하기 전, 변경 계획을 먼저 제시하고 제 승인을 받은 뒤에 코드를 수정해주세요.
- 추측성 코딩은 자제하고, 항상 관련 파일을 `view_file` 또는 `grep_search` 도구로 읽은 뒤 실제 구조를 바탕으로 수정해주세요.

위 내용을 이해했다면, `HANDOFF_FOR_CLAUDE.md`를 읽은 후 현재의 상태를 요약하고, 첫 번째로 분석 및 수정할 부분을 제안해주세요.
```
