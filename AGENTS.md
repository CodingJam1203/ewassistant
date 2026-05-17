<!-- BEGIN:working-rules -->
## 작업 운영 규칙 (working rules)

> 이 규칙은 모든 작업 세션에 자동 적용된다. 예외 없이 따른다.

### 1. Task Board 히스토리 유지

사용자가 TodoWrite/TaskList에 등록한 task를 받아 작업할 때.

1. 시작 전 TaskList 전체를 한 번 읽어 컨텍스트 확보.
2. 해당 task 상태를 `in_progress`로 갱신.
3. 작업 완료 시 task를 `completed`로 갱신하면서 description 또는 metadata에 **"무엇을 / 어떤 파일 / 어떤 결정으로" 한 줄 요약**을 남긴다. (예 — "WorkLogForm.tsx 수정모드에서 nextDay 영역 숨김 + submit 가드 추가, 커밋 abc1234")
4. 작업 중 발견한 후속 작업/리팩토링 포인트는 같은 자리에서 신규 task로 `pending` 상태로 추가 (작업 누락 방지).
5. 환경별 배포 흐름은 본 문서의 "Task Board 상태 머신" 섹션을 따른다.

### 2. 사용자 즉석 지시도 Task Board에 등록

사용자가 Task Board와 별개로 채팅에서 부수적인 수정/추가/디버깅을 시키면.

1. 작업 착수 전 해당 요청을 **TodoWrite 로 신규 등록**. subject는 간결한 imperative form, description에 사용자 요청 원문 인용.
2. 진행 상태에 맞게 `in_progress` → `completed` 갱신.
3. 완료 시 동일하게 "무엇을 / 어디서" 한 줄 히스토리 남김.

→ "작은 작업이라 패스"하지 말 것. 모든 변경 흔적이 Task Board에 남아야 이후 세션에서 추적 가능.

### 3. 정책서·PRD 동기화

위 1·2번 작업으로 다음 사항이 발생하면 **같은 commit에 정책서/PRD 변경도 포함**.

- 새로운 정책 결정 (예 — 동시 제출 시 알림 채널, prefill default 등).
- 기존 정책과 다른 동작이 코드에 반영됨 (정책서 갱신 필요).
- 새로운 기능/화면이 추가됨 (PRD 갱신 필요).
- 데이터 모델/API 변화 (정책서 §11 구현 아키텍처 갱신).

갱신 대상 문서.

- 정책서 — `docs/policies/time-and-report-policy.md` (시간/보고 정책).
- PRD — Notion PRD 모음 DB (`https://www.notion.so/workinb/363e23a15c0180359727f8a62e24e588`). 코드 레포에 마크다운 PRD 디렉토리는 두지 않음.
- CLAUDE.md / AGENTS.md — 운영 규칙·아키텍처 큰 변경 시.
- 정책서 "변경 이력" 섹션에 한 줄 기록 (날짜, 변경, 관련 task/commit).

정책서 변경이 코드와 충돌(정책서 vs 사용자 의도)하면 임의 결정 X → 사용자에게 어느 쪽을 진실로 둘지 명시적으로 확인.

### 4. 매 세션 시작 체크리스트

새 세션 첫 액션.

1. `git status` + `git log -5 --oneline` 으로 현재 상태 파악.
2. TaskList 한 번 읽기 (현재 진행 중/대기 중 task 확인).
3. CLAUDE.md / AGENTS.md / `docs/policies/time-and-report-policy.md` 확인.
4. 사용자 요청 처리 시작.

### 5. 작업 단위(commit) 규칙

- Task 1건 = commit 1건 원칙. 단, 매우 작은 변경은 묶어도 OK.
- commit message에 관련 task subject 또는 ID 짧게 인용. (예 — "fix: WorkLogForm 수정모드 nextDay 가드 (task: 퇴근보고 수정 가드)").
- 정책서/PRD 갱신이 코드 변경과 함께면 같은 commit에 포함.

### 6. PROD 배포 후 정책서·PRD 자동 갱신 (사용자 지시 불필요)

🎉 `PROD_배포완료`가 찍히면 사용자의 별도 지시 없이도 다음을 즉시 점검·반영한다. 이건 모든 PROD 배포 사이클의 마무리 단계로 항상 자동 수행.

