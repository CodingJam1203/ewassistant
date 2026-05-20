-- ABC-217 Phase 4.7 — occurrence expand sync 지원
--
-- 정책:
--   - sync 소스를 iCal feed → Google API events.list({ singleEvents: true })로 전환.
--   - RRULE 반복 이벤트도 occurrence별 row 1개로 저장 → 매트릭스/Agenda에 매 occurrence 노출.
--   - 각 occurrence row의 google_event_id는 Google이 준 plain id (events.update/delete에 직접 사용 가능).
--   - recurring instance인 경우 recurring_event_id에 master id를 채워 식별.
--   - rrule 컬럼은 모든 instance row에 master의 RRULE 본문을 동일하게 복사 (master는 별도 row 아님).

ALTER TABLE org_calendar_events
  ADD COLUMN IF NOT EXISTS recurring_event_id text;

COMMENT ON COLUMN org_calendar_events.recurring_event_id IS
  'Google API의 recurringEventId. null이면 단일 이벤트, 값 있으면 그 master id (이 row는 occurrence).';

-- recurring instance 빠른 조회 (Phase 4.8 occurrence별 수정·삭제 시)
CREATE INDEX IF NOT EXISTS idx_event_recurring
  ON org_calendar_events(recurring_event_id)
  WHERE recurring_event_id IS NOT NULL;
