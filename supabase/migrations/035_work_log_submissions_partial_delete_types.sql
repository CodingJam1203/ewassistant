-- 035_work_log_submissions_partial_delete_types.sql
-- 2026-05-26: work_log_submissions.report_type CHECK 확장
--
-- partial delete 기능 추가 (work-logs/[id] DELETE ?scope=check_in|check_out)에 따라
-- 삭제 history를 work_log_submissions에 append-only 로그로 남기기 위해 3개 값 허용 추가:
--   - check_in_delete  : 출근보고만 partial delete
--   - check_out_delete : 퇴근보고만 partial delete
--   - work_log_delete  : row 전체 soft-delete (양쪽 다 비거나 ?scope 없이 호출)
--
-- 기존 데이터 영향 없음 (값 추가만). reversible.

ALTER TABLE work_log_submissions
  DROP CONSTRAINT IF EXISTS work_log_submissions_report_type_check;

ALTER TABLE work_log_submissions
  ADD CONSTRAINT work_log_submissions_report_type_check
  CHECK (report_type = ANY (ARRAY[
    'check_in'::text,
    'check_in_update'::text,
    'check_in_complete'::text,
    'check_out'::text,
    'check_out_update'::text,
    'check_in_delete'::text,
    'check_out_delete'::text,
    'work_log_delete'::text
  ]));
