# N-Click 시간 및 보고 정책서

> **최종 갱신** — 2026-05-21 (v1.30 — Phase 1.5 c/d/e + admin 캘린더 CRUD 완료)
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

### 3.4 Google 캘린더 휴가 자동 매핑 · N-Click 입력 우선 (v1.7, 2026-05-19)

| 항목 | 정책 | 구현 위치 | 상태 |
|---|---|---|---|
| 매핑 날짜 기준 | **보고 대상일(leave_date) 기준**으로만 Google Sheets 휴가 캐시 조회. 보고 작성일(today)과 명확 구분 — 전일·명일 사전등록 시에도 leave_date 사용 | `CheckInModal.tsx:214-236` calendar-events effect (`date` prop = leave_date) | ✅ |
| N-Click 입력 우선 | 사용자가 N-Click에서 출근/퇴근보고를 submit하면 Google 자동 매핑(source='calendar') leave_timeline 항목은 자동 제거. 사용자가 LeaveTimelineInput에서 직접 추가한 항목(source='user'/미지정)은 유지 | `CheckInModal.tsx` submit 직전 + `WorkLogForm.tsx:onSubmit` submittedLeave 분기 | ✅ |
| UI 안내 | Google 캘린더 휴가 정보는 LeaveTimelineInput에 prefill로 표시 (사용자가 확인·수정 가능). submit 시점에 자동 매핑 항목은 보관 안 함 | 동일 | ✅ |
| 발견 케이스 | 윤정인 5/19 work_log에 5/18 휴가 "단이 건강검진"이 잘못 매핑 (2026-05-18 보고). 데이터 정정(planned 10:00~17:30) + 정책 보강으로 재발 방지 | PROD update 완료 | ✅ |

### 3.5 모달 날짜 변경 시 form prefill 재적용 (v1.8, 2026-05-19)

| 항목 | 정책 | 구현 위치 | 상태 |
|---|---|---|---|
| 트리거 | 사용자가 CheckInModal·WorkLogForm 안에서 "날짜" 또는 "퇴근일자" input을 변경 | date state 변경 → useEffect 재실행 | ✅ |
| 응답 있음 (그 일자에 work_log 존재) | 그 일자의 값으로 form 재 prefill (locations·startTime·endTime·workContent·leaveTimeline) | `CheckInModal.tsx:fetchPrefill` + `WorkLogForm.tsx:615-651` | ✅ |
| 응답 없음 (그 일자에 work_log 없음) | **default reset** — 09:00~18:00 / 사무실 1개 / 빈 메모 / leaveTimeline `[]`. 이전 일자의 prefill 값이 끌려가지 않게 명시 reset | 동일 | ✅ |
| Google 휴가 재매핑 | calendar-events effect도 date dependency라 자동 재호출. 새 일자의 Google 휴가가 leaveTimeline에 자동 매핑됨 (위 leaveTimeline=[] reset 후) | `CheckInModal.tsx:214-236` + `WorkLogForm.tsx:585-607` | ✅ |
| 첫 진입 보호 | `initialStartTime` prop이 있으면 첫 fetch 시 startTime 덮어쓰지 않음 (useRef로 추적). 그 후 date 변경 시엔 항상 응답 또는 default 적용 | `isFirstFetchRef` (CheckInModal) / `initialStartTime` 가드 (WorkLogForm) | ✅ |
| 사용자 manual 휴가 처리 | 사용자가 LeaveTimelineInput에서 직접 추가한 항목(source='manual')은 leaveTimeline=[] reset 시 같이 제거됨. 사용자가 새 일자에 휴가 의도면 다시 추가 | 단순 reset (별도 보호 없음) | ✅ |

### 3.6 N-Click → Google 캘린더 휴가 자동 push (Phase 1.5b, 2026-05-20)

work_logs UPSERT 시 leave_timeline 변경분을 사용자 본부의 vacation 캘린더로 best-effort push. 사용자 본인 Google 계정엔 영향 없음 — Service Account 권한으로만 동작.

| 항목 | 정책 | 구현 위치 | 상태 |
|---|---|---|---|
| 트리거 | `/api/work-logs` POST UPSERT 직후 hook (D-day + D+1 각각) | `src/app/api/work-logs/route.ts:385-411, 545-588` | ✅ |
| 대상 본부 | `org_calendars` 에 `calendar_type='vacation'` + `is_active=true` 등록된 본부만 동작. 미등록 본부는 skip(`skipped: true`) | `src/lib/google-calendar/vacation-sync.ts:34-83` (`getUserVacationCalendar`) | ✅ |
| 캘린더 선택 우선순위 | ① 사용자 팀 매핑 vacation 캘린더 → ② 본부 공용(team_id NULL) → ③ 첫 매칭 | 동일 | ✅ |
| **이벤트 형식** | **모든 휴가(종일·부분 무관)을 종일 이벤트로 push** | `vacation-sync.ts:buildVacationEventBody` | ✅ |
| **타이틀 형식** | `[<사용자명>] <시간>H 휴가` — 예 `[김재민] 8H 휴가` / `[홍길동] 3H 휴가` / `[홍길동] 0.5H 휴가` (30분 단위는 소수점 1자리) | `vacation-sync.ts:formatHoursLabel` | ✅ |
| 사유 (왜 종일 + 텍스트?) | 부분 휴가를 시간 블록(예 10:00~14:00)으로 push하면 회의/일정 충돌처럼 보여 잘못 해석됨. 종일 + 타이틀의 시간 명시가 "근무 없음" 의미를 가장 명확하게 전달 | (정책 결정 — 사용자 2026-05-20) | ✅ |
| diff 처리 | prev → next 비교 후 ① prev에 있고 next에 없는 `google_event_id` → events.delete ② next에 `google_event_id` 없는 entry → events.insert (성공 시 id를 work_logs.leave_timeline 에 채워 재update) ③ 양쪽 다 있고 actualMinutes 다르면 events.update | `vacation-sync.ts:syncLeaveTimelineWithGoogle` | ✅ |
| 실패 정책 (best-effort) | Google API 실패해도 work_logs 저장은 정상. 응답 body의 `__vacationSync.{dDay,dPlus1}` 필드에 결과(`calendarMatched`/`calendarRawId`/`inserted`/`updated`/`deleted`/`errors[]`) 노출 | `work-logs/route.ts:392-411, 564-590` | ✅ |
| 진단용 라우트 | `POST /api/debug/vacation-replay?date=YYYY-MM-DD` — 본인 work_log의 leave_timeline을 변경 없이 sync 재시도. `google_event_id` 채워진 entry는 skip, 비어있는 것만 insert 시도 | `src/app/api/debug/vacation-replay/route.ts` | ✅ |
| leave_timeline 스키마 변화 | `LeaveTimelineItem.google_event_id?: string` 추가 (optional) — sync 식별 키 | `src/types/leave-timeline.ts:58-64` | ✅ |
| 발견 케이스 | 5/20 22:59 김재민 4/22 휴가 push 안 됨 — commit 459647c(22:54:49) PROD 빌드가 사용자 제출(22:59:04) 직전에 막 완료된 timing으로 hook 미배포. 진단 라우트(`/api/debug/vacation-replay`) 호출로 재push 성공 확인 | 코드 fix 불필요 — timing artifact | ✅ |

