-- 023_work_logs_time_4cols.sql
-- Stage 0-1: 정책서 "시간 4종 분리" foundation.
--
-- work_logs에 다음 4개 컬럼을 nullable로 추가한다:
--   planned_start_time  (출근예정)
--   planned_end_time    (퇴근예정)
--   actual_start_time   (실제출근, SoT)
--   actual_end_time     (실제퇴근, SoT)
--
-- 정책:
--   - (user, leave_date) UNIQUE 단일 row 모델로 가는 첫 단계.
--   - 기존 start_time/end_time(NOT NULL)은 호환을 위해 그대로 유지.
--     Stage 0-2(write 호환), 0-3(backfill+dedupe+UNIQUE), 0-4(read 전환) 후
--     별도 마이그레이션에서 deprecate 한다.
--
-- 안전성:
--   - 모두 nullable, default 없음, CHECK 없음 → 기존 INSERT/UPDATE 무영향.
--   - 옛 row는 NULL로 남고 0-3 backfill에서 채워짐.

ALTER TABLE public.work_logs
  ADD COLUMN IF NOT EXISTS planned_start_time time without time zone,
  ADD COLUMN IF NOT EXISTS planned_end_time   time without time zone,
  ADD COLUMN IF NOT EXISTS actual_start_time  time without time zone,
  ADD COLUMN IF NOT EXISTS actual_end_time    time without time zone;

COMMENT ON COLUMN public.work_logs.planned_start_time IS '출근예정 (정책서 4종 분리). nullable. Stage 0-3에서 backfill.';
COMMENT ON COLUMN public.work_logs.planned_end_time   IS '퇴근예정 (정책서 4종 분리). nullable. Stage 0-3에서 backfill.';
COMMENT ON COLUMN public.work_logs.actual_start_time  IS '실제출근 SoT (정책서 4종 분리). NULL=미체크인. Stage 0-2부터 write 동시 갱신.';
COMMENT ON COLUMN public.work_logs.actual_end_time    IS '실제퇴근 SoT (정책서 4종 분리). NULL=미체크아웃. Stage 0-2부터 write 동시 갱신.';
