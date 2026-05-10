-- 017_submissions_check_in_complete.sql
-- work_log_submissions.report_type CHECK 제약 확장 — 'check_in_complete' 추가.
--
-- 새 정책 (한 일자 한 row 모델):
--   check_in           : 출근보고 작성 (예정값 등록)
--   check_in_update    : 출근보고 수정 (예정값 변경)
--   check_in_complete  : 출근 완료 (실제 출근시간 확정 — 신규)
--   check_out          : 퇴근보고 작성
--   check_out_update   : 퇴근보고 수정

BEGIN;

ALTER TABLE public.work_log_submissions
    DROP CONSTRAINT IF EXISTS work_log_submissions_report_type_check;

ALTER TABLE public.work_log_submissions
    ADD CONSTRAINT work_log_submissions_report_type_check
    CHECK (report_type IN (
        'check_in',
        'check_in_update',
        'check_in_complete',
        'check_out',
        'check_out_update'
    ));

COMMIT;
