# N-Click 시간 및 보고 정책서

> **최종 갱신** — 2026-05-17
> **상태** — Stage 0~7 반영 완료. 단일 `(user_email, leave_date)` row + 4 시간 컬럼 통합 모델.
> **단일 진실 (SoT)** — 이 문서가 N-Click 시간·보고 관련 모든 의사결정의 기준이다.

---

## 0. 문서 사용 안내

- 신규 기능 추가·리팩토링 전 반드시 본 문서를 참조한다.
- 정책 변경이 필요하면 **본 문서를 먼저 개정**한 후 코드 작업.
- 각 항목의 **「구현 위치」** 컬럼은 실제 파일 경로·라인. 디버깅·리뷰 시 점프 가능.
- **상태 기호** — ✅ 정책 그대로 구현 / ⚠️ 부분 구현 또는 검증 필요 / ❌ 미구현 / 🔀 코드가 정책과 다름 (discrepancy).

---

## 1. 문서 목적

N-Click의 시간 데이터(출근예정·퇴근예정·실제출근·실제퇴근) 및 출근보고·퇴근보고·수정·미보고·알림 관련 모든 결정을 한곳에 모아 단일 진실로 운영한다. Stage 0~7에서 분리 row 모델을 단일 row + 4 컬럼 통합 모델로 마이그레이션했고, 이 문서는 그 결과 상태를 박제한다.

---

## 2. 기본 정책

### 2.1 시간 데이터 4종

| 구분 | 시간 데이터 | DB 컬럼 | SoT | 구현 위치 | 상태 |
|---|---|---|---|---|---|
| 1 | 출근예정시간 | `planned_start_time` | 단일 | `supabase/migrations/023_work_logs_time_4cols.sql:20-24` | ✅ |
| 2 | 퇴근예정시간 | `planned_end_time` | 단일 | 동일 | ✅ |
| 3 | 실제출근시간 | `actual_start_time` | **단일 (SoT)** | 동일. read 시 `effective_actual_start_time` 보정 가능 | ✅ |
| 4 | 실제퇴근시간 | `actual_end_time` | **단일 (SoT)** | 동일 | ✅ |

원칙
- 모든 시간은 **목표 일자** (`leave_date`)에 저장.
- 퇴근보고 + 명일 출근보고 동시 제출이어도 각자 일자의 row에 분리 저장 (D-day row + D+1 row UPSERT).
- `daily_work_status` 는 휴게 진행 같은 이벤트성 정보만 유지. **시간 데이터의 SoT는 `work_logs` 단일 row**.
- backfill — 옛 분리 row + `daily_work_status.checked_in_at` → 단일 row 4 컬럼으로 흡수 (`024_backfill_unified_time_columns.sql`).

### 2.2 데이터 저장 기준

| 케이스 | 동작 | 구현 위치 | 상태 |
|---|---|---|---|
| 출근보고 (신규/수정) | D-day row UPSERT — `planned_*`, `actual_start_time`, `planned_work_locations`, 메모 | `src/app/api/team-status/check-in/route.ts` (UPSERT) | ✅ |
| 출근완료 | `actual_start_time` 갱신 | `src/app/api/team-status/check-in/complete/route.ts` (있다면) + `work-logs/route.ts` POST | ✅ |
| 퇴근보고 (신규/수정) | D-day row 의 `actual_*`, `actual_work_locations`, `break_*`, `work_content` 갱신 | `src/app/api/work-logs/route.ts:222-227, 478-495` | ✅ |
| 명일 출근보고 동반 제출 | D+1 row UPSERT — `planned_*` + locations + 메모 | `src/app/api/work-logs/route.ts:374-476` | ✅ |
| 단일 row 가정 | `(user_email, leave_date)` 1행 — 응용서버 레벨 보장 | `src/app/api/work-logs/route.ts:283-293` | 🔀 (§12 미해결) |
| DB UNIQUE 제약 | `(user_email, leave_date) WHERE is_deleted=false` UNIQUE | `supabase/migrations/023` | ❌ (§12 보강 필요) |

### 2.3 Prefill 정책

| 케이스 | 정책 | 구현 위치 | 상태 |
|---|---|---|---|
| 수정 모달 진입 | 해당 일자 기존 row 값 prefill | `src/app/api/work-logs/[id]/route.ts:114` + `CheckInModal.tsx`, `WorkLogForm.tsx` (`editingLog` prop) | ✅ |
| 신규 출근보고 (보고 상태) | 출퇴근예정 = 기존값, 실제출근 = **현재 시간 30분 절삭** | `src/components/CheckInModal.tsx:59-81` `normalizeStartTimeTo30` | 🔀 — **코드는 30분 반올림(round). 정책은 절삭(floor).** (§12) |
| 신규 출근보고 (미보고 상태) | 출근예정 "미보고" 잠금 + 토글 / 퇴근예정 18:00 / 실제출근 = 현재 30분 절삭 | `src/components/CheckInModal.tsx:104-107` (`plannedStartUnreported` state) | ⚠️ — 30분 절삭 동일 discrepancy |
| 신규 퇴근보고 (미보고, 출근 무시) | 실제출근 09:00, 실제퇴근 18:00 | `src/components/WorkLogForm.tsx` 신규 분기 | ⚠️ — WorkLogForm 전체 검증 미완 |
| 신규 퇴근보고 (보고 상태) | 실제출근 = 출근예정값 (또는 기존 actual), 실제퇴근 = 퇴근예정값 | `src/app/api/work-logs/route.ts:222-227` | ✅ |
| 명일 출근/퇴근예정 default | 09:00 / 18:00 | `src/app/api/work-logs/route.ts:379-394` | ✅ |
| 근무장소 default | "사무실" | `src/app/api/work-logs/route.ts:379-394` | ✅ |
| 근무내용 default | 빈 값 | 동일 | ✅ |

