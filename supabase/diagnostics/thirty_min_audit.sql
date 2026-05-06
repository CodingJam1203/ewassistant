-- thirty_min_audit.sql
-- 비30분 row 진단 — 사용자 요청 항목 전부 비교 가능
--
-- Supabase SQL Editor에서 그대로 실행하면 됨. 보정 SQL이 아니라 SELECT 전용.
--
-- 출력 컬럼:
--   id, user_email, name, leave_date,
--   start_time, end_time, break_time,
--   leave_timeline, expected_leave_timeline,
--   break_auto_actual_minutes, break_auto_rounded_minutes,
--   break_manual_rounded_minutes, break_final_rounded_minutes,
--   actual_work_time,
--   actual_minutes, mod30,
--   leave_total_rounded (휴가 timeline의 roundedMinutes 합),
--   created_at, updated_at, is_deleted

-- ── 1. 비30분 actual_work_time row (전체 기간) ─────────────────────────
SELECT
  id, user_email, name, leave_date,
  start_time, end_time, break_time,
  leave_timeline, expected_leave_timeline,
  break_auto_actual_minutes, break_auto_rounded_minutes,
  break_manual_rounded_minutes, break_final_rounded_minutes,
  actual_work_time,
  (EXTRACT(EPOCH FROM actual_work_time)/60)::int AS actual_minutes,
  ((EXTRACT(EPOCH FROM actual_work_time)/60)::int % 30) AS mod30,
  (
    SELECT COALESCE(SUM((it->>'roundedMinutes')::int), 0)
    FROM jsonb_array_elements(COALESCE(leave_timeline, '[]'::jsonb)) it
    WHERE (it->>'roundedMinutes') ~ '^-?\d+$'
  ) AS leave_total_rounded,
  created_at, updated_at, is_deleted
FROM work_logs
WHERE is_deleted = false
  AND ((EXTRACT(EPOCH FROM actual_work_time)/60)::int % 30) <> 0
ORDER BY user_email, leave_date DESC;

-- ── 2. 사용자 요청 SQL — 5월 한 달치 비30분 row ────────────────────────
-- SELECT *
-- FROM work_logs
-- WHERE is_deleted = false
--   AND leave_date >= '2026-05-01'
--   AND leave_date <  '2026-06-01'
--   AND ((EXTRACT(EPOCH FROM actual_work_time)/60)::int % 30) <> 0;

-- ── 3. 비30분 row 카테고리 카운트 ──────────────────────────────────────
-- SELECT
--   COUNT(*) FILTER (WHERE ((EXTRACT(EPOCH FROM actual_work_time)/60)::int % 30) <> 0) AS bad_actual,
--   COUNT(*) FILTER (WHERE ((EXTRACT(EPOCH FROM break_time)/60)::int % 30) <> 0)      AS bad_break,
--   COUNT(*) FILTER (WHERE (COALESCE(break_auto_rounded_minutes,   0) % 30) <> 0)     AS bad_break_auto,
--   COUNT(*) FILTER (WHERE (COALESCE(break_manual_rounded_minutes, 0) % 30) <> 0)     AS bad_break_manual,
--   COUNT(*) FILTER (WHERE (COALESCE(break_final_rounded_minutes,  0) % 30) <> 0)     AS bad_break_final,
--   COUNT(*) FILTER (
--     WHERE EXISTS (
--       SELECT 1 FROM jsonb_array_elements(COALESCE(leave_timeline, '[]'::jsonb)) it
--       WHERE (it->>'roundedMinutes') ~ '^-?\d+$'
--         AND ((it->>'roundedMinutes')::int % 30) <> 0
--     )
--   ) AS bad_leave_rounded
-- FROM work_logs
-- WHERE is_deleted = false;

-- ── 4. 사용자별 누적 비30분 카운트 (탑10) ──────────────────────────────
-- SELECT user_email, name, COUNT(*) AS bad_rows
-- FROM work_logs
-- WHERE is_deleted = false
--   AND ((EXTRACT(EPOCH FROM actual_work_time)/60)::int % 30) <> 0
-- GROUP BY user_email, name
-- ORDER BY bad_rows DESC
-- LIMIT 10;