---

## 4. 시간 노출 정책

### 4.1 4단계 상태 분류

`src/lib/work-logs/unified-times.ts:81-92` 의 `classifyWorkLog(row)` 가 반환하는 enum.

| 상태 | 조건 | 표시 | 상태 |
|---|---|---|---|
| `no_data` | 모든 시간 컬럼 NULL + 휴가 아님 | "미보고" 칩 (과거 = 어제 이전) 또는 비워둠 (**오늘** / 미래) | ✅ |
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
| 미보고 + 과거 (어제 이전) | "미보고" / "퇴근누락" 칩 | `MyHistoryCalendar.tsx:582-613` | ✅ |
| 미보고 + **오늘** | 비워둠 (진행 중 — 퇴근 시간 전일 수 있음) | `submission-status/route.ts` (`isToday && !complete → 'future'`) | ✅ (v1.6, 2026-05-18) |
| 미보고 + 미래 | 비워둠 | `submission-status/route.ts` (`d > today → 'future'`) | ✅ |

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

### 11.6 캘린더 뷰 3종 — 명칭·경로·정의 (v1.33, 2026-05-21)

N-Click에는 성격이 다른 캘린더 뷰가 3종 존재한다. 코드·UI·문서·구두 커뮤니케이션에서 **아래 명칭으로 통일**한다 (종전 "본부 캘린더" / "매트릭스 캘린더" 등 혼용 폐기).

| 명칭 | 경로 | 진입 권한 | 데이터 / 목적 | 구현 위치 |
|---|---|---|---|---|
| **MY PAGE 캘린더뷰** | `/home` → "최종 보고" 탭 → "캘린더" 토글 | 본인 | 본인 work_logs 일자별 최종 보고를 월간 캘린더로. 출근/퇴근보고 수정·신규 진입점. | `MyHistoryCalendar.tsx` |
| **구글캘린더 연동뷰** | `/calendar` (또는 `/home` → "일정관리" 탭에 임베드) | 전 구성원 (로그인) | org_calendar_events 캐시를 사용자×날짜 매트릭스로. Google 캘린더와 **실시간 양방향 동기화**. 일정 등록/수정 가능(본인 본부 한정, admin 전체). | `src/app/calendar/page.tsx` (`CalendarMatrixView`) |
| **구글캘린더 연동 어드민뷰** | `/admin/calendars` | admin | org_calendars(본부/팀별 Google 캘린더 연결) CRUD 관리. | `src/app/admin/calendars/page.tsx` |

- **MY PAGE 캘린더뷰** = "내가 무엇을 보고했나" (보고 데이터). **구글캘린더 연동뷰** = "조직 일정이 어떻게 잡혀 있나" (Google 캘린더 일정).
- 구글캘린더 연동뷰는 `/home`의 "일정관리" 탭으로도 임베드되어 일반 구성원이 별도 URL 없이 접근 가능 (`CalendarMatrixView embedded` — 상단 "← 홈" 링크 hide). `/calendar` 직접 접근도 동일 뷰.
- 안내 문구(연동뷰 헤더): "해당 캘린더는 구글캘린더와 실시간 양방향 동기화 됩니다".

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

✅ **D9. `daily_work_status` ↔ `work_logs` 동기화 (2026-05-18, ABC-188 fix 완료)**
- **정책** — 본인 카드/팀 카드의 "실제 출근·실제 퇴근" 표시는 `daily_work_status.checked_in_at` / `checked_out_at` 을 SoT로 한다. 단 이 두 컬럼은 항상 동일 `(date, user)`의 **활성** `work_logs.actual_start_time` / `actual_end_time` 과 일치해야 한다.
- **동기화 트리거**:
  1. 출근보고 신규 row 생성 (`team-status/check-in`, `willCreateNewLog=true`) → 이전 퇴근 잔재 reset: `daily.checked_out_at = NULL`. 새 출근보고는 "이전 사이클은 더 이상 유효하지 않음" 신호.
  2. 퇴근보고 (`POST /api/work-logs`) → `actual_start_time`/`actual_end_time` 과 `daily.checked_in_at`/`checked_out_at` 을 동일 폼 시각으로 함께 저장.
  3. 어드민·운영이 `work_logs` 를 `is_deleted=true` 정리할 때 **반드시** 동일 `(date, user)`의 `daily_work_status.checked_*` 도 NULL 처리 + `status='reported'`. (운영 절차 박제)
- **이전 상태** — `team-status/check-in/route.ts` 라인 360 코멘트로 "이 라우트에서 checked_out_at은 안 건드림" → 새 출근보고가 들어와도 옛 퇴근 잔재가 남아 UI에 옛 시각 노출. 어제(2026-05-17) QA 데이터 정리 시에도 `daily` 누락.
- **조치** — `team-status/check-in/route.ts` 의 `dailyUpsertPayload` 에 `willCreateNewLog` 분기 추가: 새 work_log row이면 `checked_out_at = null` 강제. PROD 잔재 8건 일괄 정리 (`log_actual_end_null` 1건 + `no_active_log` 7건).
- **재발 방지** — 운영 절차 메모: PROD `work_logs` 정리 SQL 작성 시 `daily_work_status` 동시 처리 쿼리도 묶어 보고/실행. CLAUDE.md / AGENTS.md §6 점검 단계에 포함.

⚠️ **D3. 미보고 토글 NULL 저장 경로**
- **정책** — 토글 안 풀고 제출 → `planned_start_time = NULL`.
- **코드** — `CheckInModal` state 추적까진 확인. `team-status/check-in/route.ts` 의 실제 NULL 핸들링 미검증.
- **검증** — POST 요청 시 `plannedStartTimeUnreported=true` 인 경우 서버가 `planned_start_time` 을 NULL로 저장하는지 단위 테스트 필요.

