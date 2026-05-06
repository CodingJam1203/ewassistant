-- 011_thirty_min_policy.sql
-- 30분 단위 정책 강제 — DB 레벨 CHECK constraint
--
-- 정책:
--   actual_work_time, break_time : 30분 배수 (NULL 허용)
--   break_*_rounded_minutes      : 30분 배수 (NULL 허용)
--
-- 적용 순서:
--   1) 새 row에만 즉시 강제하기 위해 CHECK constraint를 NOT VALID로 추가
--   2) 별도 보정 마이그레이션(011b)으로 legacy 데이터 일괄 round-30
--   3) 보정 완료 후 ALTER TABLE … VALIDATE CONSTRAINT 로 전수 검증
--
-- ┌─────────────────────────────────────────────────────────────────────┐
-- │ 사전 점검 — 비30분 데이터 카운트                                       │
-- │ (실행만 하고 바로 ROLLBACK해도 됨, 분석용)                              │
-- └─────────────────────────────────────────────────────────────────────┘
-- SELECT
--   COUNT(*) AS total_bad,
--   COUNT(*) FILTER (
--     WHERE (EXTRACT(EPOCH FROM actual_work_time)/60)::int % 30 <> 0
--   ) AS bad_actual,
--   COUNT(*) FILTER (
--     WHERE (EXTRACT(EPOCH FROM break_time)/60)::int % 30 <> 0
--   ) AS bad_break,
--   COUNT(*) FILTER (
--     WHERE COALESCE(break_auto_rounded_minutes, 0) % 30 <> 0
--   ) AS bad_break_auto,
--   COUNT(*) FILTER (
--     WHERE COALESCE(break_manual_rounded_minutes, 0) % 30 <> 0
--   ) AS bad_break_manual,
--   COUNT(*) FILTER (
--     WHERE COALESCE(break_final_rounded_minutes, 0) % 30 <> 0
--   ) AS bad_break_final
-- FROM work_logs
-- WHERE is_deleted = false;

BEGIN;

-- actual_work_time : interval 형태. 분 단위로 변환 후 30 mod 0 검증
ALTER TABLE work_logs
  ADD CONSTRAINT work_logs_actual_work_time_30min_chk
  CHECK (
    actual_work_time IS NULL
    OR (EXTRACT(EPOCH FROM actual_work_time)::bigint % 1800) = 0
  ) NOT VALID;

-- break_time : interval. 1800초(=30분) 배수
ALTER TABLE work_logs
  ADD CONSTRAINT work_logs_break_time_30min_chk
  CHECK (
    break_time IS NULL
    OR (EXTRACT(EPOCH FROM break_time)::bigint % 1800) = 0
  ) NOT VALID;

-- break_auto_rounded_minutes / break_manual_rounded_minutes / break_final_rounded_minutes
ALTER TABLE work_logs
  ADD CONSTRAINT work_logs_break_auto_rounded_30min_chk
  CHECK (
    break_auto_rounded_minutes IS NULL OR (break_auto_rounded_minutes % 30) = 0
  ) NOT VALID;

ALTER TABLE work_logs
  ADD CONSTRAINT work_logs_break_manual_rounded_30min_chk
  CHECK (
    break_manual_rounded_minutes IS NULL OR (break_manual_rounded_minutes % 30) = 0
  ) NOT VALID;

ALTER TABLE work_logs
  ADD CONSTRAINT work_logs_break_final_rounded_30min_chk
  CHECK (
    break_final_rounded_minutes IS NULL OR (break_final_rounded_minutes % 30) = 0
  ) NOT VALID;

COMMIT;

-- ┌─────────────────────────────────────────────────────────────────────┐
-- │ 다음 단계 (별도 트랜잭션):                                              │
-- │   1) 011b_fix_thirty_min.sql 실행 (legacy 데이터 round-30 보정)         │
-- │   2) 보정 완료 후 아래 5개 VALIDATE 실행                                │
-- │      → 그래도 위반 row가 있으면 어떤 row인지 ERROR로 노출됨            │
-- └─────────────────────────────────────────────────────────────────────┘
-- ALTER TABLE work_logs VALIDATE CONSTRAINT work_logs_actual_work_time_30min_chk;
-- ALTER TABLE work_logs VALIDATE CONSTRAINT work_logs_break_time_30min_chk;
-- ALTER TABLE work_logs VALIDATE CONSTRAINT work_logs_break_auto_rounded_30min_chk;
-- ALTER TABLE work_logs VALIDATE CONSTRAINT work_logs_break_manual_rounded_30min_chk;
-- ALTER TABLE work_logs VALIDATE CONSTRAINT work_logs_break_final_rounded_30min_chk;
