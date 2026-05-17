<!-- BEGIN:working-rules -->
## 작업 운영 규칙 (working rules)

> 이 규칙은 모든 작업 세션에 자동 적용된다. 예외 없이 따른다.

### 1. Task Board 히스토리 유지

사용자가 TodoWrite/TaskList에 등록한 task를 받아 작업할 때.

1. 시작 전 TaskList 전체를 한 번 읽어 컨텍스트 확보.
2. 해당 task 상태를 `in_progress`로 갱신.
3. 작업 완료 시 task를 `completed`로 갱신하면서 description 또는 metadata에 **"무엇을 / 어떤 파일 / 어떤 결정으로" 한 줄 요약**을 남긴다. (예 — "WorkLogForm.tsx 수정모드에서 nextDay 영역 숨김 + submit 가드 추가, 커밋 abc1234")
4. 작업 중 발견한 후속 작업/리팩토링 포인트는 같은 자리에서 신규 task로 `pending` 상태로 추가 (작업 누락 방지).

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
<!-- END:working-rules -->

@AGENTS.md

<!-- BEGIN:time-report-policy-sot -->
## 시간/보고 정책

N-Click의 시간 데이터(출근예정·퇴근예정·실제출근·실제퇴근) 및 출근보고·퇴근보고·수정·미보고·알림 관련 모든 결정은 다음 문서를 단일 진실(SoT)로 한다.

→ `docs/policies/time-and-report-policy.md`

관련 작업 전 반드시 본 문서 확인. 정책 변경이 필요하면 **문서 먼저 개정 후 코드 작업**.
<!-- END:time-report-policy-sot -->
