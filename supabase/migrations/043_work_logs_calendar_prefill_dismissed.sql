-- 043_work_logs_calendar_prefill_dismissed.sql
-- v1.60.7 (2026-05-30)
--
-- 정책 — Spreadsheet 휴가 prefill 단방향 한계 극복 마커.
--
-- 배경:
--   - Spreadsheet → leave_calendar_cache → 모달 prefill (source='calendar')로 work_logs.leave_timeline에 박힘.
--   - 사용자가 안내 박스에서 [일정 삭제]를 누르면 work_logs.leave_timeline에서만 빠짐.
--   - Spreadsheet는 단방향이라 원본은 그대로 → 다음 모달 진입 시 또 prefill로 들어옴.
--   - 사용자 입장에서 "지운 게 또 나타남"으로 보임.
--
-- 해결:
--   - work_logs에 calendar_prefill_dismissed boolean 컬럼 추가.
--   - 사용자가 calendar source 항목을 [일정 삭제]로 빼면 같은 PATCH에서 dismissed=true 같이 set.
--   - team-status/expected-timeline API가 dismissed=true면 leaveTimeline 응답을 빈 배열로 줘서
--     모달 prefill 효과 제거.
--   - manual source 항목은 dismissed와 무관 — 그대로 표시.
--
-- 한계:
--   - dismissed=true 해제는 별도 UI 없음 (v1.61에서 검토). Spreadsheet 원본 수정 + 사용자가
--     수동으로 dismissed=false 마커 해제 필요.
--   - 사용자가 다시 manual 또는 휴가 등록 모달로 새 휴가 박으면 dismissed=true 상태여도 leave_timeline에
--     반영됨. dismissed는 calendar prefill만 차단.

ALTER TABLE work_logs
  ADD COLUMN IF NOT EXISTS calendar_prefill_dismissed boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN work_logs.calendar_prefill_dismissed IS
  'v1.60.7: Spreadsheet 휴가 prefill 무시 마커. 사용자가 calendar source 항목을 [일정 삭제]로 빼면 true. true면 모달 prefill 시 leaveTimeline 응답 비움.';
