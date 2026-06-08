-- v1.76 — 본인이 EW 미상신/오상신 처리 후 리더에게 해지요청한 시각.
-- NULL이면 미요청. 요청 1회만 허용 (DB 가드 + 클라 가드).
ALTER TABLE public.work_log_leader_reviews
  ADD COLUMN IF NOT EXISTS resolution_requested_at timestamp with time zone NULL;

COMMENT ON COLUMN public.work_log_leader_reviews.resolution_requested_at IS
  'v1.76: 본인이 EW 처리 완료 후 리더에게 해지요청 보낸 시각. NULL이면 미요청. 1회만 가능.';
