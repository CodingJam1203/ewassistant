-- 005_work_location_timeline.sql
-- 오늘 실제 근무장소 흐름을 저장하는 JSONB 컬럼 추가
--
-- 출근보고 → 근무지 변경 → 퇴근보고로 이어지는 하루의 실제 위치 흐름.
-- expected_work_location_timeline (다음 출근 예정용)과는 용도가 다름.
--
-- 형식 예:
--   [{"kind":"work_location","type":"office","label":"사무실","customLabel":null,"startTime":"09:00"},
--    {"kind":"work_location","type":"remote","label":"재택","customLabel":null,"startTime":"14:00"},
--    {"kind":"checkout","startTime":"18:00"}]
--
-- 출근보고 직후/근무지 변경 중에는 마지막 항목이 'expected_checkout',
-- 퇴근보고 제출 시 마지막 항목이 'checkout'으로 확정됨.

ALTER TABLE public.work_logs
    ADD COLUMN IF NOT EXISTS work_location_timeline JSONB;

COMMENT ON COLUMN public.work_logs.work_location_timeline IS
    '오늘 실제 근무장소 타임라인. 출근보고/근무지변경/퇴근보고로 누적됨. 마지막 항목 kind는 expected_checkout(진행 중) 또는 checkout(퇴근보고 완료).';

-- 빠른 필터링용 부분 인덱스
CREATE INDEX IF NOT EXISTS idx_work_logs_has_actual_timeline
    ON public.work_logs ((work_location_timeline IS NOT NULL))
    WHERE work_location_timeline IS NOT NULL;