**미보고 출근예정 저장 룰**

| 사용자 액션 | DB 결과 | 구현 위치 | 상태 |
|---|---|---|---|
| 토글 안 풀고 제출 | `planned_start_time = NULL` (미보고 유지) | `src/app/api/team-status/check-in/route.ts` (NULL 핸들링) | ⚠️ — NULL 저장 경로 코드 검증 필요 (§12) |
| 토글 풀고 입력 | 입력값 그대로 저장 | 동일 | ✅ |

### 2.4 알림 정책

| 케이스 | 채널 | 발송 함수 | 상태 |
|---|---|---|---|
| 출근보고 작성 | 출근보고 채널 | `notifyCheckinSubmitted` (`teams.ts:360-368`) | ✅ |
| 출근보고 수정 | 출근보고 채널 | `notifyWorkLogUpdatedSplit` (`teams.ts:325-331`, `kind='check_in'`) | ✅ |
| 퇴근보고 작성 | 퇴근보고 채널 | `notifyWorkLogSubmitted` (`teams.ts:271-289`) | ✅ |
| 퇴근보고 수정 | 퇴근보고 채널 | `notifyWorkLogUpdatedSplit` (`kind='check_out'`, `teams.ts:336-342`) | ✅ |
| **퇴근보고 + 명일 출근보고 동시 제출** | **퇴근보고 채널만 1건** (명일 출근 채널 별도 발송 X) | `teams.ts:271-289`, D+1 INSERT 후 알림 호출 없음 (`teams.ts:551-556` 주석 참조) | ✅ |
| 미보고 수동 nudge (리더+) | 미보고 종류별 — `missing_all`→출근보고, `missing_checkout`→퇴근보고 채널 | `notifyMissingReport` (`teams.ts:429-479`) | ✅ |
| Cron 알림 — 일일 리마인더 | 출근보고 채널 | `notifyDailyCheckinReminder` | ✅ |
| Cron 알림 — 아침 요약 | 출근보고 채널 | `notifyMorningSummary` | ✅ |
| 라우팅 결정 | `(division, team, report_type)` 3-tuple → `teams_routing` row | `src/lib/notifications/teams-routing.ts` | ✅ |

### 2.5 시간 관련 버튼 데이터 통합

| 진입 경로 | API endpoint | 컴포넌트 | 상태 |
|---|---|---|---|
| 홈 — "출근 보고" | `POST /api/team-status/check-in` → 내부에서 work_logs UPSERT | `CheckInModal.tsx` | ✅ |
| 홈 — "출근 완료" (옵션) | `POST /api/team-status/check-in/complete` 또는 `work_logs` POST | `CheckInModal.tsx` 출근완료 버튼 분기 | ⚠️ — 라우트 경로 확인 필요 |
| 홈 — "퇴근 보고" | `POST /api/work-logs` (퇴근 + 선택적 명일 출근) | `WorkLogModal.tsx` → `WorkLogForm.tsx` | ✅ |
| 캘린더 셀 클릭 — 기존 row 수정 | `PATCH /api/work-logs/[id]` (`_editScope` 가드) | 동일 모달 재사용 | ✅ |
| 미보고 배너 | `GET /api/my/missed-checkout` → 퇴근 모달 자동 prefill | `MissingReportsSummary.tsx` | ✅ |

---

## 3. 보고 유형별 기본 정책

### 3.1 출근보고

| 항목 | 정책 | 구현 위치 | 상태 |
|---|---|---|---|
| 사용자가 수동 트리거 | 시스템 자동 출근 없음 | `team-status/check-in/route.ts` | ✅ |
| 30분 단위 강제 | UI step + API `snapMinutes(round)` + DB CHECK | `src/lib/utils/half-hour.ts:35-45`, `011_thirty_min_policy.sql` | ✅ |
| `_editScope='check_in'` | 출근 영역만 수정. 퇴근 필드 변경 시 400 | `src/app/api/work-logs/[id]/route.ts:382-449` | ✅ |
| 다음날 일자 미래 보고 가능 | "case future" 분기로 실제 출근 입력란 숨김 | `CheckInModal.tsx:51, 137` (`caseMode='future'`) | ✅ |

### 3.2 퇴근보고

| 항목 | 정책 | 구현 위치 | 상태 |
|---|---|---|---|
| 사용자가 수동 트리거 | 자동 퇴근 없음. 시각 fallback — body > 기존 `actual_end_time` > 현재 시각 | `src/app/api/team-status/check-out/route.ts` | ✅ |
| 자정 넘김 | 사용자가 일자 직접 선택. 같은 일자 27:00 표기 + `diffMinutes` +1440 처리 | `src/lib/ew-calculator.ts:156-161` | ✅ |
| 휴게 자동 종료 | `is_on_break=true` 상태에서 퇴근 시 false 처리 | `src/app/api/team-status/check-out/route.ts` | ✅ |
| `_editScope='check_out'` | 퇴근 영역만 수정. `planned_*` / 다음날 변경 시 400 | `src/app/api/work-logs/[id]/route.ts:418-440` | ✅ |

