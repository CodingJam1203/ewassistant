-- 본부 직속(팀 미배정) 인원 — 알림 라우팅용 notify_team 컬럼
--
-- 동기: 본부(division)에만 속하고 팀(team)이 없는 인원은 출/퇴근 보고가
-- (division, team, reportType) 라우팅 테이블에 매칭되지 않아 Teams 알림이 드롭된다.
--
-- 정책 (2026-05-22 사용자 결정):
--   - 조직 모델은 그대로 — 본부 직속은 team=NULL 유지 (org_teams row 추가 X, 가상 그룹).
--   - 알림만 admin이 인원별로 지정한 notify_team의 팀 채널로 라우팅한다.
--   - notify_team도 비어있으면 라우팅 skip + notification_logs에 SKIPPED 기록.
--   - notify_team은 팀명(TEXT) — user_profiles.team과 동일하게 이름 기반 연결.
--
-- 적용 대상: user_profiles + pre_approved_emails(사전등록 단계에서도 미리 지정 가능).

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS notify_team text;

COMMENT ON COLUMN user_profiles.notify_team IS
  '본부 직속(team 없음) 인원의 알림 라우팅 대상 팀명. team이 있으면 무시. admin이 지정.';

ALTER TABLE pre_approved_emails
  ADD COLUMN IF NOT EXISTS notify_team text;

COMMENT ON COLUMN pre_approved_emails.notify_team IS
  '본부 직속(team 없음) 인원의 알림 라우팅 대상 팀명. 사전등록 단계에서 미리 지정 가능.';
