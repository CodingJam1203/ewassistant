-- ABC-217 Phase 3 — 본부별 alias 태그 매핑
--
-- 정책:
--   - iCal title 대괄호 안 토큰 매칭의 4단계: ATTENDEE 이메일 → 풀네임 → suffix 2글자 → alias.
--     기존 3단계는 사람 이름만 다뤘고, 그룹·파트 alias("[A파트]" 등)는 못 잡았음.
--   - 본부 단위 scope (division_id FK) — 같은 alias label이 본부마다 다른 멤버를 가리킬 수 있어 안전.
--   - admin이 alias_patterns·member_emails를 관리. write는 admin client(service role) 전용.
--   - 사용자(authenticated)는 read만 — 캘린더 뷰에서 매칭 결과 보기 위해.

-- ─── 1) org_tags ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS org_tags (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  division_id    uuid NOT NULL REFERENCES org_divisions(id) ON DELETE CASCADE,
  label          text NOT NULL,                  -- 사람이 보는 이름 (예: "A파트")
  alias_patterns text[] NOT NULL DEFAULT '{}',   -- title 대괄호 안 토큰과 case-sensitive exact match
  member_emails  text[] NOT NULL DEFAULT '{}',   -- 이 tag가 가리키는 user_profiles.email[] (lowercase)
  is_active      boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE org_tags IS '본부별 alias → 멤버 매핑. matchUsers의 풀네임/suffix 매칭 다음 단계.';
COMMENT ON COLUMN org_tags.alias_patterns IS 'title 대괄호 안 토큰과 case-sensitive exact match. 예: ["A파트","에이파트","A-파트"]';
COMMENT ON COLUMN org_tags.member_emails  IS 'tag가 expand하는 user_profiles.email[] — lowercase 권장 (매칭 시 lowercase 비교)';

CREATE INDEX IF NOT EXISTS idx_org_tags_division ON org_tags(division_id) WHERE is_active = true;
-- alias 검색은 보통 JS Map으로 처리되지만 향후 SQL ANY/contains 쿼리 대비 GIN
CREATE INDEX IF NOT EXISTS idx_org_tags_aliases  ON org_tags USING gin (alias_patterns);

-- ─── 2) updated_at 자동 갱신 trigger ──────────────────────────────────────────

CREATE OR REPLACE FUNCTION trg_org_tags_set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_org_tags_updated_at ON org_tags;
CREATE TRIGGER trg_org_tags_updated_at
  BEFORE UPDATE ON org_tags
  FOR EACH ROW
  EXECUTE FUNCTION trg_org_tags_set_updated_at();

-- ─── 3) RLS ─────────────────────────────────────────────────────────────────────

ALTER TABLE org_tags ENABLE ROW LEVEL SECURITY;

-- authenticated 사용자는 read만. write는 admin client(service role)로만.
CREATE POLICY "org_tags_select_authenticated" ON org_tags
  FOR SELECT USING (auth.role() = 'authenticated');