### 3.3 동시 제출 (퇴근 + 명일 출근)

| 항목 | 정책 | 구현 위치 | 상태 |
|---|---|---|---|
| D-day row + D+1 row 분리 UPSERT | 각자 `leave_date` 기준 | `src/app/api/work-logs/route.ts:374-476` | ✅ |
| 알림 1건 (퇴근보고 채널) | 명일 출근 채널 별도 발송 X | `teams.ts:271-289`, `:551-556` | ✅ |
| 명일 default | 09:00 / 18:00 / 사무실 / 빈 메모 | `route.ts:379-394` | ✅ |

---

## 4. 시간 노출 정책

### 4.1 4단계 상태 분류

`src/lib/work-logs/unified-times.ts:81-92` 의 `classifyWorkLog(row)` 가 반환하는 enum.

| 상태 | 조건 | 표시 | 상태 |
|---|---|---|---|
| `no_data` | 모든 시간 컬럼 NULL + 휴가 아님 | "미보고" 칩 (오늘/과거) 또는 비워둠 (미래) | ✅ |
| `planned_only` | `planned_*` 만 있음 | `planned_start → planned_end` | ✅ |
| `check_in_done` | `actual_start` 있고 `actual_end` NULL | `actual_start → planned_end` | ✅ |
| `check_out_done` | `actual_start` + `actual_end` 둘 다 있음 | `actual_start → actual_end` | ✅ |
| `future` | 일자가 오늘 이후 + 데이터 없음 | 비워둠 (`status='future'`) | ✅ |

### 4.2 캘린더 시간 노출 정책

| 상태 | 표시 | 구현 위치 | 상태 |
|---|---|---|---|
| `planned_only` | planned_start → planned_end | `unified-times.ts:81-92` `displayTimeRange` | ✅ |
| `check_in_done` | actual_start → planned_end | 동일 | ✅ |
| `check_out_done` | actual_start → actual_end | 동일 | ✅ |
| 미보고 + 오늘/과거 | "미보고" 칩 | `MyHistoryCalendar.tsx` (렌더 detail 미확인) | ⚠️ — UI 칩 렌더 verify |
| 미보고 + 미래 | 비워둠 | `submission-status/route.ts:254-256` (`d > today → 'future'`) | ✅ |

### 4.3 제출내역 및 리스트뷰 노출 정책

| 뷰 | 데이터 소스 | 구현 위치 | 상태 |
|---|---|---|---|
| 제출내역 — 일자별 최종 | `work_logs` 최신 row | `MyHistoryCalendar.tsx:76-99` 4 컬럼 그대로 사용 | ✅ |
| 제출내역 — RAW 제출내역 | `work_log_submissions` 시계열 | `SubmissionsRawTable.tsx:75-80` `ChangedFieldRow` | ✅ |
| 미보고 현황 | (user, date) 매트릭스 `missing_all` / `missing_checkout` | `MissingReportsListView.tsx`, `api/missing-reports/route.ts` | ✅ |

**Note**: 사용자 메시지 Step 1에 적힌 `src/lib/submissions/finalize-by-day.ts` 는 **존재하지 않음**. 동일 역할은 `MyHistoryCalendar.tsx` 내부 + `unified-times.ts` `pickLatestWorkLogPerDay` + `api/my/submission-status/route.ts` 가 분담.

---

## 5. 보고 / 미보고 상태별 정책

### 5.1 미보고 + 당일 출근보고

| 필드 | Default | 동작 | 구현 위치 | 상태 |
|---|---|---|---|---|
| 출근예정 | "미보고" 잠금 (placeholder) | 토글 풀어야 입력 가능 | `CheckInModal.tsx:104-107` | ✅ |
| 퇴근예정 | `18:00` | 사용자 변경 가능 | `CheckInModal.tsx` default | ✅ |
| 실제출근 | 현재 시간 30분 처리 | (정책: 절삭 / 코드: 반올림 — §12 discrepancy) | `CheckInModal.tsx:59-81` | 🔀 |
| 근무장소 | "사무실" | 변경 가능 | `route.ts:379-394` | ✅ |
| 메모 | 빈 값 | — | 동일 | ✅ |
| 미보고 토글 안 풀고 제출 | `planned_start_time = NULL` | 본인 미보고 상태 유지 | `team-status/check-in/route.ts` (NULL 핸들링 검증 필요) | ⚠️ |

### 5.2 보고 + 당일 출근보고

| 필드 | Default | 구현 위치 | 상태 |
|---|---|---|---|
| 출근예정 | 기존 `planned_start_time` | `api/work-logs/[id]/route.ts:114` GET | ✅ |
| 퇴근예정 | 기존 `planned_end_time` | 동일 | ✅ |
| 실제출근 | 현재 시간 30분 처리 | 🔀 — 반올림 vs 절삭 (§12) | ⚠️ |
| 근무장소 | 기존값 | — | ✅ |
| 메모 | 기존값 | — | ✅ |

---

## 6. 수정 접근 정책

### 6.1 기본 수정 원칙 — `_editScope` 필드 가드

