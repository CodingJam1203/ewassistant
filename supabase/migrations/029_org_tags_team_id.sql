-- ABC-217 Phase 3 후속 — org_tags에 team_id scope 추가
--
-- 동기: 같은 alias label("A파트", "B파트" 등)이 본부 안에서도 팀마다 다른 멤버를 가리키는
-- 케이스 다수 발견 (HR임팩트본부의 비즈팀·컬컴·마이스팀 각자 A파트/B파트 존재).
-- division scope만으로는 같은 alias가 양쪽 멤버를 모두 expand해버려 잘못된 매칭 발생.
--
-- 정책:
--   - team_id NULL이면 본부 공용 alias — 매칭 시 그 본부의 모든 캘린더에 적용
--   - team_id 지정이면 그 팀 캘린더(혹은 같은 팀 멤버 이벤트)에만 적용
--   - matchUsers는 이벤트의 cal.team_id에 맞는 alias 우선, 없으면 division 공용 fallback

ALTER TABLE org_tags
  ADD COLUMN IF NOT EXISTS team_id uuid REFERENCES org_teams(id) ON DELETE CASCADE;

COMMENT ON COLUMN org_tags.team_id IS 'NULL이면 본부 공용 alias. 값이 있으면 그 팀의 캘린더에서만 매칭.';

-- 팀 scope index — 캘린더 sync 시 그 team의 alias 빠르게 조회
CREATE INDEX IF NOT EXISTS idx_org_tags_team
  ON org_tags(team_id)
  WHERE is_active = true AND team_id IS NOT NULL;
