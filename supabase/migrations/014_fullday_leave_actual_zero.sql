-- 014_fullday_leave_actual_zero.sql
-- 종일 휴가 actual_work_time 잔여 분 0으로 보정
--
-- 배경:
--   기존 calculateEw 로직: actual = (end - start) - break - leave
--   종일 휴가 default 입력: start=09:00, end=18:00, break=00:00, leave=480
--     → actual = 540 - 0 - 480 = 60분 잔여 (점심 시간 자동 차감 제거 후 발생)
--   해당 row의 인정근로에 1h가 잘못 잡히던 버그.
--
-- 수정 코드(2026.05): calculateEw에 isFullDayLeave 플래그 추가 → true일 때 actual = 0
--   이 SQL은 코드 수정 이전에 저장된 종일 휴가 row의 잔여 분을 0으로 일괄 보정.
--
-- 안전성:
--   - 종일 휴가가 명확한 row(leave_timeline에 leaveType='full_day' 포함)만 대상
--   - 반차/일반 row는 건드리지 않음
--   - is_deleted=false 만 대상
--   - 1회성 보정. 반복 실행해도 멱등(이미 0이면 그대로).

UPDATE work_logs
SET actual_work_time = '0 minutes'::interval
WHERE is_deleted = false
  AND leave_timeline IS NOT NULL
  AND jsonb_typeof(leave_timeline) = 'array'
  AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements(leave_timeline) AS item
    WHERE item->>'leaveType' = 'full_day'
  )
  AND actual_work_time IS DISTINCT FROM '0 minutes'::interval;