| 수정 유형 | 가능 필드 | 불가 필드 | 구현 위치 | 상태 |
|---|---|---|---|---|
| 출근보고 수정 (`_editScope='check_in'`) | `planned_start_time`, `planned_end_time`, `actual_start_time`, `planned_work_locations`, 메모 | `actual_end_time`, `break_*`, `work_content` (퇴근), 다음날 값 전체 | `api/work-logs/[id]/route.ts:392-416` `forbidden[]` | ✅ |
| 퇴근보고 수정 (`_editScope='check_out'`) | `actual_start_time`, `actual_end_time`, `actual_work_locations`, `break_*`, `work_content` | `planned_*` 전체, 다음날 값 전체 | `route.ts:418-440` | ✅ |
| 위반 시 동작 | 400 reject + `forbidden` 필드명 응답 | `route.ts:382-449` | ✅ |

### 6.2 일자 분리 예시

- 23:50 (5/17) 출근 → 00:10 (5/18) 퇴근, 사용자가 **5/17 일자 선택** → 5/17 row 1건. `actual_start=23:50`, `actual_end=24:10` (오버 24h 표기).
- 사용자가 **5/18 일자 선택** → 5/17 row (23:50 출근, 24:00 퇴근 직접 작성) + 5/18 row (00:00 출근, 00:10 퇴근) 별도 작성. 사용자 책임.

### 6.3 출근보고 수정 뷰 정책

| 항목 | 정책 | 구현 위치 | 상태 |
|---|---|---|---|
| 과거/당일/미래 모두 동일 뷰 사용 | `_editScope='check_in'` 통일 | `CheckInModal.tsx:51,137` | ✅ |
| 퇴근보고 데이터 영향 X | `forbidden[]` 가드 | `route.ts:392-416` | ✅ |
| 미래 일자 진입 | 실제 출근 시각 입력란 숨김 | `CheckInModal.tsx` `caseMode='future'` | ✅ |

### 6.4 이미 제출된 출근보고 수정 진입

- **결정** — 일반 출근보고 수정과 **동일 정책**. 단 퇴근보고 데이터 (`actual_end_time`, `break_*`, `work_content`)는 절대 영향 X (필드 가드).
- 구현 — `_editScope='check_in'` 으로 PATCH 호출, 동일 forbidden 적용.

---

## 7. 정석 케이스 (Happy Path)

1. 09:00 출근 보고 → `work_logs` D-day row UPSERT — `planned_start=09:00, planned_end=18:00, actual_start=09:00, location='사무실'`.
2. (옵션) 출근 완료 버튼 → `actual_start_time` 갱신 (`useCheckInComplete=true` 팀).
3. 18:00 퇴근 보고 → 같은 row의 `actual_end=18:00, break, location, work_content` 갱신.
4. (옵션) 명일 출근보고 동반 → D+1 row 별도 UPSERT.
5. Teams 알림 1건 — 퇴근보고 채널 (`notifyWorkLogSubmitted`).

---

## 8. 출근완료 사용 케이스

### 8.1 `useCheckInComplete=true` 팀

| 케이스 | 동작 | 구현 위치 | 상태 |
|---|---|---|---|
| 8.1.1 출근 보고 → 출근 완료 | `planned_*` 저장 후 별도 "출근 완료" 클릭 시 `actual_start_time` 갱신 | `team-status/check-in/complete/route.ts` 또는 `work-logs/route.ts` POST | ✅ |
| 8.1.2 출근 보고 후 출근 완료 깜빡 | `actual_start_time` NULL 유지. 사용자가 나중에 수동으로 채움 | 자동 보정 없음 (해당 팀은 수동 흐름) | ✅ |
| 8.1.3 출근 완료 후 시각 수정 | `_editScope='check_in'` 으로 `actual_start_time` 수정 가능 | `[id]/route.ts:519-540` | ✅ |
| 8.1.4 출근 완료 취소 | `check-in-cancel` API로 `actual_start_time` 또는 `checked_in_at` NULL | `team-status/check-in-cancel/route.ts` | ✅ |
| 8.1.5 출근 완료 이벤트 감사 로그 | `work_log_submissions` 에 `report_type='check_in_complete'` 1행 | `017_submissions_check_in_complete.sql` | ✅ |

### 8.2 `useCheckInComplete=false` 팀 (자동 보정)

| 케이스 | 동작 | 구현 위치 | 상태 |
|---|---|---|---|
| 8.2.1 출근 보고만 (별도 출근 완료 없음) | 출근 보고 시 즉시 `actual_start_time` 갱신 (정책상 자동) | `team-status/check-in/route.ts` 분기 | ✅ |
| 8.2.2 read-time 자동 보정 (planned 시각 지나면) | 응답에 `effective_actual_start_time = planned_start_time`. **DB 미변경.** | `src/lib/work-log-state.ts:122-150` `computeEffectiveActualStart` + `api/work-logs/route.ts:697-728` GET | ✅ |
| 보정 조건 | `useCheckInComplete=false` + 당일 + 현재 시각 ≥ planned 시각 + `actual_start_time` NULL + 미보고 상태 아님 | `work-log-state.ts:134-149` | ✅ |

---

## 9. 정책상 주의사항

- **30분 단위 강제 3중 방어** — UI step / API `snapMinutes` / DB CHECK constraint (`actual_work_time % 1800 = 0`). 셋 중 하나만 우회되어도 다음 단계에서 차단.
- **자정 넘김은 사용자 의도** — 시스템이 자동 일자 이동 안 함. 같은 일자 24:00+ 표기 vs 명일 별도 row 둘 다 사용자가 선택.
- **자동 점심 1시간 차감** — 평일만 차감. 토·일·공휴일 0. 사용자가 12~13시 휴게 입력 시 **이중 차감 위험** (보강 필요, §12).
- **휴게 4분리** — `break_auto_actual_minutes` → `break_auto_rounded_minutes` → `break_manual_rounded_minutes` → `break_final_rounded_minutes`. 30분 ceil 처리.
- **`daily_work_status` 는 SoT 아님** — 시간은 `work_logs`. `daily_work_status` 는 휴게 진행·현재 위치 같은 실시간 상태만.

