-- 015_lunch_break_split.sql (REVERTED — no-op)
--
-- 이 마이그레이션은 적용되지 않은 상태로 되돌려졌습니다.
-- 원래 의도: lunch_minutes 컬럼 추가 + break 컬럼 split.
-- 폐기 사유: Google Sheets 원본 EW 함수와 일치시키기 위해 점심을 별도 사용자
--   입력으로 분리하지 않고, 기존 deduction_time(워크타입 기반)으로 처리하기로 결정.
--
-- 안전: 이미 적용된 환경이라면 추가 작업 필요 없음 (lunch_minutes 컬럼이 0/null로
--   유지되어도 코드는 더 이상 참조하지 않음).

SELECT 1; -- no-op
