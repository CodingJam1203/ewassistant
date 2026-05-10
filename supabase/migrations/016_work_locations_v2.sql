-- 016_work_locations_v2.sql
-- 근무장소를 시간과 분리된 "순서형 칩 배열"로 재정의.
--
-- ───── 배경 ─────
-- 기존 work_location_timeline / expected_work_location_timeline은 장소+시작시간을
-- 한 항목에 묶은 구조였음. 시간은 출근시간/퇴근(예정)시간 필드로 별도 관리하는 것이
-- 사용자 멘탈 모델과 자연스러우므로, 신규 컬럼으로 분리.
--
-- ───── 신규 컬럼 ─────
-- planned_work_locations  jsonb  : 출근보고 시점의 예정 장소 배열 (chips)
-- actual_work_locations   jsonb  : 퇴근보고 시점의 실제 장소 배열 (NULL 허용 = 예정과 동일)
--
-- ───── 타입 ─────
-- chip = { kind: 'office' | 'remote' | 'field' | 'custom', customLabel?: string }
-- locations = chip[]
--
-- ───── 호환성 정책 ─────
-- 1) 기존 work_location / expected_work_location 단일 문자열 컬럼은 mirror로 유지
--    → 신규 입력 시 첫 chip의 라벨을 mirror (Apps Script / 외부 시스템 호환).
-- 2) 기존 work_location_timeline / expected_work_location_timeline JSONB는 read-only 보존.
--    → 더 이상 신규 입력에서 갱신하지 않음, 표시 fallback 체인에만 사용.
-- 3) 표시 chain: actual_work_locations ?? planned_work_locations
--                ?? legacy(timeline) ?? [legacy 단일 문자열]
--
-- ───── 백필 ─────
-- 기존 work_logs의 timeline에서 work_location 항목들의 라벨만 추출해 신규 컬럼에 채움.
-- timeline이 NULL이면 단일 문자열을 1-element 배열로.

BEGIN;

-- ─── 1. 컬럼 추가 ────────────────────────────────────────────────
ALTER TABLE public.work_logs
    ADD COLUMN IF NOT EXISTS planned_work_locations JSONB,
    ADD COLUMN IF NOT EXISTS actual_work_locations  JSONB;

COMMENT ON COLUMN public.work_logs.planned_work_locations IS
    '출근보고 시점의 예정 근무장소 배열. 시간 정보 없는 chips: [{kind, customLabel?}, ...]';
COMMENT ON COLUMN public.work_logs.actual_work_locations IS
    '퇴근보고 시점의 실제 근무장소 배열. NULL = 예정과 동일 (planned_work_locations로 표시).';

-- ─── 2. 부분 인덱스 (NULL 아님 빠른 필터) ────────────────────────
CREATE INDEX IF NOT EXISTS idx_work_logs_has_planned_locations
    ON public.work_logs ((planned_work_locations IS NOT NULL))
    WHERE planned_work_locations IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_work_logs_has_actual_locations
    ON public.work_logs ((actual_work_locations IS NOT NULL))
    WHERE actual_work_locations IS NOT NULL;

-- ─── 3. work_log_submissions에도 동일한 컬럼 (스냅샷) ────────────
ALTER TABLE public.work_log_submissions
    ADD COLUMN IF NOT EXISTS planned_work_locations JSONB,
    ADD COLUMN IF NOT EXISTS actual_work_locations  JSONB;

COMMENT ON COLUMN public.work_log_submissions.planned_work_locations IS
    '제출 시점의 예정 근무장소 배열 (출근보고 영역).';
COMMENT ON COLUMN public.work_log_submissions.actual_work_locations IS
    '제출 시점의 실제 근무장소 배열 (퇴근보고 영역). NULL = 예정과 동일.';

COMMIT;

