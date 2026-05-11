-- 019_pre_approved_emails_role_leader.sql
-- pre_approved_emails.role CHECK 제약에 'leader' 추가.
--
-- 마이그레이션 010에서 user_profiles는 'leader' 권한을 받도록 업데이트했지만,
-- pre_approved_emails 테이블은 빠져 있어 사전 등록 시 'leader' 권한이 거부되던 버그 수정.
--
-- 사전 등록 → 사용자 로그인 시 pre_approved_emails → user_profiles로 이관되는 흐름이라
-- 양쪽 CHECK 제약이 동일해야 함.

BEGIN;

-- 기존 CHECK 제약 이름이 환경마다 다를 수 있으므로 동적으로 찾아 제거
DO $$
DECLARE
  c_name text;
BEGIN
  SELECT con.conname INTO c_name
    FROM pg_constraint con
    JOIN pg_class cls ON cls.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = cls.relnamespace
   WHERE ns.nspname = 'public'
     AND cls.relname = 'pre_approved_emails'
     AND con.contype = 'c'
     AND pg_get_constraintdef(con.oid) ILIKE '%role%'
   LIMIT 1;

  IF c_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.pre_approved_emails DROP CONSTRAINT %I', c_name);
  END IF;
END$$;

ALTER TABLE public.pre_approved_emails
  ADD CONSTRAINT pre_approved_emails_role_check
    CHECK (role IN ('user', 'leader', 'admin'));

COMMIT;