---

## 10. 결정 사항 (구 미정 → 결정 완료)

| # | 사안 | 결정 | 구현 |
|---|---|---|---|
| 1 | 출근완료 미사용 팀 자동 처리 | **read-time 보정** (`effective_actual_start_time`). DB 미변경. | `work-log-state.ts:122-150` |
| 2 | 미보고 출근예정 저장 방식 | 토글 안 풀면 `NULL` 저장. 토글 풀고 입력 시 입력값. | `CheckInModal.tsx:104-107` + `team-status/check-in/route.ts` (NULL 핸들링 검증 §12) |
| 3 | 동시 제출 시 알림 | **퇴근보고 채널만 1건**. 명일 출근 채널 별도 발송 X. | `teams.ts:271-289`, `:551-556` |
| 4 | 과거 출근보고 수정 정책 | **일반 출근보고 수정과 동일 정책**. 단 퇴근보고 데이터 영향 X (필드 가드). | `route.ts:392-416` |
| 5 | 자동 새로고침 | **클라이언트 polling**. 60초 기본 / planned ±10분 범위 30초. `document.hidden` 또는 모달 열림 시 정지. | `CheckInModal.tsx:86-87` modal context. polling interval 코드 §12 |
| 6 | 30분 단위 변환 | **floor (절삭)**. 0~29분 → 00, 30~59분 → 30. (코드 확인 완료) | `CheckInModal.tsx:59-81` |
| 7 | DB 단일 row 보장 | **partial unique index** — `(user_email, leave_date) WHERE is_deleted=false`. | `supabase/migrations/025_work_logs_user_date_unique.sql` |
| 8 | 일자별 최종 산출 구조 | **현재 분담 구조 유지**. `unified-times.ts` + `MyHistoryCalendar.tsx` + `submission-status` 가 협업. | finalize-by-day.ts 통합 리팩터 불필요 |

---

## 11. 구현 아키텍처

### 11.1 데이터 모델

```
work_logs
  url                    UNIQUE
  user_email             TEXT  ← (user_email, leave_date) 응용 레벨 UNIQUE
  leave_date             DATE
  planned_start_time     TEXT  -- HH:mm, 023 추가
  planned_end_time       TEXT  -- HH:mm, 023 추가
  actual_start_time      TEXT  -- HH:mm, 023 추가, SoT
  actual_end_time        TEXT  -- HH:mm, 023 추가, SoT
  start_time             TEXT  -- 레거시 호환, NOT NULL
  end_time               TEXT  -- 레거시 호환, NOT NULL
  planned_work_locations JSONB
  actual_work_locations  JSONB
  leave_timeline         JSONB
  break_auto_actual_minutes / break_auto_rounded_minutes / break_manual_rounded_minutes / break_final_rounded_minutes
  attendance_record_type TEXT
  work_content           TEXT
  ew_value               TEXT
  late_or_attendance_status TEXT  -- 사용자 자가 신고 ("지각" 등)
  is_deleted             BOOLEAN
  updated_by             TEXT

daily_work_status
  user_email, work_date  -- 시간 SoT 아님
  status, checked_in_at, checked_out_at, is_on_break, break_started_at, ...
  current_location, current_location_index

work_log_submissions  -- append-only
  user_id, user_email, name, division, team
  report_type ∈ {check_in, check_out, check_in_update, check_out_update, check_in_complete, ...}
  target_date, submitted_at, work_log_id, snapshot fields, changed_fields

work_status_events  -- append-only (휴게·위치 변경 등 이벤트)

org_teams.use_check_in_complete  -- 팀별 "출근 완료" 단계 사용 여부 (021)

leave_calendar_cache  -- Google Sheets 휴가 캐시 (007, TTL 6h)
```

### 11.2 핵심 헬퍼

| 파일 | 역할 + 주요 export |
|---|---|
| `src/lib/work-logs/unified-times.ts` | `extractUnifiedTimes(row)` (4종 + legacy fallback) · `classifyWorkLog(row)` (5단계 enum) · `displayTimeRange(row)` (캘린더 표시) · `pickLatestWorkLogPerDay(rows)` (중복 시 최신 1건) |
| `src/lib/work-log-state.ts` | 5단계 상태 머신 + `computeEffectiveActualStart(row, team, now)` (출근완료 미사용 팀 read-time 보정) |
| `src/lib/utils/half-hour.ts` | `snapMinutes(min, mode='round'\|'floor'\|'ceil')` · `isHalfHour` · `hhmmToMinutes` |
| `src/lib/ew-calculator.ts` | `calculateEw` · `diffMinutes` (+1440 자정 처리) · `getEwStartMinutes` (9시 cap) |
| `src/lib/leave-timeline.ts` | `ceilTo30Min` · `validateLeaveTimeline` · `calculateBreakAutoMinutesFromIso` |
| `src/lib/notifications/teams.ts` | `notifyWorkLogSubmitted` · `notifyWorkLogUpdatedSplit` · `notifyCheckinSubmitted` · `notifyMissingReport` · `notifyDailyCheckinReminder` · `notifyMorningSummary` · `notifyBreakStarted` / `Ended` · `notifyLocationChanged` |
| `src/lib/notifications/teams-routing.ts` | `(division, team, report_type) → channel/message` 매핑 |

