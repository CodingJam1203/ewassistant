-- 012_teams_routing.sql
-- Teams 알림 라우팅 테이블을 코드 하드코딩 → DB 관리로 이전
--
-- 정책:
--   admin만 select/insert/update/delete
--   server-side는 service-role(createAdminClient)로 조회
--   (department, team_name, report_type) 3개로 unique → 동일 키는 1건만

BEGIN;

CREATE TABLE IF NOT EXISTS teams_routing (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  department      TEXT         NOT NULL,
  team_name       TEXT         NOT NULL,
  report_type     TEXT         NOT NULL CHECK (report_type IN ('출근보고', '퇴근보고')),
  team_id         TEXT         NOT NULL,
  channel_id      TEXT         NOT NULL,
  message_id      TEXT         NOT NULL,
  is_active       BOOLEAN      NOT NULL DEFAULT true,
  notes           TEXT,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_by      UUID         REFERENCES auth.users(id),
  UNIQUE (department, team_name, report_type)
);

CREATE INDEX IF NOT EXISTS teams_routing_lookup_idx
  ON teams_routing (department, team_name, report_type)
  WHERE is_active = true;

ALTER TABLE teams_routing ENABLE ROW LEVEL SECURITY;

-- admin만 모든 작업 허용
DROP POLICY IF EXISTS teams_routing_admin_all ON teams_routing;
CREATE POLICY teams_routing_admin_all ON teams_routing
  FOR ALL
  USING (
    EXISTS (SELECT 1 FROM user_profiles
            WHERE user_profiles.id = auth.uid()
              AND user_profiles.role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM user_profiles
            WHERE user_profiles.id = auth.uid()
              AND user_profiles.role = 'admin')
  );

-- updated_at 자동 갱신
CREATE OR REPLACE FUNCTION teams_routing_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS teams_routing_updated_at_trg ON teams_routing;
CREATE TRIGGER teams_routing_updated_at_trg
  BEFORE UPDATE ON teams_routing
  FOR EACH ROW EXECUTE FUNCTION teams_routing_set_updated_at();

-- ─── seed: 기존 코드의 16개 라우트 ─────────────────────────────────────────
INSERT INTO teams_routing (department, team_name, report_type, team_id, channel_id, message_id)
VALUES
  -- HR임팩트본부 / 출근보고 (channel: 19:d70449b5...)
  ('HR임팩트본부', '디자인크리에이티브3파트', '출근보고',
   'c2dcd308-5ef9-4c2f-a038-2db41410180e',
   '19:d70449b5ffec46338662a94f06d1e9be@thread.tacv2', '1767335177747'),
  ('HR임팩트본부', '컬처커뮤니케이션팀', '출근보고',
   'c2dcd308-5ef9-4c2f-a038-2db41410180e',
   '19:d70449b5ffec46338662a94f06d1e9be@thread.tacv2', '1767335241492'),
  ('HR임팩트본부', 'HR비즈니스팀', '출근보고',
   'c2dcd308-5ef9-4c2f-a038-2db41410180e',
   '19:d70449b5ffec46338662a94f06d1e9be@thread.tacv2', '1767335269415'),
  ('HR임팩트본부', '마이스팀', '출근보고',
   'c2dcd308-5ef9-4c2f-a038-2db41410180e',
   '19:d70449b5ffec46338662a94f06d1e9be@thread.tacv2', '1767335293381'),

  -- HR임팩트본부 / 퇴근보고 (channel: 19:565876b6...)
  ('HR임팩트본부', '디자인크리에이티브3파트', '퇴근보고',
   'c2dcd308-5ef9-4c2f-a038-2db41410180e',
   '19:565876b6b37a4c93bf0ca3d744f07c2b@thread.tacv2', '1774263829550'),
  ('HR임팩트본부', '컬처커뮤니케이션팀', '퇴근보고',
   'c2dcd308-5ef9-4c2f-a038-2db41410180e',
   '19:565876b6b37a4c93bf0ca3d744f07c2b@thread.tacv2', '1774263959914'),
  ('HR임팩트본부', 'HR비즈니스팀', '퇴근보고',
   'c2dcd308-5ef9-4c2f-a038-2db41410180e',
   '19:565876b6b37a4c93bf0ca3d744f07c2b@thread.tacv2', '1774264072699'),
  ('HR임팩트본부', '마이스팀', '퇴근보고',
   'c2dcd308-5ef9-4c2f-a038-2db41410180e',
   '19:565876b6b37a4c93bf0ca3d744f07c2b@thread.tacv2', '1774264121746'),

  -- HR마케팅본부 / 출근보고 (channel: 19:553ec7e1...)
  ('HR마케팅본부', '디자인크리에이티브2파트', '출근보고',
   'd6cf3fb4-4410-4563-9a16-18e15022fe64',
   '19:553ec7e116f44d73904d867cd1b90555@thread.tacv2', '1766558901940'),
  ('HR마케팅본부', 'HR마케팅1팀', '출근보고',
   'd6cf3fb4-4410-4563-9a16-18e15022fe64',
   '19:553ec7e116f44d73904d867cd1b90555@thread.tacv2', '1766558952328'),
  ('HR마케팅본부', 'HR마케팅2팀', '출근보고',
   'd6cf3fb4-4410-4563-9a16-18e15022fe64',
   '19:553ec7e116f44d73904d867cd1b90555@thread.tacv2', '1766559040022'),
  ('HR마케팅본부', 'HR마케팅3팀', '출근보고',
   'd6cf3fb4-4410-4563-9a16-18e15022fe64',
   '19:553ec7e116f44d73904d867cd1b90555@thread.tacv2', '1766559055148'),

  -- HR마케팅본부 / 퇴근보고 (channel: 19:63dcfe99...)
  ('HR마케팅본부', '디자인크리에이티브2파트', '퇴근보고',
   'd6cf3fb4-4410-4563-9a16-18e15022fe64',
   '19:63dcfe997cc546be87707acb83a0da80@thread.tacv2', '1766559649568'),
  ('HR마케팅본부', 'HR마케팅1팀', '퇴근보고',
   'd6cf3fb4-4410-4563-9a16-18e15022fe64',
   '19:63dcfe997cc546be87707acb83a0da80@thread.tacv2', '1766559655046'),
  ('HR마케팅본부', 'HR마케팅2팀', '퇴근보고',
   'd6cf3fb4-4410-4563-9a16-18e15022fe64',
   '19:63dcfe997cc546be87707acb83a0da80@thread.tacv2', '1766559660840'),
  ('HR마케팅본부', 'HR마케팅3팀', '퇴근보고',
   'd6cf3fb4-4410-4563-9a16-18e15022fe64',
   '19:63dcfe997cc546be87707acb83a0da80@thread.tacv2', '1766559666784')
ON CONFLICT (department, team_name, report_type) DO NOTHING;

COMMIT;
