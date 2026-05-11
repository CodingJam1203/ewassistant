-- 020_work_sub_type.sql
-- 근무유형 5종 확장을 위한 work_sub_type 컬럼 추가.
--
-- 배경: 기존 work_type_code(1=기본 / 2=간주 / 3=공휴일) 3종을 5종으로 세분화하면서
-- EW 시트 호환성을 위해 code는 그대로 두고 sub_type만 추가하는 방식.
--
-- sub_type 값:
--   NULL          = 평일 근무 (기본/간주). work_type_code 1 또는 2.
--   'saturday'    = 토요일 근무. work_type_code 3.
--   'sun_optional'= 일요일/공휴일 선택 근무. work_type_code 3. EW 복사 텍스트에 '/ 선택적 휴일 근무 - 토요일 상신' 추가.
--   'sun_required'= 일요일/공휴일 필수 근무. work_type_code 3. EW 복사 텍스트에 '/ 필수적 휴일 근무 - 일요일 상신' 추가.

BEGIN;

ALTER TABLE public.work_logs
    ADD COLUMN IF NOT EXISTS work_sub_type TEXT;

ALTER TABLE public.work_logs
    DROP CONSTRAINT IF EXISTS work_logs_work_sub_type_check;

ALTER TABLE public.work_logs
    ADD CONSTRAINT work_logs_work_sub_type_check
        CHECK (work_sub_type IS NULL OR work_sub_type IN ('saturday', 'sun_optional', 'sun_required'));

COMMENT ON COLUMN public.work_logs.work_sub_type IS
    '공휴일 근무 sub-type. NULL=평일, saturday=토요일, sun_optional=일요일/공휴일 선택, sun_required=일요일/공휴일 필수';

-- 동일 컬럼을 work_log_submissions(append-only log)에도 추가 — 이력 추적용
ALTER TABLE public.work_log_submissions
    ADD COLUMN IF NOT EXISTS work_sub_type TEXT;

ALTER TABLE public.work_log_submissions
    DROP CONSTRAINT IF EXISTS work_log_submissions_work_sub_type_check;

ALTER TABLE public.work_log_submissions
    ADD CONSTRAINT work_log_submissions_work_sub_type_check
        CHECK (work_sub_type IS NULL OR work_sub_type IN ('saturday', 'sun_optional', 'sun_required'));

COMMIT;
