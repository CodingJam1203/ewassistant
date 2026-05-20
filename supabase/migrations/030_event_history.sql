-- ABC-217 Phase 4.1 — N-Click 발 일정 변경 audit log
--
-- 정책:
--   - N-Click /api/calendar/events (Phase 4.2 신규)에서 create/update/delete 가 일어나면 1줄 INSERT.
--   - Google측 직접 변경(또는 우리 iCal sync로 추가/갱신/삭제)은 audit X — 이건 N-Click 변경 흔적용.
--   - actor_email은 user_profiles snapshot이라 user_profiles 삭제 후에도 누가 변경했는지 추적 가능.
--   - delete 후에도 event_id로 history 조회 가능하도록 FK 의도적으로 안 걸음.

CREATE TABLE IF NOT EXISTS org_calendar_event_history (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        uuid NOT NULL,                       -- org_calendar_events.id (FK X — delete 후 추적)
  org_calendar_id uuid NOT NULL,
  action          text NOT NULL CHECK (action IN ('create','update','delete')),
  actor_user_id   uuid REFERENCES user_profiles(id) ON DELETE SET NULL,
  actor_email     text NOT NULL,                       -- user_profiles 삭제돼도 흔적 남도록 snapshot
  snapshot        jsonb NOT NULL,                      -- 변경 후 row 전체 (title/start/end/aliases/members 등)
  prev_snapshot   jsonb,                               -- update 시 변경 전 값 (diff 계산용)
  changed_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE org_calendar_event_history IS 'N-Click 발 일정 변경 audit log. Google측 직접 변경은 기록 X.';

CREATE INDEX IF NOT EXISTS idx_event_history_event ON org_calendar_event_history(event_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_event_history_actor ON org_calendar_event_history(actor_user_id, changed_at DESC) WHERE actor_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_event_history_calendar ON org_calendar_event_history(org_calendar_id, changed_at DESC);

ALTER TABLE org_calendar_event_history ENABLE ROW LEVEL SECURITY;

-- authenticated 사용자 read만 (audit 조회). write는 service role(admin client) 전용.
CREATE POLICY "event_history_select_authenticated" ON org_calendar_event_history
  FOR SELECT USING (auth.role() = 'authenticated');
