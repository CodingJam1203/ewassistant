-- work_logs (user_email, leave_date) 단일 row 제약 — Stage 0~7 통합 모델의 DB 레벨 보장.
-- 정책 SoT — docs/policies/time-and-report-policy.md §2.2 / §12 D2 결정에 따른 추가.
--
-- 배경:
--   023에서 4 시간 컬럼을 추가하고 단일 (user_email, leave_date) row 모델로 통합했으나
--   응용서버 레벨 UPSERT 로직만 존재하고 DB 제약은 부재한 상태였음.
--   동시 제출 race condition 하에서 같은 (user, date) 에 다중 row 생성 가능성 존재.
--
-- 조치:
--   is_deleted=false 인 행에 한해 (user_email, leave_date) UNIQUE 강제 (partial unique index).
--   논리 삭제된 행(is_deleted=true)은 제외 — 어드민 복원 시나리오 대비.
--
-- 적용 전 점검:
--   같은 (user_email, leave_date) 에 활성 행이 2개 이상 있으면 인덱스 생성 실패.
--   아래 사전 점검 쿼리로 confirm 후 적용.

-- ────────────────────────────────────────────────────────────────
-- [STEP 1] 사전 점검 — 중복 활성 행 있는지 확인 (수동 실행)
-- ────────────────────────────────────────────────────────────────
-- 다음 쿼리를 먼저 실행하고 결과 0행이면 [STEP 2] 진행, 행이 있으면 수동 정리 후 진행.
--
-- SELECT user_email, leave_date, COUNT(*) AS dup_count
-- FROM work_logs
-- WHERE is_deleted = false
-- GROUP BY user_email, leave_date
-- HAVING COUNT(*) > 1;

-- ────────────────────────────────────────────────────────────────
-- [STEP 2] partial unique index 생성
-- ────────────────────────────────────────────────────────────────

CREATE UNIQUE INDEX IF NOT EXISTS work_logs_user_date_active_unique
ON public.work_logs (user_email, leave_date)
WHERE is_deleted = false;

COMMENT ON INDEX public.work_logs_user_date_active_unique IS
'단일 (user_email, leave_date) row 모델 보장 — is_deleted=false 행에 한해 적용. 정책 SoT: docs/policies/time-and-report-policy.md §2.2';