⚠️ **D4. Polling interval 명시 부재**
- **정책** — 60초 기본 / planned ±10분 30초 / hidden·모달 정지.
- **코드** — 모달 context 정지 부분만 확인 (`CheckInModal.tsx:86-87`). 60초/30초 interval 코드 위치 미확인.
- **검증** — `useAutoRefetch` 같은 훅 위치·구현 확인 필요.

✅ **D5. 캘린더 "미보고" 칩 렌더 (2026-05-18 v1.6 — 정책 갱신 후 ✅)**
- **정책** — **과거(어제 이전)** + `no_data` → "미보고" 칩, **오늘** + 미래 → 비워둠. (v1.6 이전: 오늘도 미보고 게이트에 포함 → "퇴근누락" 뱃지가 오늘 출근만 한 사용자에게 표시되는 버그)
- **이유** — 오늘은 아직 퇴근 시간 전일 수 있음. 사용자가 출근 후 퇴근 보고 시각이 도래하기 전인 상태에서 "퇴근누락"으로 잡히면 false positive. 보고 의무 게이트는 어제까지로 한정.
- **예외** — 오늘이라도 출/퇴근 모두 작성된 경우(조기 퇴근)는 `complete`로 인정.
- **구현** — `submission-status/route.ts` (오늘 미보고는 `'future'`로 분류), `missing-reports/route.ts` (`effectiveTo = yesterday`).
- **Teams nudge** — 회사 미보고 리스트(`/api/missing-reports`)와 같은 데이터 소스라 자동 일관 (오늘 미보고는 리스트에 안 떠서 nudge 후보에서도 자연 제외).

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