### 11.3 API 라우트 매핑

| 동작 | endpoint | SoT 갱신 |
|---|---|---|
| 출근보고 작성/수정 | `POST /api/team-status/check-in` | `planned_*` + `actual_start_time` (use_check_in_complete=false 시) |
| 출근완료 | `POST /api/team-status/check-in/complete` (또는 work-logs POST) | `actual_start_time` |
| 출근/퇴근 취소 | `POST /api/team-status/check-{in,out}-cancel` | NULL 처리 |
| 퇴근보고 작성/수정 | `POST /api/work-logs` | `actual_*` + 옵션 D+1 row UPSERT |
| 단건 수정 | `PATCH /api/work-logs/[id]` (`_editScope` 가드) | scope 별 분기 |
| 논리 삭제 | `DELETE /api/work-logs/[id]` | `is_deleted=true` |
| 본인 일자별 상태 | `GET /api/my/submission-status` | 조회 |
| 본인 미완료 알림 | `GET /api/my/missed-checkout` | 조회 |
| 회사 전체 미보고 | `GET /api/missing-reports` | 조회 |
| 미보고 수동 nudge | `POST /api/missing-reports/notify` | 알림 발송 |
| 팀원 카드 | `GET /api/team-status` | 조회 (effective_actual_start_time 포함) |

### 11.4 알림 채널 라우팅 (요약)

| 이벤트 | 채널 | 함수 |
|---|---|---|
| 출근보고 작성/수정 | 출근보고 | `notifyCheckinSubmitted` / `notifyWorkLogUpdatedSplit(kind='check_in')` |
| 퇴근보고 작성/수정 | 퇴근보고 | `notifyWorkLogSubmitted` / `notifyWorkLogUpdatedSplit(kind='check_out')` |
| 미보고 nudge | 종류별 (출근 또는 퇴근) | `notifyMissingReport` |
| 일일 cron 리마인더 | 출근보고 | `notifyDailyCheckinReminder` |
| 아침 요약 cron | 출근보고 | `notifyMorningSummary` |
| 휴게 시작/종료 | 출근보고 (관례) | `notifyBreakStarted` / `Ended` |
| 위치 변경 | 출근보고 (관례) | `notifyLocationChanged` |

### 11.5 마이그레이션 이력

| # | 파일 | 내용 |
|---|---|---|
| 011 | `011_thirty_min_policy.sql` + `011b_fix_thirty_min.sql` | 30분 단위 CHECK constraint + legacy round |
| 017 | `017_submissions_check_in_complete.sql` | `work_log_submissions.report_type` 에 `check_in_complete` 추가 |
| 021 | `021_org_teams_use_check_in_complete.sql` | 팀별 출근완료 단계 토글 |
| 022 | `022_work_logs_user_date_indexes.sql` | `(user_email, leave_date)` 인덱스 |
| **023** | `023_work_logs_time_4cols.sql` | **4 컬럼 추가 (nullable, default 없음)** — Stage 0-1 |
| **024** | `024_backfill_unified_time_columns.sql` | **옛 분리 row + daily_work_status → 단일 row 4 컬럼 backfill** — Stage 0-3 |
| **025** | `025_work_logs_user_date_unique.sql` | **partial unique index** `(user_email, leave_date) WHERE is_deleted=false` — §12 D2 보강 |

---

## 12. Discrepancy & 검증 필요 항목 (회귀 테스트 + 보강 대상)

✅ **D1. 30분 절삭(floor) — 정책과 코드 일치 확인됨 (2026-05-17)**
- **정책** — 신규 출근보고 실제출근 = 현재 시간 **절삭(floor)**.
- **코드** — `CheckInModal.tsx:65` — `const flooredMm = mm < 30 ? '00' : '30'`. `nowKstHHmmFloor` 도 동일.
- **결론** — 0~29분 → 00, 30~59분 → 30. **floor 동작 맞음.** 초기 조사에서 함수명을 round로 오판했던 부분 정정.

✅ **D2. DB UNIQUE 제약 추가됨 (2026-05-17, 마이그레이션 025 + PROD 적용 완료)**
- **정책** — `(user_email, leave_date)` 단일 row 보장.
- **이전 상태** — 응용서버 UPSERT만, DB 제약 부재.
- **조치** — `supabase/migrations/025_work_logs_user_date_unique.sql` 추가. partial unique index `WHERE is_deleted=false`.
- **적용 전 점검** — 마이그레이션 본문 STEP 1 쿼리로 중복 활성 행 확인 → DEV 0건, PROD 9그룹 31row 발견.
- **PROD 적용** — 2026-05-17. 9그룹 각각 `updated_at` 최신 1건만 유지, 나머지 31row `is_deleted=true` soft-delete 후 partial unique index 생성. 현재 PROD `pg_indexes` 에 `work_logs_user_date_active_unique` 존재.

⚠️ **D3. 미보고 토글 NULL 저장 경로**
- **정책** — 토글 안 풀고 제출 → `planned_start_time = NULL`.
- **코드** — `CheckInModal` state 추적까진 확인. `team-status/check-in/route.ts` 의 실제 NULL 핸들링 미검증.
- **검증** — POST 요청 시 `plannedStartTimeUnreported=true` 인 경우 서버가 `planned_start_time` 을 NULL로 저장하는지 단위 테스트 필요.