-- ─── 4. 백필 ─────────────────────────────────────────────────────
-- 4a) Korean label → kind 매핑 함수 (idempotent)
CREATE OR REPLACE FUNCTION pg_temp.korean_to_kind(label text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE trim(label)
        WHEN '사무실' THEN 'office'
        WHEN '재택'   THEN 'remote'
        WHEN '외근'   THEN 'field'
        ELSE NULL
    END
$$;

-- 4b) 기존 timeline jsonb → chips array
--   work_location 항목들만 추출, kind/customLabel 형식으로 변환.
--   알려지지 않은 라벨은 custom + customLabel.
CREATE OR REPLACE FUNCTION pg_temp.timeline_to_chips(tl jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
    item jsonb;
    chip jsonb;
    result jsonb := '[]'::jsonb;
    item_kind text;
    item_label text;
    item_custom text;
    mapped_kind text;
BEGIN
    IF tl IS NULL OR jsonb_typeof(tl) <> 'array' THEN
        RETURN NULL;
    END IF;

    FOR item IN SELECT * FROM jsonb_array_elements(tl) LOOP
        IF item->>'kind' = 'work_location' THEN
            item_kind   := item->>'type';
            item_label  := item->>'label';
            item_custom := item->>'customLabel';

            -- type 직접 매칭 우선
            IF item_kind IN ('office', 'remote', 'field') THEN
                chip := jsonb_build_object('kind', item_kind);
            ELSIF item_kind = 'custom' THEN
                chip := jsonb_build_object(
                    'kind', 'custom',
                    'customLabel', COALESCE(NULLIF(trim(item_custom), ''), trim(item_label))
                );
            ELSE
                -- type 없으면 한글 라벨로 매핑 시도
                mapped_kind := pg_temp.korean_to_kind(COALESCE(item_label, ''));
                IF mapped_kind IS NOT NULL THEN
                    chip := jsonb_build_object('kind', mapped_kind);
                ELSE
                    chip := jsonb_build_object(
                        'kind', 'custom',
                        'customLabel', COALESCE(NULLIF(trim(item_label), ''), '미입력')
                    );
                END IF;
            END IF;

            result := result || jsonb_build_array(chip);
        END IF;
    END LOOP;

    -- 빈 배열이면 NULL 반환 (단일 문자열 fallback로 넘기기 위해)
    IF jsonb_array_length(result) = 0 THEN
        RETURN NULL;
    END IF;
    RETURN result;
END
$$;

-- 4c) 단일 문자열 → 1-element chip array
CREATE OR REPLACE FUNCTION pg_temp.string_to_chips(loc text)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
    trimmed text;
    mapped_kind text;
BEGIN
    IF loc IS NULL THEN RETURN NULL; END IF;
    trimmed := trim(loc);
    IF trimmed = '' THEN RETURN NULL; END IF;

    mapped_kind := pg_temp.korean_to_kind(trimmed);
    IF mapped_kind IS NOT NULL THEN
        RETURN jsonb_build_array(jsonb_build_object('kind', mapped_kind));
    END IF;
    RETURN jsonb_build_array(jsonb_build_object(
        'kind', 'custom',
        'customLabel', trimmed
    ));
END
$$;

-- 4d) work_logs.planned_work_locations 백필
--   우선순위: expected_work_location_timeline → expected_work_location 단일
--   work_location_timeline → work_location 단일 (expected가 없을 때 본문 fallback)
UPDATE public.work_logs
SET planned_work_locations = COALESCE(
    pg_temp.timeline_to_chips(expected_work_location_timeline),
    pg_temp.string_to_chips(expected_work_location),
    pg_temp.timeline_to_chips(work_location_timeline),
    pg_temp.string_to_chips(work_location)
)
WHERE planned_work_locations IS NULL
  AND is_deleted = false;

-- 4e) work_logs.actual_work_locations 백필
--   우선순위: work_location_timeline → work_location 단일
--   다만 planned와 같으면 NULL 유지 (저장 의도: 예정과 동일)
UPDATE public.work_logs
SET actual_work_locations = subq.derived
FROM (
    SELECT id,
           COALESCE(
               pg_temp.timeline_to_chips(work_location_timeline),
               pg_temp.string_to_chips(work_location)
           ) AS derived
    FROM public.work_logs
    WHERE actual_work_locations IS NULL
      AND is_deleted = false
) subq
WHERE public.work_logs.id = subq.id
  AND subq.derived IS NOT NULL
  AND subq.derived <> public.work_logs.planned_work_locations;

-- 4f) work_log_submissions 백필 — 동일 정책
UPDATE public.work_log_submissions
SET planned_work_locations = COALESCE(
    pg_temp.timeline_to_chips(expected_work_location_timeline),
    pg_temp.string_to_chips(expected_work_location),
    pg_temp.timeline_to_chips(work_location_timeline),
    pg_temp.string_to_chips(work_location)
)
WHERE planned_work_locations IS NULL;

UPDATE public.work_log_submissions
SET actual_work_locations = subq.derived
FROM (
    SELECT id,
           COALESCE(
               pg_temp.timeline_to_chips(work_location_timeline),
               pg_temp.string_to_chips(work_location)
           ) AS derived
    FROM public.work_log_submissions
    WHERE actual_work_locations IS NULL
) subq
WHERE public.work_log_submissions.id = subq.id
  AND subq.derived IS NOT NULL
  AND subq.derived <> public.work_log_submissions.planned_work_locations;

-- 검증 쿼리 (수동 확인용)
-- SELECT COUNT(*) FROM work_logs WHERE planned_work_locations IS NOT NULL;
-- SELECT COUNT(*) FROM work_logs WHERE actual_work_locations IS NOT NULL;
-- SELECT id, planned_work_locations, actual_work_locations FROM work_logs LIMIT 10;
