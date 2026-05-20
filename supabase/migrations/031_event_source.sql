-- ABC-217 Phase 4.2 — org_calendar_events에 N-Click 작성 메타 추가
--
-- 정책:
--   - source 'google' (기본 — 외부 iCal fetch로 들어온 row) / 'nclick' (N-Click에서 직접 작성)
--   - source='nclick' 인 row는 우리가 Google API로 push한 결과. 이후 다음 iCal sync에서
--     같은 google_event_id 로 들어와 upsert idempotent.
--   - sync cleanup 시 nclick_pushed_at 후 60초 grace period — Google iCal feed가 새 이벤트를
--     아직 export 못 한 race window 차단 (sync.ts 별도 갱신).
--   - rrule은 RRULE 본문 (예: 'FREQ=WEEKLY;BYDAY=MO'). Phase 4.4에서 사용.

ALTER TABLE org_calendar_events
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'google'
    CHECK (source IN ('google', 'nclick'));

ALTER TABLE org_calendar_events
  ADD COLUMN IF NOT EXISTS created_by_user_id uuid REFERENCES user_profiles(id) ON DELETE SET NULL;

ALTER TABLE org_calendar_events
  ADD COLUMN IF NOT EXISTS rrule text;

ALTER TABLE org_calendar_events
  ADD COLUMN IF NOT EXISTS nclick_pushed_at timestamptz;

COMMENT ON COLUMN org_calendar_events.source IS 'google: iCal fetch / nclick: 사용자가 N-Click에서 작성 후 Google API push';
COMMENT ON COLUMN org_calendar_events.created_by_user_id IS 'source=nclick일 때 작성자. user_profiles 삭제 시 SET NULL.';
COMMENT ON COLUMN org_calendar_events.rrule IS 'iCalendar RRULE 본문. null이면 단일 이벤트.';
COMMENT ON COLUMN org_calendar_events.nclick_pushed_at IS 'Google API에 push 성공 시각. sync cleanup grace 기준.';

CREATE INDEX IF NOT EXISTS idx_event_source_nclick
  ON org_calendar_events(nclick_pushed_at DESC)
  WHERE source = 'nclick';
