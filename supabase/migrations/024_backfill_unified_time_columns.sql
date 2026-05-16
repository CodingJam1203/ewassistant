-- 024_backfill_unified_time_columns.sql
-- Stage 0-3: 정책서 시간 4종 분리 — 옛 데이터 backfill.
--
-- 목적:
--   Stage 0-1에서 추가한 4 컬럼(planned_start/end_time, actual_start/end_time)을
--   옛 row(stage 0-2 이전 INSERT)에 대해서도 채워서, read path가 신규 컬럼만 봐도
--   기존 표시와 동일한 결과를 내도록 보장한다.
--
-- 우선순위 (사용자 결정): existing > daily > submission
--   1) work_logs의 신규 컬럼이 이미 채워져 있으면 (Stage 0-2 write 결과) 보존.
--   2) NULL이면 daily_work_status (checked_in_at / checked_out_at, KST HH:mm)에서 가져옴.
--   3) 그래도 NULL이면 work_log_submissions에서 latest report_type 매칭 row의 시간을 가져옴.
--
-- 모델 결정 (사용자 명시):
--   - 분리 모델 (한 (user, date)에 여러 row 존재 가능) 그대로 유지.
--   - 신규 컬럼만 채움. UNIQUE 부여나 row 머지는 0-3에서 안 함.
--   - 같은 (user, date)의 모든 row가 같은 planned_*, actual_* 값을 갖게 됨
--     (mismatch는 verification 쿼리로 별도 확인).
--
-- 안전성:
--   - COALESCE 기반 — 기존 NULL만 채움. 이미 채워진 값은 안 건드림.
--   - 행 단위 UPDATE은 변경이 실제 발생할 때만 (no-op 방지 가드).
--   - DDL 없음 (ALTER 없음). 순수 DML.
--   - UNDO: 파일 하단 주석 참조.

WITH latest_check_in AS (
  SELECT DISTINCT ON (user_email, target_date)
    user_email,
    target_date AS leave_date,
    NULLIF(start_time, '')::time AS planned_start,
    NULLIF(end_time, '')::time   AS planned_end
  FROM public.work_log_submissions
  WHERE report_type IN ('check_in', 'check_in_update')
  ORDER BY user_email, target_date, submitted_at DESC
),
latest_check_out AS (
  SELECT DISTINCT ON (user_email, target_date)
    user_email,
    target_date AS leave_date,
    NULLIF(start_time, '')::time AS actual_start,
    NULLIF(end_time, '')::time   AS actual_end
  FROM public.work_log_submissions
  WHERE report_type IN ('check_out', 'check_out_update')
  ORDER BY user_email, target_date, submitted_at DESC
),
daily_src AS (
  SELECT
    user_email,
    work_date AS leave_date,
    (checked_in_at  AT TIME ZONE 'Asia/Seoul')::time AS daily_actual_start,
    (checked_out_at AT TIME ZONE 'Asia/Seoul')::time AS daily_actual_end
  FROM public.daily_work_status
),
sources AS (
  SELECT
    w.id,
    ci.planned_start,
    ci.planned_end,
    co.actual_start,
    co.actual_end,
    d.daily_actual_start,
    d.daily_actual_end
  FROM public.work_logs w
  LEFT JOIN latest_check_in  ci ON ci.user_email = w.user_email AND ci.leave_date = w.leave_date
  LEFT JOIN latest_check_out co ON co.user_email = w.user_email AND co.leave_date = w.leave_date
  LEFT JOIN daily_src        d  ON d.user_email  = w.user_email AND d.leave_date  = w.leave_date
)
UPDATE public.work_logs w
SET
  planned_start_time = COALESCE(w.planned_start_time, s.planned_start),
  planned_end_time   = COALESCE(w.planned_end_time,   s.planned_end),
  actual_start_time  = COALESCE(w.actual_start_time,  s.daily_actual_start, s.actual_start),
  actual_end_time    = COALESCE(w.actual_end_time,    s.daily_actual_end,   s.actual_end)
FROM sources s
WHERE w.id = s.id
  AND (
       (w.planned_start_time IS NULL AND s.planned_start IS NOT NULL)
    OR (w.planned_end_time   IS NULL AND s.planned_end   IS NOT NULL)
    OR (w.actual_start_time  IS NULL AND COALESCE(s.daily_actual_start, s.actual_start) IS NOT NULL)
    OR (w.actual_end_time    IS NULL AND COALESCE(s.daily_actual_end,   s.actual_end)   IS NOT NULL)
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- Verification queries (수동 실행, 결과만 확인)
-- ─────────────────────────────────────────────────────────────────────────────
--
-- [V1] backfill 커버리지 — 활성 row 중 4 컬럼이 각각 몇 개 채워졌는지
--   SELECT
--     COUNT(*) AS total_active,
--     COUNT(planned_start_time) AS with_planned_start,
--     COUNT(planned_end_time)   AS with_planned_end,
--     COUNT(actual_start_time)  AS with_actual_start,
--     COUNT(actual_end_time)    AS with_actual_end
--   FROM public.work_logs WHERE is_deleted = false;
--
-- [V2] mismatch — row 자체의 start_time/end_time vs planned_*/actual_* 충돌
--   SELECT id, user_email, leave_date, start_time, planned_start_time, end_time, planned_end_time
--   FROM public.work_logs
--   WHERE is_deleted = false
--     AND (
--          (planned_start_time IS NOT NULL AND start_time IS NOT NULL AND planned_start_time <> start_time)
--       OR (planned_end_time   IS NOT NULL AND end_time   IS NOT NULL AND planned_end_time   <> end_time)
--     )
--   ORDER BY leave_date DESC, user_email
--   LIMIT 200;
--
-- [V3] 다중 row mismatch — 같은 (user, date)에 row가 여러 개고 start_time이 다 다른 경우
--   SELECT user_email, leave_date,
--          COUNT(*) AS rows,
--          COUNT(DISTINCT start_time) AS distinct_starts,
--          COUNT(DISTINCT end_time)   AS distinct_ends
--   FROM public.work_logs WHERE is_deleted = false
--   GROUP BY user_email, leave_date
--   HAVING COUNT(*) > 1 AND (COUNT(DISTINCT start_time) > 1 OR COUNT(DISTINCT end_time) > 1)
--   ORDER BY rows DESC, leave_date DESC;
--
-- [V4] backfill 소스가 없어 4 컬럼 모두 NULL로 남은 row (backfill 누락 추적용)
--   SELECT id, user_email, leave_date, attendance_record_type
--   FROM public.work_logs
--   WHERE is_deleted = false
--     AND planned_start_time IS NULL AND planned_end_time IS NULL
--     AND actual_start_time  IS NULL AND actual_end_time   IS NULL;
--
-- ─────────────────────────────────────────────────────────────────────────────
-- UNDO (긴급시)
-- ─────────────────────────────────────────────────────────────────────────────
-- 주의: Stage 0-2 write path가 이미 라이브이므로 backfill 후 새로 들어온 row의
-- 4 컬럼 값도 같이 사라진다. UNDO는 backfill 직후에만 안전하다.
--
--   UPDATE public.work_logs
--   SET planned_start_time = NULL,
--       planned_end_time   = NULL,
--       actual_start_time  = NULL,
--       actual_end_time    = NULL;
