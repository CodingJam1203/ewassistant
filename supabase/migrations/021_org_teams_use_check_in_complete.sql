-- 팀별 "출근 완료" 단계 사용 여부.
--
-- TRUE (기본): 현재 동작 유지. 출근보고 → 별도 [출근 완료] 버튼 → checked_in_at 기록.
-- FALSE: 출근보고 제출 시점에 자동으로 checked_in_at = expected_work_time 설정.
--        별도 [출근 완료] 단계 없음. 지각하면 사용자가 직접 출근보고 수정.
--
-- 기존 데이터 호환: 모든 팀이 TRUE로 시작 → 기존 동작 그대로.

ALTER TABLE org_teams
  ADD COLUMN IF NOT EXISTS use_check_in_complete BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN org_teams.use_check_in_complete IS
  '출근보고 후 별도 [출근 완료] 버튼 사용 여부. FALSE면 출근보고 자체가 출근 처리.';