1. **이번 배포에 포함된 commit/티켓을 훑어** 영향 받을 문서를 식별:
   - 시간/보고 정책서 (`docs/policies/time-and-report-policy.md`) — 비즈니스 정책·discrepancy(D1~D8)·구현 아키텍처(§11) 관련 변경
   - Notion PRD 모음 DB의 해당 기능 PRD 페이지 — 사용자 가시 명세·규칙·정책·관련 파일·미해결 질문·관련 티켓
2. **갱신 내용 분류**:
   - **정책 자체 변경** → 해당 섹션 본문 수정 + 변경 이력 한 줄 (정책서 §3 — 정책 우선 개정 원칙 그대로)
   - **구현 보강만 (정책 동일)** → 변경 이력 한 줄로 박제, 본문 미수정
   - **운영 후속(PROD 마이그레이션 적용·데이터 정리 등)** → 해당 discrepancy/섹션 본문에 "PROD 적용 완료" 사실 + 변경 이력
3. **PRD 갱신은 Notion `update_content` / `update_page`** (코드 commit 아님). "변경 이력" 섹션에 한 줄, 본문 명세도 동시에 정비. 관련 티켓 필드에 티켓 링크.
4. **정책서 갱신은 git commit** — PROD 배포 직후 dev 브랜치에 단독 commit으로 push. 운영 흐름 단축이 트리거된 사이클이면 그 사이클에 묶어도 OK.
5. **갱신할 게 없다고 판단하면** 그 사유를 한 줄로 사용자에게 보고하고 스킵. (예 — "운영 규칙·UI default·일회성 데이터 정리만 — 정책서/PRD 영향 없음")
6. 본 자동 갱신은 §3의 "같은 commit에 정책서/PRD 변경 포함" 원칙을 대체하지 않는다 — 코드 작업 중 분명한 정책 변경이 보이면 같은 commit에 묶는 게 여전히 우선. §6은 **사이클 끝의 마무리 점검**.
<!-- END:working-rules -->

<!-- BEGIN:task-board-state-machine -->
## Task Board 상태 머신

> Notion Task Board (`개발 진행상황` 속성)의 표준 상태 흐름. 모든 환경 배포·QA 진행 흐름은 이 머신을 따른다.

### A. 상태 정의

| 상태 | 의미 | 이동 주체 |
|---|---|---|
| ✏ 요청사항 작성중 | 요구사항 정의 중. 아직 개발 대상 아님 | 사용자 |
| 📦 보류 | 진행 일시 중단 | 사용자 |
| 🚧 개발 요청 | 개발 시작 준비 완료. Claude의 작업 후보 (신규 + 모든 QA 재작업) | 사용자 |
| 🔨 개발 진행중 | Claude가 작업 중 | Claude (작업 시작 시) |
| 🚀 DEV_배포완료 | 개발 끝남. DEV 환경 push 완료 | Claude (작업 완료 + dev push 후) |
| 🔍 DEV_QA진행중 | DEV 환경에서 QA 검토 중 | 사용자 |
| ✔ DEV_QA완료 | DEV QA 통과 → STG 배포 트리거 대기 | 사용자 |
| 🚀 STG_배포완료 | 사용자 트리거로 §13에 따라 Claude가 STG 배포 완료 | Claude (배포 후) |
| 🔍 STG_QA진행중 | STG 환경에서 QA 검토 중 | 사용자 |
| ✔ STG_QA완료 | STG QA 통과 → PROD 배포 트리거 대기 | 사용자 |
| 🎉 PROD_배포완료 | 사용자 트리거로 §13에 따라 Claude가 PROD 배포 완료 | Claude (배포 후) |

### B. 재작업 흐름 (QA 실패 / 핫픽스)

모든 QA 실패는 → `🚧 개발 요청` 으로 돌아간다. 단, **재작업 출처**를 task 메타에 명시 (`재작업 출처` Select property).

| QA 실패 시점 | 다음 상태 | `재작업 출처` 옵션 |
|---|---|---|
| DEV_QA에서 이슈 발견 | 🚧 개발 요청 | DEV_QA |
| STG_QA에서 이슈 발견 | 🚧 개발 요청 | STG_QA |
| PROD에서 핫픽스 필요 | 🚧 개발 요청 | PROD_HOTFIX |

→ `재작업 출처` property 로 우선순위 정렬 (PROD_HOTFIX > STG_QA > DEV_QA).

### C. 자동 / 수동 트리거

