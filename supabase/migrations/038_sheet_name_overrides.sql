-- 038_sheet_name_overrides.sql
-- Phase B.6 — 동명이인 처리용 명시 매핑 + 매칭 검증 보조
--
-- 정책:
--   - 본부 내 동명이인 발견 시(N≥2 user_profiles.display_name 매칭) 자동 매칭 보류 — 사고 방지
--   - 운영자가 이 테이블에 (sheet_source_id, sheet_name) → user_id 매핑 명시 추가하면 그 매핑 적용
--   - 매칭 시 우선순위: 1) override 있으면 그것 → 2) 본부 내 자동 매칭 N=1 → 3) N=0 또는 N≥2면 보류
--
-- normalizeName 정책 (코드 단):
--   - 시트 entry.name과 user_profiles.display_name 양쪽 다 normalizeName 적용 후 매칭
--   - 공백·전각공백 제거, NFC 정규화, 양쪽 trim, 소문자 (한글은 영향 X)
--   - 단 override의 sheet_name은 운영자가 시트의 raw 텍스트 그대로 입력 (시각적 확인 용이)
--     → lookup 시 sheet_name도 normalizeName 적용해서 비교

CREATE TABLE IF NOT EXISTS sheet_name_overrides (
  sheet_source_id uuid NOT NULL REFERENCES org_sheet_sources(id) ON DELETE CASCADE,
  sheet_name      text NOT NULL,
  user_id         uuid NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  note            text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (sheet_source_id, sheet_name)
);

COMMENT ON TABLE  sheet_name_overrides IS 'Phase B.6: 본부 내 동명이인 발견 시 운영자가 (sheet 이름 → user_profile) 명시 매핑.';
COMMENT ON COLUMN sheet_name_overrides.sheet_name IS '시트 entry.name 원본 (운영자가 시각 확인 용이하게 raw 텍스트 그대로). lookup 시 normalizeName 적용.';
COMMENT ON COLUMN sheet_name_overrides.user_id IS 'override 대상 user_profile. 본부와 무관하게 직접 지정 가능 (운영자 책임).';
COMMENT ON COLUMN sheet_name_overrides.note IS '운영자 메모 (예: "마케팅팀 김재민 vs 임팩트팀 김재민 구분").';

CREATE INDEX IF NOT EXISTS idx_sheet_name_overrides_user ON sheet_name_overrides(user_id);

-- updated_at 자동 갱신
CREATE OR REPLACE FUNCTION trg_sheet_name_overrides_set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sheet_name_overrides_updated_at ON sheet_name_overrides;
CREATE TRIGGER trg_sheet_name_overrides_updated_at
  BEFORE UPDATE ON sheet_name_overrides
  FOR EACH ROW
  EXECUTE FUNCTION trg_sheet_name_overrides_set_updated_at();

-- RLS — admin write(service_role bypass), authenticated read
ALTER TABLE sheet_name_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sheet_name_overrides_select_authenticated" ON sheet_name_overrides
  FOR SELECT USING (auth.role() = 'authenticated');