⚠️ **D4. Polling interval 명시 부재**
- **정책** — 60초 기본 / planned ±10분 30초 / hidden·모달 정지.
- **코드** — 모달 context 정지 부분만 확인 (`CheckInModal.tsx:86-87`). 60초/30초 interval 코드 위치 미확인.
- **검증** — `useAutoRefetch` 같은 훅 위치·구현 확인 필요.

⚠️ **D5. 캘린더 "미보고" 칩 렌더**
- **정책** — 오늘/과거 + `no_data` → "미보고" 칩, 미래 → 비워둠.
- **코드** — `unified-times.ts` 의 `classifyWorkLog` 까진 확인. `MyHistoryCalendar.tsx` 의 칩 렌더 detail 미검증.
- **검증** — UI 스냅샷 또는 수동 확인.

⚠️ **D6. WorkLogForm 신규 미보고 분기 prefill**
- **정책** — 미보고 + 신규 퇴근보고 시 실제출근 09:00 / 실제퇴근 18:00.
- **코드** — `WorkLogForm.tsx` 전체 readthrough 미완. default 값 분기 확인 필요.

⚠️ **D7. 자동 점심 + 사용자 휴게 이중 차감**
- **정책** (별도 정책서 §3.1.2) — 평일 자동 점심 60분 + 사용자가 12~13시 휴게 입력 시 이중 차감.
- **보강 필요** — API 검증 또는 UI 경고.

✅ **D8. `finalize-by-day.ts` 미생성 — 현재 분담 구조 유지 결정 (2026-05-17)**
- **이전 가정** — `src/lib/submissions/finalize-by-day.ts` 단일 진입점 추가 검토.
- **결정** — 현재 분담 구조 유지. `unified-times.ts:pickLatestWorkLogPerDay` + `MyHistoryCalendar.tsx` + `api/my/submission-status/route.ts` 가 일자별 최종 산출 분담. 통합 리팩터 불필요.

---

## 13. 구현 점검 체크리스트 (회귀 테스트용)

- [ ] 퇴근보고 수정 모드 진입 시 다음날 영역·감사 마카롱 영역 렌더링 X
- [ ] 미보고 + 출근보고 모달 — 출근예정 잠금 + 토글, 토글 안 풀고 제출 시 NULL 저장
- [ ] 미보고 + 퇴근보고 모달 — 실제출근 09:00 / 실제퇴근 18:00 default
- [ ] 퇴근 + 명일 출근 동시 제출 — 명일 출근 채널 알림 X, 퇴근 채널만 1건
- [ ] 출근완료 미사용 팀 + planned 시각 지남 + actual NULL — 응답에 `effective_actual_start_time` 포함
- [ ] 클라이언트 polling 60초 / planned ±10분 30초 / hidden·모달 시 정지
- [ ] 캘린더 4단계 (`planned_only` / `check_in_done` / `check_out_done` / `no_data`) 표시 룰 정확
- [ ] `_editScope='check_in'` PATCH 에 `actual_end_time` 포함 시 400 reject
- [ ] `_editScope='check_out'` PATCH 에 `planned_*` 포함 시 400 reject
- [ ] 자정 넘김 케이스 — 27:00 표기 + `diffMinutes` 1440분 가산
- [ ] backfill 마이그레이션 (024) 적용 후 옛 분리 row 잔존 X (mismatch 카운트 0)
- [ ] DB UNIQUE 제약 추가 (보강 후)

---

## 14. Stage 0~7 진행 이력

| Stage | 내용 | 산출물 |
|---|---|---|
| **0-1** | `work_logs` 4 컬럼 nullable 추가 | `023_work_logs_time_4cols.sql` |
| **0-2** | Write path 수정 (호환 모드 — 신규 + 기존 컬럼 둘 다 채움), `actual_start_time` SoT 통일 | `team-status/check-in/*`, `api/work-logs/route.ts` |
| **0-3** | Backfill 마이그레이션 — 옛 분리 row + `daily_work_status.checked_in_at` → 4 컬럼 흡수 | `024_backfill_unified_time_columns.sql` |
| **0-4** | Read path 단순화 — `unified-times.ts` 단일 진입점. 분리 모델 read 제거, legacy fallback 유지 | `src/lib/work-logs/unified-times.ts` |
| **1** | 퇴근보고 수정 모달에서 다음날 영역 숨김 보강 | `WorkLogForm.tsx` |
| **2** | 미보고 상태 출근보고 prefill — "미보고" 잠금 + 토글 + NULL 저장 | `CheckInModal.tsx`, `team-status/check-in/route.ts` |
| **3** | 미보고 상태 퇴근보고 prefill — 09:00/18:00 default | `WorkLogForm.tsx` (verify 필요 §12 D6) |
| **4** | 출근완료 미사용 팀 read-time 보정 + 클라이언트 polling | `work-log-state.ts:computeEffectiveActualStart`, polling hook (verify §12 D4) |
| **5** | 캘린더 4단계 시간 표시 검증 | `MyHistoryCalendar.tsx` + `unified-times.ts:displayTimeRange` |
| **6** | 동시 제출 알림 채널 통일 (퇴근보고 채널만) | `teams.ts:271-289` |
| **7** | 필드 수준 가드 (server + client) — `_editScope` 분기 + forbidden 배열 | `api/work-logs/[id]/route.ts:382-449` |
| **8** | 정책서 문서화 (이 문서) | `docs/policies/time-and-report-policy.md` |

