-- 036_org_sheet_sources.sql
-- Phase A — 스프레드시트 source 본부 단위 모델
--
-- 정책 (사용자 합의 2026-05-26):
--   - Apps Script PUSH가 주력 (시트 측 time trigger 매시간 → /api/calendar/write-cache).
--   - 본부별 시트 source = org_sheet_sources row 1건.
--   - 팀 → source 매핑은 org_teams.sheet_source_id (nullable, 0..1).
--   - leave_calendar_cache 스키마는 안 건드림. 키 형식만 확장:
--       legacy 'calendar:YYYY-MM-DD'  vs  신규 'calendar:<source_id>:YYYY-MM-DD'
--       기존 caller(work-hours, my/submission-status, calendar-warm)는 read 함수가
--       두 형식 다 인식해서 변경 0 — Mode 1 zero impact 보장.
--   - 신규 mode-aware lookup만 source_id 기반으로 분기 read.
--
-- Mode 1 (현행 GCal-only 팀)에 미치는 영향:
--   - org_teams.sheet_source_id가 NULL이라 lookup 분기 skip.
--   - leave_calendar_cache는 모든 source 합쳐 read하는 기존 함수 그대로 동작.
--   - 따라서 schema·동작·UI 모두 zero impact.

-- ─── 1) org_sheet_sources — 본부별 시트 source 등록 ────────────────────────────

CREATE TABLE IF NOT EXISTS org_sheet_sources (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  division_id     uuid NOT NULL REFERENCES org_divisions(id) ON DELETE CASCADE,
  label           text NOT NULL,                  -- 표시명 (예: "HR마케팅본부 휴가시트")
  department_key  text NOT NULL,                  -- Apps Script payload의 departments[키] (보통 본부명)
  is_active       boolean NOT NULL DEFAULT true,
  last_push_at    timestamptz,                    -- 마지막 push 수신 시각
  last_push_error text,                           -- 마지막 push 처리 실패 메시지 (NULL이면 정상)
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (division_id, department_key)
);

COMMENT ON TABLE  org_sheet_sources IS 'Phase A: 본부별 외부 시트 source. Apps Script PUSH가 leave_calendar_cache에 source_id 키로 적재.';
COMMENT ON COLUMN org_sheet_sources.department_key IS 'Apps Script payload {departments:{<key>:[...]}}의 key. 보통 본부명과 동일하나 시트 운영 명칭이 다를 수도 있어 분리.';
COMMENT ON COLUMN org_sheet_sources.last_push_at IS 'write-cache가 이 source 매칭 row를 upsert한 마지막 시각. admin UI 표시용.';
COMMENT ON COLUMN org_sheet_sources.last_push_error IS 'write-cache 처리 중 source-specific 실패 발생 시 메시지. 정상이면 NULL.';

CREATE INDEX IF NOT EXISTS idx_org_sheet_sources_division ON org_sheet_sources(division_id) WHERE is_active = true;

-- ─── 2) updated_at 자동 갱신 trigger ─────────────────────────────────────────

CREATE OR REPLACE FUNCTION trg_org_sheet_sources_set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_org_sheet_sources_updated_at ON org_sheet_sources;
CREATE TRIGGER trg_org_sheet_sources_updated_at
  BEFORE UPDATE ON org_sheet_sources
  FOR EACH ROW
  EXECUTE FUNCTION trg_org_sheet_sources_set_updated_at();

-- ─── 3) org_teams.sheet_source_id — 팀 → source 매핑 (0..1) ──────────────────

ALTER TABLE org_teams
  ADD COLUMN IF NOT EXISTS sheet_source_id uuid REFERENCES org_sheet_sources(id) ON DELETE SET NULL;

COMMENT ON COLUMN org_teams.sheet_source_id IS 'Phase A: 시트 source 매핑. NULL이면 시트 sync 미사용(현행 Mode 1과 동일 동작).';

CREATE INDEX IF NOT EXISTS idx_org_teams_sheet_source ON org_teams(sheet_source_id) WHERE sheet_source_id IS NOT NULL;

-- ─── 4) RLS ─────────────────────────────────────────────────────────────────

ALTER TABLE org_sheet_sources ENABLE ROW LEVEL SECURITY;

-- 인증 사용자 read 허용 (admin UI + lookup이 read).
-- write는 admin client(service_role)만 — 별도 policy 없이 service_role bypass.
CREATE POLICY "org_sheet_sources_select_authenticated" ON org_sheet_sources
  FOR SELECT USING (auth.role() = 'authenticated');

-- ─── 5) leave_calendar_cache — schema 변경 없음 ─────────────────────────────
--
-- 의도적으로 schema 안 건드림. 키 형식만 read 함수 레벨에서 확장.
--
-- 마이그레이션 시 기존 row( key='calendar:YYYY-MM-DD' )는 그대로 유지.
-- Apps Script 다음 push부터 신규 형식( key='calendar:<source_id>:YYYY-MM-DD' )이
-- 추가로 쌓이고, write-cache가 본부명 → source_id resolve해서 분할 upsert.
-- 6시간 TTL 후 legacy row 자연 만료. 별도 cleanup 마이그 추후.
