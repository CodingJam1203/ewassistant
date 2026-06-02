-- v1.74 (Phase 4 확장): work_log 없는 일자에도 leader_review 박을 수 있게.
-- 사용자 요청: 매트릭스에서 보고 안 한 날도 "미상신"으로 표시할 수 있어야 함.
--
-- 변경:
--   1. target_user_email + target_date 컬럼 추가 (가상 review 식별 키)
--   2. 기존 row backfill: work_log_id로 work_logs 조회해서 채움
--   3. work_log_id NULL 허용 (가상 review는 work_log 없음)
--   4. UNIQUE 제약 변경: (work_log_id) → (target_user_email, target_date)
--   5. NEW: target index

-- Step 1: 컬럼 추가 (nullable로 일단 추가)
ALTER TABLE public.work_log_leader_reviews
  ADD COLUMN IF NOT EXISTS target_user_email TEXT,
  ADD COLUMN IF NOT EXISTS target_date DATE;

-- Step 2: 기존 row backfill — work_log_id가 있는 행을 work_logs join해서 채움
UPDATE public.work_log_leader_reviews r
SET target_user_email = w.user_email,
    target_date = w.leave_date
FROM public.work_logs w
WHERE r.work_log_id = w.id
  AND (r.target_user_email IS NULL OR r.target_date IS NULL);

-- Step 3: work_log_id NULL 허용 + 새 컬럼 NOT NULL 강제
ALTER TABLE public.work_log_leader_reviews
  ALTER COLUMN work_log_id DROP NOT NULL,
  ALTER COLUMN target_user_email SET NOT NULL,
  ALTER COLUMN target_date SET NOT NULL;

-- Step 4: UNIQUE 제약 변경
ALTER TABLE public.work_log_leader_reviews DROP CONSTRAINT IF EXISTS work_log_leader_reviews_work_log_id_key;
ALTER TABLE public.work_log_leader_reviews ADD CONSTRAINT work_log_leader_reviews_target_unique UNIQUE (target_user_email, target_date);

-- Step 5: index
CREATE INDEX IF NOT EXISTS idx_leader_reviews_target ON public.work_log_leader_reviews(target_user_email, target_date);

COMMENT ON COLUMN public.work_log_leader_reviews.target_user_email IS
  'v1.74: 대상자 이메일 (가상 review 식별 키). work_log_id가 있는 케이스도 같이 채워짐.';
COMMENT ON COLUMN public.work_log_leader_reviews.target_date IS
  'v1.74: 대상 일자. UNIQUE(target_user_email, target_date)로 한 사용자×일자당 1 review만.';
