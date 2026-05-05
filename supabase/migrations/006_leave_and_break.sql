-- 006_leave_and_break.sql
-- 휴가(leave) 타임라인 + 휴게(break) 자동/수동 분리 컬럼 추가
--
-- 1) 휴가 타임라인:
--    leave_timeline               — 오늘 실제 휴가/반차 흐름
--    expected_leave_timeline      — 다음 출근 예정의 휴가/반차 흐름
--
-- 2) 휴게 4종 분리:
--    break_auto_actual_minutes    — 휴게 시작/종료 로그 기준 실제 분
--    break_auto_rounded_minutes   — 자동 계산된 30분 올림 반영값
--    break_manual_rounded_minutes — 퇴근보고에서 사용자가 직접 수정한 최종 반영값 (NULL 가능)
--    break_final_rounded_minutes  — 실제 EW 계산에 쓰인 값
--                                   (manual이 있으면 manual, 없으면 auto)
--
-- 기존 break_time(interval) 컬럼은 그대로 유지 — fallback / legacy 표시용

ALTER TABLE public.work_logs
    ADD COLUMN IF NOT EXISTS leave_timeline JSONB,
    ADD COLUMN IF NOT EXISTS expected_leave_timeline JSONB,
    ADD COLUMN IF NOT EXISTS break_auto_actual_minutes INTEGER,
    ADD COLUMN IF NOT EXISTS break_auto_rounded_minutes INTEGER,
    ADD COLUMN IF NOT EXISTS break_manual_rounded_minutes INTEGER,
    ADD COLUMN IF NOT EXISTS break_final_rounded_minutes INTEGER;

COMMENT ON COLUMN public.work_logs.leave_timeline IS
    '오늘 실제 휴가/반차 타임라인. [{kind:"leave",leaveType:"morning_half"|"afternoon_half"|"full_day",label,startTime,endTime,actualMinutes,roundedMinutes,source}]';

COMMENT ON COLUMN public.work_logs.expected_leave_timeline IS
    '다음 출근 예정의 휴가/반차 타임라인 (오늘 퇴근보고 시 입력 → 다음 근무일 출근보고 prefill)';

COMMENT ON COLUMN public.work_logs.break_auto_actual_minutes IS
    '휴게 시작/종료 로그 기준 누적 실제 분 (분 단위 정수)';

COMMENT ON COLUMN public.work_logs.break_auto_rounded_minutes IS
    '휴게 시작/종료 로그를 30분 단위로 올림 처리한 분 (1~30분 → 30, 31~60분 → 60 …)';

COMMENT ON COLUMN public.work_logs.break_manual_rounded_minutes IS
    '퇴근보고에서 사용자가 직접 수정한 최종 휴게 분 (30분 단위, NULL이면 사용자가 수정하지 않음)';

COMMENT ON COLUMN public.work_logs.break_final_rounded_minutes IS
    'EW 계산에 실제 사용된 휴게 분. manual이 있으면 manual, 없으면 auto';

-- 부분 인덱스: 휴가가 있는 레코드만 빠르게 필터링
CREATE INDEX IF NOT EXISTS idx_work_logs_has_leave
    ON public.work_logs ((leave_timeline IS NOT NULL))
    WHERE leave_timeline IS NOT NULL AND jsonb_array_length(leave_timeline) > 0;