| 전환 | 자동/수동 | 비고 |
|---|---|---|
| 🔨 개발 진행중 → 🚀 DEV_배포완료 | 자동 | Claude가 dev push 직후 갱신 |
| 🚀 DEV_배포완료 → 🔍 DEV_QA진행중 | 수동 | 사용자가 QA 시작 시 |
| 🔍 DEV_QA진행중 → ✔ DEV_QA완료 | 수동 | 사용자 검토 결과 |
| 🔍 DEV_QA진행중 → 🚧 개발 요청 (재작업) | 수동 | QA 실패 시 |
| ✔ DEV_QA완료 → 🚀 STG_배포완료 | 수동 트리거 → 자동 실행 | 사용자가 §13 트리거 → Claude 배포 |
| 🚀 STG_배포완료 → 🔍 STG_QA진행중 | 수동 | 사용자가 STG QA 시작 |
| 🔍 STG_QA진행중 → ✔ STG_QA완료 | 수동 | 사용자 검토 결과 |
| 🔍 STG_QA진행중 → 🚧 개발 요청 (재작업) | 수동 | QA 실패 시 |
| ✔ STG_QA완료 → 🎉 PROD_배포완료 | 수동 트리거 → 자동 실행 | 사용자가 §13 트리거 → Claude 배포 |
| 🎉 PROD_배포완료 → 🚧 개발 요청 (HOTFIX) | 수동 | 핫픽스 발생 시 |

### D. Notion DB 메타데이터

- DB URL — `https://www.notion.so/workinb/363e23a15c0180c38ae1f855ef269cc4`
- Data Source URL — `collection://363e23a1-5c01-81df-9555-000b043c024e`
- Status 속성명 — `개발 진행상황`
- 재작업 추적 — `재작업 출처` Select (DEV_QA / STG_QA / PROD_HOTFIX)

### E. 예외 — 사용자 명시 트리거로 단계 단축

사용자가 "한 번에 운영까지 배포", "stg 거치지 말고 main까지", "STG QA 생략" 같이 **명시적으로 단축을 요청**하면 § C 기본 흐름과 별개로 다음 단축을 허용한다.

| 단축 | 조건 | Claude 행동 |
|---|---|---|
| STG_QA 단계 생략 (DEV_QA완료 → STG_배포완료 → PROD_배포완료 직진) | 사용자 명시 트리거 + DB 마이그레이션 사전 점검 보고 완료 | dev→stg→main 연속 push, 두 환경 배포 후 티켓도 단축 경로로 갱신 |
| 한 트리거로 STG + PROD 동시 배포 | 사용자 명시 트리거 | STG 배포 → 즉시 PROD 배포 진행. 명시 트리거가 PROD 게이트도 겸함 |
| DEV_QA진행중 단계 갱신 누락 | 사용자가 결과만 통지 ("OK", "통과") | DEV_QA진행중을 거치지 않고 DEV_배포완료 → DEV_QA완료 직행 OK |

**필수 가드 (단축해도 절대 생략 금지)**:

1. **PROD DB 변경(마이그레이션·RLS·스키마)** 이 포함되면 적용 전 **사전 점검 SQL 결과를 사용자에게 보고**하고 응답을 받는다. 사용자 명시 트리거가 있어도 점검 결과 자체는 반드시 보고.
2. 비밀값(`.env`, secrets) 마스킹, 자동 롤백 금지, 강제 push·hook skip 금지 등 기본 보안 가드는 단축 시에도 그대로 적용.
3. 건너뛴 단계는 commit message 또는 티켓 본문 코멘트에 한 줄 명시 (예 — "STG_QA 생략 — 사용자 명시 트리거 2026-05-17").

사용자가 명시 트리거하지 않은 일반 흐름에서는 § C 기본 단계 한 단계씩 이동. 모호하면 단축 여부를 사용자에게 명시적으로 묻고 진행.
<!-- END:task-board-state-machine -->

<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- BEGIN:time-report-policy-sot -->
## 시간/보고 정책

N-Click의 시간 데이터(출근예정·퇴근예정·실제출근·실제퇴근) 및 출근보고·퇴근보고·수정·미보고·알림 관련 모든 결정은 다음 문서를 단일 진실(SoT)로 한다.

→ `docs/policies/time-and-report-policy.md`

관련 작업 전 반드시 본 문서 확인. 정책 변경이 필요하면 **문서 먼저 개정 후 코드 작업**.
<!-- END:time-report-policy-sot -->
