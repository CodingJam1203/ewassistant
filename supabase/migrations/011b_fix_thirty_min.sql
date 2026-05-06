-- 011b_fix_thirty_min.sql
-- 30분 단위 정책 — legacy 비30분 데이터 일괄 보정
--
-- 정책:
--   비30분 값을 가장 가까운 30분으로 round (예: 62 → 60, 232 → 240)
--   모드 변경 원하면 ROUND() → CEIL() / FLOOR()로 교체.
--
-- 안전 권장 절차:
--   1) 먼저 〔DRY-RUN 섹션〕 SELECT만 실행해서 영향 row를 검토
--   2) 별도 백업 (pg_dump 또는 work_logs_backup_011b 테이블 생성)
--   3) BEGIN / 본 UPDATE 실행 / 결과 확인 / COMMIT 또는 ROLLBACK

-- ┌─────────────────────────────────────────────────────────────────────┐
-- │ DRY-RUN 1 — 영향받는 row 미리보기                                      │
-- └─────────────────────────────────────────────────────────────────────┘
-- SELECT
--   id, user_email, leave_date, created_at, updated_at,
--   start_time, end_time,
--   actual_work_time AS old_actual,
--   make_interval(mins => ROUND((EXTRACT(EPOCH FROM actual_work_time)/60)::numeric / 30) * 30 ) AS new_actual,
--   break_time AS old_break,
--   make_interval(mins => ROUND((EXTRACT(EPOCH FROM break_time)/60)::numeric / 30) * 30 ) AS new_break,
--   break_auto_rounded_minutes  AS old_break_auto,
--   ROUND(break_auto_rounded_minutes  / 30.0) * 30 AS new_break_auto,
--   break_manual_rounded_minutes AS old_break_manual,
--   ROUND(break_manual_rounded_minutes / 30.0) * 30 AS new_break_manual,
--   break_final_rounded_minutes AS old_break_final,
--   ROUND(break_final_rounded_minutes / 30.0) * 30 AS new_break_final,
--   leave_timeline
-- FROM work_logs
-- WHERE is_deleted = false
--   AND (
--        ((EXTRACT(EPOCH FROM actual_work_time)/60)::int % 30) <> 0
--     OR ((EXTRACT(EPOCH FROM break_time)/60)::int % 30) <> 0
--     OR (COALESCE(break_auto_rounded_minutes,   0) % 30) <> 0
--     OR (COALESCE(break_manual_rounded_minutes, 0) % 30) <> 0
--     OR (COALESCE(break_final_rounded_minutes,  0) % 30) <> 0
--   )
-- ORDER BY user_email, leave_date;

-- ┌─────────────────────────────────────────────────────────────────────┐
-- │ DRY-RUN 2 — 사용자 요청 SQL (5월)                                       │
-- └─────────────────────────────────────────────────────────────────────┘
-- SELECT
--   id, user_email, name, leave_date, created_at, updated_at,
--   start_time, end_time, break_time, leave_timeline,
--   break_auto_rounded_minutes, break_manual_rounded_minutes, break_final_rounded_minutes,
--   actual_work_time,
--   (EXTRACT(EPOCH FROM actual_work_time)/60)::int AS actual_minutes,
--   (EXTRACT(EPOCH FROM actual_work_time)/60)::int % 30 AS mod30
-- FROM work_logs
-- WHERE is_deleted = false
--   AND leave_date >= '2026-05-01'
--   AND leave_date <  '2026-06-01'
--   AND ((EXTRACT(EPOCH FROM actual_work_time)/60)::int % 30) <> 0
-- ORDER BY user_email, leave_date;


-- ┌─────────────────────────────────────────────────────────────────────┐
-- │ APPLY — 실제 보정 (BEGIN/COMMIT 안에서 실행 권장)                       │
-- └─────────────────────────────────────────────────────────────────────┘

BEGIN;

-- (선택) 백업 테이블에 영향받는 row 스냅샷
CREATE TABLE IF NOT EXISTS work_logs_backup_011b AS
SELECT * FROM work_logs WHERE 1 = 0;

INSERT INTO work_logs_backup_011b
SELECT * FROM work_logs
WHERE is_deleted = false
  AND (
       ((EXTRACT(EPOCH FROM actual_work_time)/60)::int % 30) <> 0
    OR ((EXTRACT(EPOCH FROM break_time)/60)::int % 30) <> 0
    OR (COALESCE(break_auto_rounded_minutes,   0) % 30) <> 0
    OR (COALESCE(break_manual_rounded_minutes, 0) % 30) <> 0
    OR (COALESCE(break_final_rounded_minutes,  0) % 30) <> 0
  );

