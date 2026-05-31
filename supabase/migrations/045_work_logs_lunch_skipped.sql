-- v1.64: 8H 미만 근무 시 사용자가 점심 안 가졌다고 선택한 케이스 박제.
-- true면 복붙 텍스트의 퇴근시각 +1H 보정 + 추가 안내 텍스트.
-- EW 계산(점심 60분 자동 차감) 자체는 변동 없음. 표시·복붙·알림만 보정.
ALTER TABLE public.work_logs
  ADD COLUMN IF NOT EXISTS lunch_skipped boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.work_logs.lunch_skipped IS
  'v1.64: 8H 미만 근무 시 사용자가 점심 안 가졌다고 선택한 케이스. true면 복붙/알림 시간 +1H 보정 + 추가 텍스트. EW 차감 로직은 무관.';
