-- 022_work_logs_user_date_indexes.sql
-- work_logs 테이블에 (user_email, expected_start_date) / (user_email, leave_date)
-- partial composite index 추가.
--
-- 배경:
--   /api/my/submission-status, /api/my/missed-checkout 등 본인 work_logs를
--   날짜 범위로 조회하는 핫패스가 인덱스 없이 풀스캔 → Vercel 30s 타임아웃 (504).
--
-- WHERE is_deleted = false 부분 인덱스:
--   - 활성 row만 인덱싱해서 인덱스 크기 ↓ 잠금 부담 ↓
--   - 삭제된 row 비율이 낮아도 효과적
--
-- CONCURRENTLY:
--   - 큰 테이블에서 ALTER 잠금 없이 인덱스 생성 (운영 중 안전)
--   - 단점: 트랜잭션 안에서 못 씀 → BEGIN/COMMIT 빼고 평문으로 작성

CREATE INDEX IF NOT EXISTS idx_work_logs_user_email_expected_start_date
    ON public.work_logs (user_email, expected_start_date)
    WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS idx_work_logs_user_email_leave_date
    ON public.work_logs (user_email, leave_date)
    WHERE is_deleted = false;

COMMENT ON INDEX public.idx_work_logs_user_email_expected_start_date IS
    '본인 출근보고 범위 조회용 (submission-status, missed-checkout 등 핫패스)';
COMMENT ON INDEX public.idx_work_logs_user_email_leave_date IS
    '본인 퇴근보고 범위 조회용 (submission-status 등 핫패스)';
