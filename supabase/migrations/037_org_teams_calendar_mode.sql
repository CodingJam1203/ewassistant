-- 037_org_teams_calendar_mode.sql
-- Phase B.1 — 팀별 캘린더 운영 방식 명시
--
-- 4가지 mode:
--   gcal_only        — Google Calendar 1:1 양방향 (현행 default, 대부분 팀)
--   gcal_plus_sheet  — GCal + 시트 read-only 합산 (Phase A의 sheet_source_id 매핑 팀)
--   sheet_only       — 시트만 SoT, GCal 미사용. 일정 등록 차단 + chip read-only
--   none             — 캘린더 기능 미사용 (신규 팀 default)
--
-- 기존 팀 backfill 정책 (현행 동작 보존 — Mode 1 zero impact):
--   1) sheet_source_id IS NOT NULL → 'gcal_plus_sheet' (Phase A에서 시트 매핑한 팀들)
--   2) team_id 매핑된 active org_calendars 있음 → 'gcal_only'
--   3) division_id로만 매핑된 본부 캘린더 있음 → 'gcal_only'
--   4) 그 외 → 'none' default 유지

-- ─── 1) calendar_mode 컬럼 추가 ─────────────────────────────────────────────

ALTER TABLE org_teams
  ADD COLUMN IF NOT EXISTS calendar_mode text NOT NULL DEFAULT 'none'
  CHECK (calendar_mode IN ('gcal_only', 'gcal_plus_sheet', 'sheet_only', 'none'));

COMMENT ON COLUMN org_teams.calendar_mode IS 'Phase B: 팀의 캘린더 운영 방식. gcal_only/gcal_plus_sheet/sheet_only/none. 변경은 admin only. 신규 팀은 none default — 명시 활성 필요.';

CREATE INDEX IF NOT EXISTS idx_org_teams_calendar_mode ON org_teams(calendar_mode) WHERE calendar_mode != 'none';

-- ─── 2) backfill — 현행 동작 보존 ────────────────────────────────────────────

-- (1) sheet_source_id 매핑된 팀 → gcal_plus_sheet
UPDATE org_teams
   SET calendar_mode = 'gcal_plus_sheet'
 WHERE sheet_source_id IS NOT NULL;

-- (2) team_id로 직접 매핑된 active org_calendars 있는 팀 → gcal_only
--     (이미 gcal_plus_sheet로 set된 팀은 건너뜀)
UPDATE org_teams t
   SET calendar_mode = 'gcal_only'
 WHERE t.calendar_mode = 'none'
   AND EXISTS (
     SELECT 1 FROM org_calendars c
      WHERE c.team_id = t.id
        AND c.is_active = true
   );

-- (3) team_id NULL + division_id로만 매핑된 본부 단위 active org_calendars 있는 팀 → gcal_only
--     본부 회의/생일 캘린더가 본부 전체에 적용되니까 그 본부의 모든 팀이 gcal_only
UPDATE org_teams t
   SET calendar_mode = 'gcal_only'
 WHERE t.calendar_mode = 'none'
   AND EXISTS (
     SELECT 1 FROM org_calendars c
      WHERE c.division_id = t.division_id
        AND c.team_id IS NULL
        AND c.is_active = true
   );

-- (4) 나머지는 default 'none' 그대로 — 신규 팀 또는 캘린더 미사용 팀