- [ ] 퇴근보고 수정 모드 진입 시 다음날 영역(D+1) 렌더링 X
- [ ] 퇴근보고 폼 — 감사 마카롱 영역 UI 자체 없음 (2026-05-19 v1.10 제거, DB 컬럼은 유지)
- [ ] 퇴근보고 폼 — 지각/당일수정 영역은 별도 "기타" h3 섹션, `showCheckOutSections` gate (check_in 수정 모드에서 hide)
- [ ] 퇴근보고 폼 — 토·일·공휴일 근무(workSubType !== null) 시 휴가/반차 input + 계산결과 breakdown `− 휴가` 줄 둘 다 hide (2026-05-19 v1.12)
- [ ] 퇴근보고 폼 — 간주근로(workTypeCode=2) + 실근무 8h 미만 시 EW 시간/코드 영역 hide + advisory 강조 + 제출/수정 버튼 회색 비활성화 + submit handler 가드 (2026-05-19 v1.13)
- [ ] 시간 dropdown — TimeSelect / HalfHourTimeSelect는 CustomDropdown 기반 (native `<select>` X). 열릴 때 선택값이 popover 위에서 3번째 위치에 자동 스크롤 (2026-05-19 v1.14)
- [ ] 퇴근보고 폼 — prefill fetch 중에는 실제 출/퇴근시간 dropdown이 loading 상태(`disabled` + placeholder "불러오는 중…"). 응답 도착 시 실제 값으로 등장. 수정 모드(editingLog 있음)와 D+1·지각/당일수정 영역은 loading 미적용 (2026-05-19 v1.15)
- [ ] DateInputWithDow popover — react-day-picker v10 default 색상을 우리 토큰(primary-600/50)으로 매핑. 헤더 가운데 + 좌우 nav 양 끝, 폰트 size/weight 통일. `.rdp-themed` wrapper class에서 일괄 처리 (2026-05-19 v1.16)
- [ ] DateInputWithDow popover — input button 가로 중앙 기준 가운데 정렬(`left-1/2 -translate-x-1/2`) + `width: fit-content`. 모바일 모달에서 cells 합계 너비 박스로 단정. 화살표가 모달 양 끝에 붙지 않음 (2026-05-19 v1.17)
- [ ] WorkLogForm prefill loading — useState 초기값 `!editingLog && !initialStartTime` + useEffect 모든 early return path에 `setIsPrefillLoading(false)` 안전망 + .finally의 ac.signal.aborted 가드 제거 + 4초 safety timer. 무한 hang 구조적으로 불가능 (2026-05-19 v1.18~v1.20)
- [ ] Teams notify 함수 전체 await 패턴 — 모든 notify(`worklog_submitted`/`worklog_updated*`/`worklog_deleted`/`checkin_submitted`/`break_started`/`break_ended`)가 `Promise<void>` 반환 + 호출처에서 await. fire-and-forget으로 Vercel function 종료 시 sendToMake retry/logNotification insert가 끊겨 알림 누락되던 버그 fix. 호출 라우트 maxDuration=60s 통일 (2026-05-19 v1.21)
- [ ] sendToMake — timeout 발생 시 retry 비활성화 (at-most-once 의미론). Make webhook이 메시지 받고 응답 늦으면 우리 timeout → retry → Make 중복 발송되던 버그 fix. 5xx · 네트워크 에러만 retry. fetch timeout 15s (2026-05-19 v1.22)
- [ ] 사용자-facing 폼 dropdown 7고 전체 CustomDropdown 통일 — WorkLogForm 4 + LeaveTimelineInput 1 + WorkLocationTimelineInput 2. admin 9 + Pagination + ui/Input은 종전 native 유지 (관리자 도구 별도 패턴) (2026-05-19 v1.23)
- [ ] CustomDropdown popover — React Portal로 document.body에 렌더 + position:fixed + 트리거 getBoundingClientRect 기준 좌표 + 화면 하단 자동 flip + scroll/resize 추적 + 외부 클릭 wrapperRef + listRef 둘 다 검사. 모달의 overflow-y-auto 컨테이너 안에서 popover 잘리던 버그 fix (2026-05-19 v1.24)
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
| 2026-05-18 | v1.5 | [ABC-188](https://www.notion.so/363e23a15c01812c9f31ccb4db3358a2) — MY PAGE "실제 퇴근"이 실제 퇴근 안 했는데도 표시되는 버그. 근본 원인: `team-status/check-in` 라우트가 새 출근보고를 받아도 옛 `daily_work_status.checked_out_at` 잔재를 안 건드림. §12에 D9 신설(`daily_work_status` ↔ `work_logs` 동기화 규칙). 코드 fix: `willCheckInComplete`일 때 `checked_out_at = NULL` 강제 reset. PROD `daily_work_status` 잔재 8건 일괄 정리 (`log_actual_end_null` 1 + `no_active_log` 7). §E 단축 예외(STG_QA 생략) 사용자 트리거로 적용. | Claude |
| 2026-05-18 | v1.6 | **미보고 게이트 정책 변경** — "오늘"은 보고 의무 게이트에서 제외 (퇴근 시각 전일 수 있음). 사용자 보고 캘린더 셀에 "퇴근누락" 뱃지가 당일에도 표시되던 false positive 수정. 구현 — ① `submission-status/route.ts` — 오늘 + (출근만 / 둘 다 없음) → `'future'` 분류 (미보고 카운트·뱃지 X). 단 오늘 + 출/퇴근 모두 작성됐으면 `complete` 그대로 인정. ② `missing-reports/route.ts` — `effectiveTo`를 `yesterday`로 클램프, 회사 미보고 리스트에서 오늘 자동 제외. ③ Teams nudge — `/api/missing-reports`와 같은 판정 소스라 자동 일관 (오늘은 리스트에 안 뜨므로 nudge 후보에서도 자연 제외). §4.1·§4.2 표 갱신, D5 ⚠️→✅ 전환. | Claude |
| 2026-05-19 | v1.7 | **Google 캘린더 휴가 자동 매핑 정책 명시 + N-Click 입력 우선** — 윤정인 5/19 work_log에 5/18 휴가 "단이 건강검진"이 잘못 매핑된 케이스 보고. 원인: (1) 매핑 날짜 기준 혼재 (보고 작성일 today vs 보고 대상일 leave_date), (2) Google 자동 매핑이 사용자 시간 입력보다 우선 적용. 조치 — ① 매핑 기준 명확화: **항상 leave_date 기준**으로만 Google Sheets 휴가 캐시 조회. 전일·명일 사전등록 시에도 동일 적용. ② N-Click 입력 우선: 사용자가 출근/퇴근보고 submit 시 source='calendar' leave_timeline 항목은 자동 제거 (CheckInModal + WorkLogForm). 사용자가 LeaveTimelineInput에서 직접 추가한 항목은 유지. ③ 정책서 §3.4 신설. PROD 데이터 정정 완료(윤정인 5/19 planned=10:00~17:30, leave_timeline=NULL). | Claude |
| 2026-05-19 | v1.8 | **모달 날짜 변경 시 form prefill 재적용 정책** — 사용자 보고: 출근보고 수정 모달에서 "날짜" input 변경해도 아래 form 값(시간·근무장소·메모)이 이전 일자 값으로 유지됨. 의도: 응답에 그 일자 work_log 있으면 그 값으로 재 prefill, 없으면 default reset. 조치 — ① CheckInModal `fetchPrefill`: 모든 setX 항상 호출, 응답 없으면 default(09:00~18:00, 사무실, 빈 메모, leaveTimeline=[]). `isFirstFetchRef` useRef로 첫 진입 시 `initialStartTime` prop 보호. ② WorkLogForm 신규 작성 흐름의 leaveDate prefill effect — `!hasExisting` 시 09:00/18:00 명시 reset. ③ Google 휴가 자동 매핑은 calendar-events effect가 date dependency라 자동 재호출 — 새 일자의 휴가가 leaveTimeline에 매핑됨 (위 reset 후). ④ 정책서 §3.5 신설. | Claude |
| 2026-05-19 | v1.9 | **근무장소 변경 Teams 알림 — "완료" 클릭 시점 일괄 발송 (C2)** — 사용자 보고: 칩 추가/제거/별표 변경 시점마다 즉시 알림 → 한 편집 세션에서 알림 2-3건 회사 채널 도배. 조치 — ① `/api/team-status/location` POST 라우트의 `notifyLocationChanged()` 호출 제거 (DB 저장·event 기록은 그대로). ② `/api/team-status/location/notify` 신규 POST 라우트 — 본인 work_log + daily 상태 read 후 알림 발송. ③ `EditableLocationChips.tsx` — 편집 시작 시 `startSnapshotRef`(chips JSON + currentLabel) 기록, "완료" 클릭 시 변화 비교 → 변화 있을 때만 notify 라우트 호출 (fire-and-forget). 변화 없으면 skip. 자동 저장 UX는 무변경. | Claude |
| 2026-05-19 | v1.10 | **퇴근보고 폼 — 감사 마카롱 영역 제거 + 지각/당일수정 별도 "기타" 섹션으로 분리** — 사용자 즉석 지시. ① 감사 마카롱: UI + zod schema + editingLog prefill + submit body 모두 제거. DB column `thanks_macaron`은 유지 — 기존 데이터 보존, PATCH는 undefined면 기존값 유지(`?? log.thanks_macaron`), POST는 null insert. ② 지각/당일수정: 종전 "기타" 5번 섹션 안의 카드 박스 형태에서, 다른 본문 섹션과 동일하게 h3 헤더 + 가로 줄 패턴의 별도 4번 "기타" 섹션으로 분리. hide gate(`showCheckOutSections`)는 그대로 — check_in 수정 모드에서 hide 정책 동일성 유지. ③ "추가 입력 영역" wrapper는 D+1 출근보고 hide gate(`showCheckInSections && !hideD1Section`)에 묶임. §13 체크리스트 갱신. 정책 자체 변경 없음 — UI 레이아웃 정리. §E 단축 예외(STG_QA 생략) 사용자 트리거. | Claude |
| 2026-05-19 | v1.11 | **반차(오전/오후) 시 출/퇴근 09-18 강제 정책 폐기 — 사용자 입력 그대로 EW 계산** — 사용자 보고: 02:30~11:30 + 반차 5h 입력 시 "계산 결과" breakdown 박스에 09:00~18:00이 표시됨. 원인: `WorkLogForm.tsx`의 `forceStandardSpan = isAllDay \|\| hasReducedLeave` 로직이 반차 케이스에서도 EW 계산 input의 startTime/endTime을 09:00/18:00로 강제 치환. 폼 입력값과 계산 결과 표시가 불일치하는 UX 버그. 조치 — ① `forceStandardSpan = isAllDay`로 좁힘 (preview useEffect + submit 두 곳 모두). 종일 휴가만 09-18 강제 유지 (실근무=0 강제와 정합). 반차는 사용자 입력 그대로. ② 정책 영향 — 반차 + 사용자가 02:30~11:30 같은 비표준 working window 입력 시 EW 시간 계산 결과가 종전과 달라질 수 있음. 단 표준 09-18 시간대로 입력한 케이스(대부분)는 결과 동일. ③ 계산식 breakdown(2026-05-19 commit a2d9e7d)이 폼 입력값을 정직하게 반영하게 됨. §E 단축 예외(STG_QA 생략) 사용자 트리거. | Claude |
| 2026-05-19 | v1.12 | **토·일·공휴일 근무 시 휴가/반차 영역 hide** — 사용자 의견: 토요일·일요일·공휴일 근무에는 휴가 개념이 일반적으로 안 쓰이므로 폼 입력 영역 + 계산 결과 breakdown 휴가 줄 둘 다 hide. 조치 — ① `WorkLogForm.tsx` 휴가/반차 div를 `{workSubType === null && (...)}` gate. ② `CalculationPreview.tsx` breakdown 표의 `− 휴가` 줄도 동일 gate. 평일(기본/간주) 케이스 영향 없음. `leaveTimeline` 데이터 자체는 보존 (UI hide만, 계산 영향 없음). §13 체크리스트 한 줄 추가. §E 단축 예외(STG_QA 생략) 사용자 트리거. | Claude |
| 2026-05-19 | v1.13 | **간주근로 + 실근무 8시간 미만 제출 차단** — 사용자 보고: 간주근로 선택 + 실근무 8h 미만 입력 시 EW 영역에 의미 없는 값(예: 17:30~17:30, acMinutes=ewEndMinutes 동일) 표시 + 사용자가 그대로 제출 가능. 잘못된 EW가 work_logs에 저장됨. 조치 — ① `CalculationPreview.tsx` advisory 문구 변경 "간주근로는 8시간 이상의 외근시 L1~L9으로 인정됩니다." + 8h 미만 시 EW 시간/코드 영역 hide + advisory 박스 강조(border-2 + font-semibold + ⚠). ② `WorkLogModal.tsx` `submitBlocked = workTypeCode===2 && actualWorkMinutes<480` 계산, 데스크탑/모바일 제출 버튼 둘 다 disabled + 회색(bg-surface-muted + cursor-not-allowed). ③ `WorkLogForm.tsx` submit handler 가드 추가 — Enter 키 우회 방지. 기본 근무(1) / 공휴일 근로(3) 영향 없음. 데이터 품질 ↑. §E 단축 예외(STG_QA 생략) 사용자 트리거. | Claude |
| 2026-05-19 | v1.14 | **시간 picker — native `<select>` → CustomDropdown 교체** (UI 인프라 개선, Phase 1) — 사용자 UX 의견: 시간 dropdown 다시 열면 선택값이 popover 맨 하단에 잡혀 부자연스러움. native `<select>`의 열린 dropdown은 OS/브라우저 native control이라 JS 스크롤 위치 제어 불가. 조치 — ① 신규 `src/components/ui/CustomDropdown.tsx` — 재사용 base popover dropdown. 트리거 className은 기존 native select-tight와 동일 시각 토큰(border/radius/focus/disabled), chevron은 lucide ChevronDown으로 명시. ② open 시 `listRef.scrollTop = max(0, selectedIdx - 2) * 36` → 선택값 위에서 3번째 위치 자동 스크롤 (사용자 결정 옵션 A). ③ 키보드 ↑↓ Enter Esc Home End + 외부 클릭 닫기 + a11y(role=listbox/option, aria-*). ④ `TimeSelect.tsx` / `HalfHourTimeSelect.tsx` 내부 `<select>` 제거 → CustomDropdown으로 교체. props/API 완전 보존 — 사용처(WorkLogForm, CheckInModal) 코드 변경 0줄. ⑤ Phase 1 trade-off: 모바일 OS native wheel picker 손실, portal 미사용(매우 좁은 컨테이너 overflow 가능). DB 변경 없음. 짧은 enum native select(근무유형/예아니오/휴게시간 등)는 종전대로 native 유지 — 가치 매트릭스가 균등하지 않아 전체 통일 비추, 시간 picker만 우선 적용. §E 단축 예외(STG_QA 생략) 사용자 트리거. | Claude |
| 2026-05-19 | v1.15 | **prefill fetch 중 시간 dropdown loading 상태로 default flicker 제거** — 사용자 보고: 퇴근보고 모달 열린 직후 시간 dropdown에 09:00/18:00 default가 잠깐 보이다가 2-3초 후 prefill API 응답으로 실제 값(예: 10:00/19:30)으로 갱신됨. CustomDropdown 도입(v1.14)으로 더 잘 인지됨. 원인 — `WorkLogForm.tsx` mount 시점에 react-hook-form defaultValues(09:00/18:00) 즉시 렌더 + 동시에 `/api/team-status/expected-timeline` fetch가 cold start + DB 조회로 2-3초 지연 → setValue로 사후 덮어쓰기. 조치 — ① `CustomDropdown.tsx` `loading?: boolean` prop 추가, true 시 disabled + selectedLabel 숨김 + placeholder "불러오는 중…" + aria-busy. ② `HalfHourTimeSelect.tsx` loading prop passthrough. ③ `WorkLogForm.tsx` `isPrefillLoading` state(`useState(() => !editingLog)`), expected-timeline fetch useEffect 시작 시 setIsPrefillLoading(true)(editingLog 없을 때만), .finally에 `if (!ac.signal.aborted) setIsPrefillLoading(false)`. 실제 출/퇴근시간 HalfHourTimeSelect 둘 다 loading 전달. 수정 모드/지각·당일수정/D+1 영역은 prefill 무관이라 loading 미적용. DB 변경 없음. §E 단축 예외(STG_QA 생략) 사용자 트리거. | Claude |
| 2026-05-19 | v1.16 | **달력 popover 디자인 토큰 통일 — react-day-picker 테마 정리** — 사용자 디자인 의견: ① 색상이 default(다른 톤 파랑)이라 우리 primary와 안 맞음 ② caption/weekday/day 폰트 size·weight 다양 ③ "2026년 5월" 헤더가 좌측 텍스트 + 우측 화살표라 균형 깨짐. 조치 — `src/app/globals.css`에 `.rdp-themed` wrapper class 신설. CSS variables override(`--rdp-accent-color: primary-600` / `--rdp-accent-background-color: primary-50` / `--rdp-day_button-border-radius: 8px` / `--rdp-day_button-width/height: 36px` 등) + selector 통일(`caption_label 14px/600` / `weekday 12px/500` / `day 13px/400`). 헤더 — `.rdp-month_caption`을 flex justify-center + `.rdp-nav`를 absolute inset-0 space-between → 캡션 중앙 + 화살표 양 끝. 오늘은 동그라미 X · primary-600 텍스트 bold(선택과 시각 구분). 선택은 primary-600 배경 채움. hover는 primary-50. `DateInputWithDow.tsx` popover wrapper에 `rdp-themed` 클래스 자강 + padding p-2→p-3. 다른 컴포넌트 영향 없음. §E 단축 예외 사용자 트리거. | Claude |
| 2026-05-19 | v1.17 | **달력 popover 모바일 우측 쏠림 — input 가운데 정렬** — v1.16 디자인 만족 후속 사용자 보고: 모바일뷰에서 popover가 input width를 따라가서 좌우 화살표가 모달 우측 끝에 붙음. 원인 — popover wrapper `left-0`이 트리거 input button 좌측에서 시작. input이 모달 width 거의 full이라 popover도 그 width 따라감. 조치 (사용자 선택 B) — ① `DateInputWithDow.tsx` popover className `left-0` → `left-1/2 -translate-x-1/2 w-fit`(input button 가로 중앙 기준 가운데 정렬). ② `globals.css` `.rdp-themed { width: fit-content; }` 추가 — popover wrapper가 자식(달력 grid) 컨텐츠 width에 맞춰 단정한 박스로 표시. 모바일/데스크탑 양쪽 자연. 좌측 viewport overflow는 input width 충분히 커서 실 사용 드물 듯 — 필요 시 Phase 2에서 clamp 추가. §E 단축 예외 사용자 트리거. | Claude |
| 2026-05-19 | v1.18-1.20 | **WorkLogForm prefill loading 무한 hang fix 3단** — 윤정인/최승현 5/19 퇴근보고 모달에서 시간 dropdown이 "불러오는 중…" 무한 유지 보고. (v1.18) 4초 setTimeout safety net 추가. (v1.19) `.finally`의 `ac.signal.aborted` 가드 제거 — abort 후 응답 도착 시 false 호출 skip되던 race fix. (v1.20) 진짜 root cause — useEffect의 `if (initialStartTime) return` early return 경로에서 setIsPrefillLoading(false) 한 번도 호출 안 됨. `useState(() => !editingLog && !initialStartTime)` + 3개 early return path 모두에 `setIsPrefillLoading(false)` 안전망. 100% 재현 경로: 오늘 출근완료한 사용자가 home에서 "퇴근하기" 클릭 → home/page.tsx가 initialStartTime props 전달 → early return 발동. v1.20이 완전 fix. §E 단축 트리거. | Claude |
| 2026-05-19 | v1.21 | **Teams notify 전체 await 패턴 — fire-and-forget 알림 누락 fix** — 최승현 5/19 18:23 퇴근보고/D+1 출근보고 제출 시 work_logs는 정상 저장됐는데 Teams 알림 미발송 + notification_logs row 자체 없음. 원인 — `src/lib/notifications/teams.ts`의 8개 notify 함수가 `void` 반환 fire-and-forget. Vercel function이 응답 후 wind-down하면서 routeAndSend의 sendToMake retry + logNotification insert promise 강제 중단. v1.10에서 notifyLocationChanged만 await fix했었고 나머지 미흡함의 잔재. 조치 — ① teams.ts 8개 함수(`notifyWorkLogSubmitted`/`Resubmitted`/`Updated`/`UpdatedSplit`/`Deleted`/`CheckinSubmitted`/`BreakStarted`/`BreakEnded`)를 모두 `async + Promise<void>` 반환으로 통일. UpdatedSplit은 `Promise.allSettled`로 병렬 발송. ② 호출처 6고(work-logs POST/PATCH/DELETE + break-start/break-end + check-in)에서 `await` 처리. ③ 호출 라우트 5개 `maxDuration=60s` 통일 (sendToMake worst retry 31.5s + DB 여유). Trade-off: 응답 시간 평소 +1-2초, retry 발동 시 +31초. 알림 누락 보장 X 0건. §E 단축 트리거. | Claude |
| 2026-05-19 | v1.22 | **Teams 중복 알림 fix — sendToMake timeout retry 비활성화** — v1.21 적용 직후 최수빈 5/19 18:31 퇴근보고 1건 제출인데 Teams에 같은 알림 2건 도착(18:29/18:40), notification_logs는 FAILURE Timeout 3회 시도 1건. 원인 — Make webhook이 메시지 받고 Teams 발송 진행 중 응답이 늦어 우리 측 timeout(10s) → 우리는 fail로 인지 + retry → Make는 또 받음 + 또 발송 → 중복. 조치 — ① timeout 시 retry 비활성화(at-most-once 의미론). FAILURE 로깅 후 즉시 return. ② fetch timeout 10s→15s (Make 응답 시간 여유). ③ 5xx + 네트워크 에러는 retry 유지 (Make 미도달 가능성). 4xx 그대로. Trade-off: 진짜 timeout(Make 미수신) 시 알림 누락 가능 — 단 15s 안에 응답 안 오면 애초에 Make 시나리오 문제. 중복 발송 0건 보장. §E 단축 트리거. | Claude |
| 2026-05-19 | v1.23 | **사용자-facing 폼 dropdown 7고 CustomDropdown 통일 (Phase 2)** — v1.14~v1.17 CustomDropdown + DateInputWithDow 테마 PROD 적용 후 "이쁘고 잘 작동" 평가. 동일 패턴으로 나머지 폼 dropdown도 통일 요청. 사용자 선택 A 스코프 — 근무자-facing만 (admin/Pagination/ui/Input 종전 유지). 교체 7고: `WorkLogForm.tsx` (근무유형 / 휴게시간 30분단위 / 지각여부 / 출근보고진행) + `LeaveTimelineInput.tsx` (휴가 시간 30분단위) + `WorkLocationTimelineInput.tsx` (근무 위치 유형 · 시작 시간). 패턴 `register({...}) + <select><option>` → `setValue + <CustomDropdown options=[...] />`. 옵션 라벨 동일, 동작 무변경. §E 단축 트리거. | Claude |
| 2026-05-21 | v1.31 | **CalendarDayDetailModal 휴가 표시 — slot 시간 → 차감 시간** — 사용자 제보: jmjjaang 4/14 캘린더 셀 day-detail 모달 상단 "휴가 09:00~14:00" 표시 vs 본문 실근무 06:30 (= 1.5h 차감만 적용) 어긋남. 원인 — `leave_timeline[i].startTime`/`endTime`은 leaveType 표준 슬롯(morning_half = 09:00~14:00) 표시, 실제 차감은 같은 항목의 `roundedMinutes`(90분). LeaveTimelineInput이 단일 select(30분 단위 차감 분)만 받고 leaveType은 시간 기반 자동 분류 — 시간 슬롯과 차감 분이 의미적으로 분리됨. DB 감사: 4/1 이후 leave_timeline 11건 중 9건이 동일 패턴(일반). 조치 — `CalendarDayDetailModal.tsx` 상단 "N-Click 휴가" 박스 라인을 `roundedMinutes` 기반 `"휴가 1시간 30분"` 형태로 교체. 정책 자체 변경 없음 — 표시 표현만 차감 시간으로 통일(실근무 계산과 일치). DB 변경 없음. commit a49c0c9. STG 영구 스킵 default. | Claude |
| 2026-05-21 | v1.30 | **Phase 1.5 c/d/e 완료 + admin 캘린더 CRUD UI** — ① 1.5d (commit f7b511c): WorkLogForm 종일 휴가 + 근무 충돌 시 묵시 제거(line 800-803) → 명시 확인 modal. confirmedStripLeaveRef 패턴, 확인 시 휴가 항목 제거 + Phase 1.5b sync가 Google에서도 자동 삭제. ② 1.5c (commit 6cc21f0): 역방향 hook — cron sync(`syncOne`) cleanup 안에서 vacation 캘린더의 "Google에 없어진 google_event_id" 들로 work_logs.leave_timeline 매칭 entry 일괄 제거(`cleanupOrphanedLeaveTimeline`, best-effort). ③ 1.5e (commit 0b9cbd4): MY PAGE 캘린더 chip 클릭 → EventEditModal 수정 모드 + "일정 등록" 버튼 → 신규 모드. CalendarEventChunk에 id/startAt/endAt/isAllDay/inferredType/orgCalendarId/rrule/recurringEventId 추가, /api/calendar/range가 SELECT/chunk 빌드 시 동시 enrichment, CalendarDayDetailModal에 onEditEvent/onCreateEvent props 추가. ④ admin CRUD (commit d8ece26): `/admin/calendars` 단계 A(read-only) → 단계 B. POST + PATCH + DELETE 라우트 신설, GET 응답에 divisions/teams 포함(form select용), 모달 form(본부/팀/유형/라벨/Google ID/활성), row 별 [수정]/[활성토글]/[삭제] 액션. Google ID는 plain id + iCal URL 모두 허용. 정책서 §3.6은 1.5b 박제로 충분 — c/d/e는 구현 보강 성격. §E 단축(STG 영구 스킵) 사용 — 한 사이클 4 commit dev→main 직진. | Claude |
| 2026-05-20 | v1.29 | **Phase 1.5b — N-Click → Google 캘린더 휴가 자동 push** — work_logs UPSERT 후 leave_timeline 변경분을 사용자 본부의 vacation 캘린더로 best-effort push. ① `src/lib/google-calendar/vacation-sync.ts` 신설 — `getUserVacationCalendar`(팀 → 본부공용 → 첫 매칭 우선순위) + `syncLeaveTimelineWithGoogle`(prev→next diff → insert/update/delete). ② **모든 휴가를 종일 이벤트로 push, 타이틀 = `[<사용자명>] <시간>H 휴가`** (예 `[김재민] 8H 휴가` / `[홍길동] 3H 휴가`). 부분 휴가도 시간 블록이 아닌 종일로 — 시간 블록은 회의/일정 충돌처럼 보여 잘못 해석됨, 종일+텍스트가 "근무 없음" 의미 가장 명확. ③ `LeaveTimelineItem.google_event_id?: string` 추가 — sync 식별 키. ④ `/api/work-logs` POST D-day/D+1 두 곳 hook + 결과를 응답의 `__vacationSync` 진단 필드로 노출. ⑤ best-effort — Google API 실패해도 work_logs 저장 정상. ⑥ 진단용 신규 라우트 `POST /api/debug/vacation-replay?date=YYYY-MM-DD` — 사이드이펙트 없이 sync 재시도. 발견 케이스: 5/20 22:59 김재민 4/22 휴가 push 실패는 commit 459647c PROD 빌드 직후 timing artifact (재push 성공 확인). 정책서 §3.6 신설. commit 459647c · d12a86b · f941bfa · 6514574. §E 단축 트리거(STG_QA 생략). | Claude |
| 2026-05-19 | v1.24 | **CustomDropdown popover Portal — 모달 안 잘림 + 자동 flip fix** — v1.23 도입 직후 사용자 보고: 수정 모달 하단 근처 dropdown(휴가/메모 주변) 열면 popover가 모달의 `overflow-y-auto` 컨테이너 안에 갇혀 하단 옵션 가려짐. v1.14 도입 시 이미 코멘트로 박제했던 Phase 2 미해결 항목. 조치 — ① `createPortal(popover, document.body)`로 모달 stacking context 밖으로 분리. ② `position: fixed` + `triggerRef.getBoundingClientRect()` viewport 절대 좌표. ③ 화면 하단 자동 flip — `spaceBelow < desiredHeight && spaceAbove > spaceBelow`면 trigger 위로 배치. maxHeight도 사용 가능 공간 내 동적 조정. ④ scroll/resize 추적 — `window.addEventListener('scroll', handler, true)` capture 모드라 내부 스크롤 컨테이너 포함. trigger 이동 시 popover 위치 동기. ⑤ 외부 클릭 가드 — wrapperRef + listRef 둘 다 검사. ⑥ SSR 호환 — `mounted` state로 hydration 후에만 portal 사용. ⑦ z-index 200 — 모달 백드롭(z-50)보다 항상 위. 모든 CustomDropdown 사용처 자동 적용 (TimeSelect/HalfHourTimeSelect/9곳 폼 dropdown). DateInputWithDow popover는 react-day-picker 자체라 별도 — 동일 이슈 보고 시 추후 Portal 적용 고려. §E 단축 트리거. | Claude |
| 2026-05-18 | v1.28 | **알림·둘러보기 시간 표시 정책 통일 — HH:mm 앞 0 유지 + 퇴근예정 함께 노출** — 사용자 즉석 지시: ① 출근완료/morning-summary/22시 리마인더 알림 모두 `08:30~18:00` 형태로 출근예정~퇴근예정 동시 표시 ② 둘러보기 카드 `09:30:00` → `09:30` (MY PAGE `trimToHHmm` 정책 일치). 조치 — ① `messages.ts` `fmtTime`·`kstHHmm` 앞 0 유지로 변경 (모든 알림 자동 통일) ② `CheckinNotifyPayload.expectedStartTime/expectedEndTime`, `DailyCheckinReminderData.members[].scheduledWorkEndTime` 시그니처 확장 ③ `formatMorningCheckinStatus`/`formatNightlyCheckinStatus` end 받음 + `start~end` 표시 ④ `checkin_submitted` 메시지 헤드라인 `${name} : ${date} start~end` 형태 ⑤ morning-summary/reminder-22/reminder-20 SELECT에 `planned_end_time` 추가 + payload 매핑 ⑥ team-status/check-in notify 호출 시 expectedStartTime/expectedEndTime 전달 ⑦ `team/page.tsx` 그리드뷰/리스트뷰 둘 다 `card.start_time?.slice(0, 5)` 적용. 정책 자체 변경 없음 — 시간 표시 일관성. | Claude |
| 2026-05-18 | v1.27 | **운영 규칙 변경 — STG 환경 영구 미사용** (시간/보고 정책 자체 변경 없음, Task Board 머신 운영 결정). 사용자 명시: "STG는 사용 안 하는 거로 하자. 앞으로 stg 배포는 스킵해 크레딧 아깝다. 삭제하진 말고 그냥 방치." 배포 흐름은 **dev → main fast-forward 직진**이 default. stg 브랜치는 방치(merge·삭제 X). CLAUDE.md / AGENTS.md Task Board 상태 머신 §A·§C STG 행에 🚫 표식 + §E 첫 단축이 default로 박제. memory `feedback-skip-stg` 영구 기록. §E 필수 가드(PROD DB 마이그레이션 사전 점검 등)는 그대로 살아있음 — DEV에서만 검증되고 바로 PROD로 가므로 더더욱 중요. | Claude |
| 2026-05-18 | v1.26 | **야근 임계 정의 명확화 — ≥ 480분 → > 480분** — 사용자 명시: "8시간 이상이 아니라 초과로 가자". 정확히 8시간 근무(예: 9:00~18:00 + 점심 60분 = 실근무 480분)는 야근 표식 제외. 조치 — ① `morning-summary/route.ts:301` 비교 연산자 `>=` → `>`. ② `route.ts:196`/`types.ts:229`/`messages.ts:583` JSDoc·inline 주석 일괄 갱신. ③ 본 정책서·PRD "아침 요약 발송" 페이지 규칙·정책 섹션 야근 판정식 갱신. 임계값 480 자체는 동일. §E 단축 트리거 검토 별도. | Claude |
| 2026-05-18 | v1.25 | **morning-summary 야근 판정·표시 SoT 정정** — 사용자 보고: 아침 워크플로 카드의 "어제 퇴근 보고"에서 ⚠️ 야근 표식 및 "9:30~18:30 (00:00)" 형식의 시각 표시가 출근예정/퇴근예정 기반으로 계산됨. 근본 원인: 정책서 §2 시간 4종 분리(`actual_start_time`/`actual_end_time` = 실제 SoT) 이후에도 `/api/cron/morning-summary` 라우트가 legacy `start_time`/`end_time` 컬럼만 SELECT. `src/app/api/work-logs/route.ts:339-343` UPDATE 분기에서 legacy 컬럼이 보존(=출근예정/퇴근예정 의미)되므로 퇴근보고 수정 케이스에서 데이터 소스가 어긋남. 조치 — ① `morning-summary/route.ts:153` SELECT에 `actual_start_time, actual_end_time` 추가 + `pickActualTime()` helper로 actual 우선·legacy fallback. ② `messages.ts` `formatMorningWorklogStatus` 시그니처를 `string \| null` 허용 + 둘 다 NULL이면 `❌` 표시. ③ `computeActualMinutes` 호출 인자가 actual 기반으로 자동 교체. 정책 자체 변경 없음 — 야근 임계 8h(480분) 유지. 구현 보강. | Claude |
| 2026-05-21 | v1.33 | **캘린더 뷰 3종 명칭 표준화 + MY PAGE에 "일정관리" 탭 신설** — 사용자 즉석 지시: ① 구글캘린더 연동뷰(/calendar)를 MY PAGE 제출내역 다음에 "일정관리" 탭으로 임베드 (일반 구성원 진입점) ② /calendar 헤더 "본부 캘린더" → "일정관리" + 안내 문구 "해당 캘린더는 구글캘린더와 실시간 양방향 동기화 됩니다" ③ 캘린더 뷰 3종(MY PAGE 캘린더뷰 / 구글캘린더 연동뷰 /calendar / 구글캘린더 연동 어드민뷰 /admin/calendars) 명칭·경로·정의 정책 박제. 조치 — `src/app/calendar/page.tsx`를 `CalendarMatrixView({embedded})` named export + default wrapper로 분리(embedded=true 시 "← 홈" 링크 hide), 헤더 h1·subtitle 교체. `src/app/home/page.tsx` 메인 탭에 `'schedule'`('일정관리') 추가(RAW 다음) + dynamic import로 탭 클릭 시 `CalendarMatrixView embedded` 임베드. 정책서 §11.6 신설. DB 변경 없음. STG 영구 스킵 default. | Claude |
| 2026-05-21 | v1.32 | **출근완료/출근수정 알림 헤드라인 — 출근예정 → 실제출근 기반으로 변경** — 사용자 즉석 지시: "출근완료 혹은 출근 수정으로 알림이 발송될 때, 실제출근시간이 있다면 실제출근시간 → 퇴근예정시간으로 알림이 발송되게 해줘 (기존에는 출근예정시간 → 퇴근예정시간)". v1.28에서 `checkin_submitted` 헤드라인을 `근무시작 {출근예정}~{퇴근예정}`로 통일했으나, 실제출근 시각이 예정과 다를 때(지각/조기출근) 헤드라인이 예정값을 보여 혼란. 조치 — `messages.ts` `checkin_submitted` 빌더(v2 chips 경로 line 373 + legacy fallback line 403)의 start 우선순위를 `expectedStartTime → checkedInAt fallback`에서 **`checkedInAt(실제출근) 우선 → expectedStartTime fallback`**으로 뒤집음. 이 알림은 `/api/team-status/check-in`이 `checkedInAtIso`가 있을 때만 발송하므로 실제출근시간은 항상 존재 → 헤드라인 `근무시작 {실제출근}~{퇴근예정}`. end는 종전대로 `expectedEndTime`. `types.ts` `CheckinNotifyPayload.expectedStartTime` JSDoc 갱신. **morning-summary / 22시·20시 리마인더는 영향 없음** — 발송 시점에 실제출근이 없거나 예정 안내 목적이라 출근예정~퇴근예정 유지. DB 변경 없음. STG 영구 스킵 default. | Claude |
