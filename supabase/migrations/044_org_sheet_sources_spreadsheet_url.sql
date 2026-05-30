-- 044_org_sheet_sources_spreadsheet_url.sql
-- v1.61 (2026-05-30)
--
-- 정책 — 본부별 휴가 시트의 사용자 deep link용 URL.
-- LeaveReadOnlyNotice / CalendarDayDetailModal 안내 박스에서 사용자가 직접 시트를 열어
-- 영구 삭제하거나 수정할 수 있게 [캘린더 시트 열기 →] 링크 제공.
--
-- 사용처:
--   - 사용자 endpoint /api/my/sheet-source-url — 본부 매칭된 source의 spreadsheet_url 반환
--   - admin /admin/sheet-sources — source 등록/수정 시 URL 입력 필드
--
-- nullable — 등록 안 된 본부 / 시트 운영 안 하는 본부는 NULL.
-- 안내 박스는 URL이 있을 때만 deep link 노출 (없으면 안내 메시지만).

ALTER TABLE org_sheet_sources
  ADD COLUMN IF NOT EXISTS spreadsheet_url text;

COMMENT ON COLUMN org_sheet_sources.spreadsheet_url IS
  'v1.61: 본부 휴가 시트 deep link URL (https://docs.google.com/spreadsheets/...). 사용자 안내 박스의 [캘린더 시트 열기] 링크. nullable.';
