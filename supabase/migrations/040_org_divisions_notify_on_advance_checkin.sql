-- 040_org_divisions_notify_on_advance_checkin.sql
-- 2026-05-27 (v1.50): 본부별 사전등록 알림 정책 플래그.
--
-- 정책 (사용자 결정 2026-05-27):
--   - planned_*가 처음 등록되는 모든 시점(당일/D+1/미래 무관)에 Teams 알림 발송할지
--     본부 단위 토글. true면 'advance_checkin_submitted' 알림 발송.
--   - default false → 기존 본부는 동작 변화 0 (회귀 위험 0).
--   - 출근완료(checkin_submitted) 알림은 그대로 별개로 발송됨.

ALTER TABLE org_divisions
  ADD COLUMN IF NOT EXISTS notify_on_advance_checkin boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN org_divisions.notify_on_advance_checkin IS
  '본부별 사전등록 알림 정책 (v1.50, 2026-05-27). true면 사용자가 planned_*를 처음 등록한 시점에 Teams 사전등록 알림 발송 (advance_checkin_submitted). 출근완료 알림은 그대로 별개로 발송됨.';
