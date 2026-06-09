-- v1.77 — 본부별 외부 캘린더 모드 (read-only) 플래그.
-- true면 휴가는 NPM SoT, 시트 출처 일정은 시트로 redirect, GCal 일정은 기존 양방향 유지.
-- 등록 모달에서 휴가 속성 선택 차단.
ALTER TABLE public.org_divisions
  ADD COLUMN IF NOT EXISTS read_only_calendar boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.org_divisions.read_only_calendar IS
  'v1.77: true면 외부 캘린더 모드. 휴가는 NPM 상신·시트 SoT, 시트 출처 일정 chip 클릭 시 시트로 redirect. GCal 일정은 양방향 유지.';