---

## 15. 파일 인덱스 (시간/보고 도메인)

### 마이그레이션
- `supabase/migrations/011_thirty_min_policy.sql` — 30분 CHECK constraint
- `supabase/migrations/011b_fix_thirty_min.sql` — legacy round 일괄
- `supabase/migrations/017_submissions_check_in_complete.sql` — `check_in_complete` report_type 추가
- `supabase/migrations/021_org_teams_use_check_in_complete.sql` — 팀별 출근완료 토글
- `supabase/migrations/022_work_logs_user_date_indexes.sql` — `(user_email, leave_date)` 인덱스
- `supabase/migrations/023_work_logs_time_4cols.sql` — **4 컬럼 추가**
- `supabase/migrations/024_backfill_unified_time_columns.sql` — **backfill**

### 핵심 헬퍼
- `src/lib/work-logs/unified-times.ts` — 4 컬럼 SoT + 분류 + 표시
- `src/lib/work-log-state.ts` — 5단계 상태 머신 + `computeEffectiveActualStart`
- `src/lib/utils/half-hour.ts` — 30분 단위 변환
- `src/lib/ew-calculator.ts` — EW 계산 + 자정 처리
- `src/lib/leave-timeline.ts` — 휴가/휴게 ceil
- `src/lib/notifications/teams.ts` + `messages.ts` + `types.ts` + `teams-routing.ts` — 알림 일체

### API
- `src/app/api/team-status/check-in/route.ts` — 출근 보고 UPSERT
- `src/app/api/team-status/check-in/complete/route.ts` — 출근 완료 (있다면)
- `src/app/api/team-status/check-out/route.ts` — 퇴근 보고
- `src/app/api/team-status/check-{in,out}-cancel/route.ts` — 취소
- `src/app/api/team-status/route.ts` — 팀원 카드 (effective_actual 포함)
- `src/app/api/work-logs/route.ts` — POST (퇴근 + 명일) / GET (4 컬럼 + effective)
- `src/app/api/work-logs/[id]/route.ts` — PATCH (`_editScope` 가드) / DELETE (논리)
- `src/app/api/my/submission-status/route.ts` — 본인 일자별 status
- `src/app/api/my/missed-checkout/route.ts` — 본인 최근 미완료
- `src/app/api/missing-reports/route.ts` — 회사 전체 미보고
- `src/app/api/missing-reports/notify/route.ts` — 수동 nudge

### 컴포넌트
- `src/components/CheckInModal.tsx` — 출근 모달 (case A/B/C/future)
- `src/components/WorkLogModal.tsx` + `WorkLogForm.tsx` — 퇴근 모달 + 폼
- `src/components/MyHistoryCalendar.tsx` — 본인 월간 캘린더
- `src/components/SubmissionsRawTable.tsx` — RAW 제출내역
- `src/components/MissingReportsListView.tsx` — 미보고 list (리더+)
- `src/components/MissingReportsSummary.tsx` — 본인 미보고 요약 배너

---

## 16. 변경 이력

| 날짜 | 버전 | 변경 | 작업자 |
|---|---|---|---|
| 2026-05-17 | v1.0 | 초기 작성. Stage 0~7 결과 박제. discrepancy 8건 기록 (D1~D8). | Claude (Phase 3 — 회고적 문서화) |
| 2026-05-17 | v1.1 | D1·D2·D8 해결. D1은 코드 재확인으로 ✅ (Agent 초기 오판 정정). D2는 마이그레이션 025 추가로 ✅. D8은 현재 분담 유지 결정. §10에 결정 6·7·8 추가. | Claude |
| 2026-05-17 | v1.2 | Task Board 상태 머신 정비 (DEV/STG/PROD prefix 통일, QA 진행중 상태 신설, `재작업 출처` property 추가). 본 시간/보고 정책 자체엔 영향 없음 — 비즈니스 정책 동일. 머신 정의는 `AGENTS.md` / `CLAUDE.md` 의 "Task Board 상태 머신" 섹션 참조. | Claude |
| 2026-05-17 | v1.3 | [ABC-180](https://www.notion.so/363e23a15c0180e3b714de877a64173f) — D+1 출근보고 동시 제출 시 새 값 무시 버그 fix. `src/app/api/work-logs/route.ts` D+1 UPSERT 로직에 ① 동일 `(user, leave_date)` 중복 row 자동 soft-delete (옛 분리 모델 잔재 정리) ② UPDATE 결과 `.select()` 검증 + 불일치 시 warn 로그. 정책 자체는 §3.3 "동시 제출" 그대로 (사용자 입력값으로 overwrite) — 구현 보강. | Claude |
| 2026-05-17 | v1.4 | ABC-180 운영 후속 — PROD에 `025_work_logs_user_date_unique` 마이그레이션 적용 완료. 사전 점검에서 발견된 중복 활성 row 31건(9그룹) `is_deleted=true` 정리 후 partial unique index 생성. §12 D2 본문도 PROD 적용 사실 반영. 비즈니스 정책 변경 없음 — §2.2 단일 row 모델이 이제 DB 레벨에서도 강제됨. §E 단축 예외(STG_QA 생략) 사용자 트리거로 적용. | Claude |
