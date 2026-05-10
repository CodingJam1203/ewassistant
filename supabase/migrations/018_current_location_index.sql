-- 018_current_location_index.sql
-- daily_work_status에 current_location_index INTEGER 컬럼 추가.
--
-- 배경: 같은 라벨(예: '재택')을 가진 칩이 여러 개일 때, 라벨만으로는 어떤 칩이
-- 현재 위치인지 구분할 수 없었음. 칩 배열의 index로 함께 트래킹하여 동일 라벨
-- 칩이라도 위치별로 ★ 마커를 정확히 표시.
--
-- - NULL = index 정보 없음 → 클라이언트는 라벨 매칭으로 fallback
-- - 0-based index. actual_work_locations 배열 길이를 벗어난 값은 무시.

BEGIN;

ALTER TABLE public.daily_work_status
    ADD COLUMN IF NOT EXISTS current_location_index INTEGER;

COMMENT ON COLUMN public.daily_work_status.current_location_index IS
    '현재 위치 칩의 index (0-based). NULL이면 current_location 라벨로 fallback 매칭.';

COMMIT;
