-- ABC-217 구글캘린더 연동 개선 — Phase 1
-- 본부별 Google Calendar ID 등록 + 이벤트 DB 캐시
--
-- 정책:
--   - admin이 /admin/calendars 에서 Google Calendar ID 등록 (공개 캘린더 또는 비공개 iCal URL)
--   - cron(/api/cron/calendar-sync)이 30분 단위로 iCal fetch → org_calendar_events upsert
--   - 사용자 캘린더 페이지(/calendar)는 org_calendar_events read만 (Google API 호출 X)
--   - matched_user_emails 컬럼: title parse + 참석자 매칭으로 자동 매핑
--   - 회의 이벤트는 개인 화면(MY PAGE)에도 노출 — 휴가는 leave_calendar_cache 기존 패턴 그대로

-- ─── 1) org_calendars — 본부별 캘린더 등록 ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS org_calendars (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  division_id     uuid NOT NULL REFERENCES org_divisions(id) ON DELETE CASCADE,
  team_id         uuid REFERENCES org_teams(id) ON DELETE CASCADE,  -- nullable: 본부 전체용
  google_calendar_id text NOT NULL,
  calendar_type   text NOT NULL CHECK (calendar_type IN ('meeting', 'vacation', 'birthday', 'other')),
  label           text NOT NULL,                  -- 표시명 (예: "마이스팀 회의")
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (division_id, google_calendar_id)
);

COMMENT ON TABLE org_calendars IS '본부별 Google Calendar ID 등록 (Phase 1, iCal 공개 fetch)';
COMMENT ON COLUMN org_calendars.team_id IS 'null이면 본부 전체용 (본부 회의·생일)';
COMMENT ON COLUMN org_calendars.calendar_type IS 'meeting · vacation · birthday · other';

CREATE INDEX IF NOT EXISTS idx_org_calendars_division   ON org_calendars(division_id) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_org_calendars_team       ON org_calendars(team_id)     WHERE is_active = true AND team_id IS NOT NULL;

-- ─── 2) org_calendar_events — iCal fetch 결과 캐시 ─────────────────────────────

CREATE TABLE IF NOT EXISTS org_calendar_events (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_calendar_id     uuid NOT NULL REFERENCES org_calendars(id) ON DELETE CASCADE,
  google_event_id     text NOT NULL,
  title               text,
  description         text,
  location            text,
  start_at            timestamptz NOT NULL,
  end_at              timestamptz NOT NULL,
  is_all_day          boolean NOT NULL DEFAULT false,
  attendee_emails     text[],                     -- iCal ATTENDEE에서 추출
  matched_user_emails text[],                     -- N-Click user_profiles.email 매칭 결과
  inferred_type       text,                       -- meeting/vacation/birthday — calendar_type + title parse
  raw_uid             text,                       -- iCal UID (디버깅)
  synced_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_calendar_id, google_event_id)
);

COMMENT ON TABLE org_calendar_events IS 'cron이 iCal fetch 후 채우는 캐시. 사용자 페이지는 이 테이블만 read.';

-- 캘린더 뷰 range 쿼리 최적화 (from-to 기간 조회)
CREATE INDEX IF NOT EXISTS idx_org_calendar_events_range ON org_calendar_events(start_at, end_at);
-- 캘린더별 events 조회
CREATE INDEX IF NOT EXISTS idx_org_calendar_events_cal   ON org_calendar_events(org_calendar_id, start_at);
-- 매칭된 사용자별 events (개인 화면용 GIN — text[] 멤버십 검색)
CREATE INDEX IF NOT EXISTS idx_org_calendar_events_user  ON org_calendar_events USING gin (matched_user_emails);

-- ─── 3) updated_at 자동 갱신 trigger (org_calendars) ──────────────────────────

CREATE OR REPLACE FUNCTION trg_org_calendars_set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_org_calendars_updated_at ON org_calendars;
CREATE TRIGGER trg_org_calendars_updated_at
  BEFORE UPDATE ON org_calendars
  FOR EACH ROW
  EXECUTE FUNCTION trg_org_calendars_set_updated_at();

-- ─── 4) RLS ─────────────────────────────────────────────────────────────────────

ALTER TABLE org_calendars        ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_calendar_events  ENABLE ROW LEVEL SECURITY;

-- org_calendars: admin write, 인증 사용자 read (캘린더 뷰가 division 필터로 사용)
CREATE POLICY "org_calendars_select_authenticated" ON org_calendars
  FOR SELECT USING (auth.role() = 'authenticated');

-- (write는 admin client만 사용 — RLS policy 없이 service role로 처리)

-- org_calendar_events: 인증 사용자 read. write는 cron(admin client) 전용.
CREATE POLICY "org_calendar_events_select_authenticated" ON org_calendar_events
  FOR SELECT USING (auth.role() = 'authenticated');
