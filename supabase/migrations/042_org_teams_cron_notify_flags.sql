-- 042_org_teams_cron_notify_flags.sql
-- 2026-05-27 (v1.51): 팀별 cron 알림 ON/OFF 토글.
--
-- 정책 (사용자 결정 2026-05-27):
--   - 3개 cron 정기 알림(morning-summary 07시 / reminder-20 20시 / reminder-22 22시)을
--     팀 단위로 ON/OFF 가능하게.
--   - default true — 기존 동작 보존(회귀 0).
--   - 본부 직속(team=NULL) 인원은 notify_team의 effective team 그룹에 합류하므로
--     그 팀의 플래그에 자동으로 따라감 (별도 컬럼 필요 X).
--
-- cron 라우트가 group iteration 시 플래그 false면 그 팀만 skip.

ALTER TABLE org_teams
  ADD COLUMN IF NOT EXISTS notify_morning_07  boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS notify_reminder_20 boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS notify_reminder_22 boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN org_teams.notify_morning_07  IS '07시 아침 요약(morning-summary) 알림 ON/OFF (v1.51, 2026-05-27). default true.';
COMMENT ON COLUMN org_teams.notify_reminder_20 IS '20시 리마인더(reminder-20) 알림 ON/OFF (v1.51, 2026-05-27). default true.';
COMMENT ON COLUMN org_teams.notify_reminder_22 IS '22시 리마인더(reminder-22) 알림 ON/OFF (v1.51, 2026-05-27). default true.';
