-- 004_work_location_timeline.sql
-- 출근보고용 근무장소 타임라인을 저장하는 JSONB 컬럼 추가
--
-- 기존 expected_work_location, expected_work_time, expected_start_date 컬럼은 유지하고,
-- 신규 입력은 timeline에 주저장 + 첫 work_location.label과 expected_checkout.startTime을
-- 기존 컬럼에 미러링하여 legacy 쿼리/리포트 호환성을 보존합니다.

ALTER TABLE public.work_logs
    ADD COLUMN IF NOT EXISTS expected_work_location_timeline JSONB;

COMMENT ON COLUMN public.work_logs.expected_work_location_timeline IS
    '출근보고 근무장소 타임라인. [{kind:"work_location",type,label,customLabel,startTime}, ..., {kind:"expected_checkout",startTime}]';

-- 타임라인 존재 여부 빠른 필터링용 부분 인덱스 (선택적)
CREATE INDEX IF NOT EXISTS idx_work_logs_has_timeline
    ON public.work_logs ((expected_work_location_timeline IS NOT NULL))
    WHERE expected_work_location_timeline IS NOT NULL;