-- 1) actual_work_time : interval → 30분 round
UPDATE work_logs
SET actual_work_time = make_interval(
      mins => (ROUND((EXTRACT(EPOCH FROM actual_work_time)/60)::numeric / 30) * 30)::int
    )
WHERE actual_work_time IS NOT NULL
  AND ((EXTRACT(EPOCH FROM actual_work_time)/60)::int % 30) <> 0;

-- 2) break_time : interval → 30분 round
UPDATE work_logs
SET break_time = make_interval(
      mins => (ROUND((EXTRACT(EPOCH FROM break_time)/60)::numeric / 30) * 30)::int
    )
WHERE break_time IS NOT NULL
  AND ((EXTRACT(EPOCH FROM break_time)/60)::int % 30) <> 0;

-- 3) break_auto_rounded_minutes : int → 30분 round
UPDATE work_logs
SET break_auto_rounded_minutes = ROUND(break_auto_rounded_minutes / 30.0) * 30
WHERE break_auto_rounded_minutes IS NOT NULL
  AND (break_auto_rounded_minutes % 30) <> 0;

-- 4) break_manual_rounded_minutes
UPDATE work_logs
SET break_manual_rounded_minutes = ROUND(break_manual_rounded_minutes / 30.0) * 30
WHERE break_manual_rounded_minutes IS NOT NULL
  AND (break_manual_rounded_minutes % 30) <> 0;

-- 5) break_final_rounded_minutes
UPDATE work_logs
SET break_final_rounded_minutes = ROUND(break_final_rounded_minutes / 30.0) * 30
WHERE break_final_rounded_minutes IS NOT NULL
  AND (break_final_rounded_minutes % 30) <> 0;

-- 6) leave_timeline.roundedMinutes 배열 항목별 round
--    JSONB 배열이므로 각 element를 풀어 roundedMinutes만 round 후 재집계.
WITH expanded AS (
  SELECT
    wl.id,
    jsonb_agg(
      CASE
        WHEN (item->>'roundedMinutes') ~ '^-?\d+$'
             AND ((item->>'roundedMinutes')::int % 30) <> 0
        THEN jsonb_set(
               item,
               '{roundedMinutes}',
               to_jsonb((ROUND((item->>'roundedMinutes')::numeric / 30) * 30)::int)
             )
        ELSE item
      END
      ORDER BY ord
    ) AS new_timeline
  FROM work_logs wl, jsonb_array_elements(wl.leave_timeline) WITH ORDINALITY arr(item, ord)
  WHERE wl.leave_timeline IS NOT NULL
    AND jsonb_typeof(wl.leave_timeline) = 'array'
  GROUP BY wl.id
)
UPDATE work_logs
SET leave_timeline = expanded.new_timeline
FROM expanded
WHERE work_logs.id = expanded.id
  AND work_logs.leave_timeline IS DISTINCT FROM expanded.new_timeline;

-- (검증) 보정 후 비30분 row 개수 — 0이어야 함
-- SELECT COUNT(*) FROM work_logs
-- WHERE is_deleted = false
--   AND (
--        ((EXTRACT(EPOCH FROM actual_work_time)/60)::int % 30) <> 0
--     OR ((EXTRACT(EPOCH FROM break_time)/60)::int % 30) <> 0
--     OR (COALESCE(break_auto_rounded_minutes,   0) % 30) <> 0
--     OR (COALESCE(break_manual_rounded_minutes, 0) % 30) <> 0
--     OR (COALESCE(break_final_rounded_minutes,  0) % 30) <> 0
--   );

COMMIT;

-- 보정 완료 확인 후 011의 NOT VALID constraint를 정식 VALIDATE로 승격
-- ALTER TABLE work_logs VALIDATE CONSTRAINT work_logs_actual_work_time_30min_chk;
-- ALTER TABLE work_logs VALIDATE CONSTRAINT work_logs_break_time_30min_chk;
-- ALTER TABLE work_logs VALIDATE CONSTRAINT work_logs_break_auto_rounded_30min_chk;
-- ALTER TABLE work_logs VALIDATE CONSTRAINT work_logs_break_manual_rounded_30min_chk;
-- ALTER TABLE work_logs VALIDATE CONSTRAINT work_logs_break_final_rounded_30min_chk;
