-- v1.76 (2026-06-04) — pre_approved_emails 에 display_order 컬럼 추가
--
-- 배경:
--   미접속(사전등록 단계) 사용자의 표시 순서를 어드민이 미리 설정 가능하게.
--   기존: pre_approved_emails 에 display_order 컬럼 없어 GET 응답 999 하드코딩,
--         PATCH 도 명시적으로 무시 → 어드민이 변경해도 999 그대로 보이던 UX 문제.
--   가입 callback 에서 user_profiles 로 이관 시 이 값을 함께 박는다 (별도 코드 변경).

ALTER TABLE public.pre_approved_emails
  ADD COLUMN IF NOT EXISTS display_order integer NOT NULL DEFAULT 999;

COMMENT ON COLUMN public.pre_approved_emails.display_order IS
  'v1.76: 사전등록 단계에서 미리 설정 가능한 표시 순서. 가입 시 user_profiles.display_order 로 이관.';
