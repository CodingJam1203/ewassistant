-- 008_security_hardening.sql
-- 목적: 보안 강화 + audit_logs target_id 타입 정정
--
-- 적용 방법: Supabase Studio → SQL Editor에서 이 파일 전체 복붙 → Run.
-- 한 번에 idempotent하게 실행 가능 (drop policy if exists, create or replace 사용).

-- ======================================================================
-- 1) is_admin() 함수 재정의
--    실제 운영 테이블이 user_profiles 이므로 그 기준으로 통일
-- ======================================================================

create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

-- ======================================================================
-- 2) work_logs SELECT 정책 좁히기
--    기존: 모든 인증 사용자가 모든 사람의 work_logs를 조회 가능 → 정보 유출
--    수정: 본인 work_logs OR 관리자만 SELECT 가능
-- ======================================================================

alter table public.work_logs enable row level security;

-- 가능한 모든 이전 정책 이름 정리
drop policy if exists "Authenticated users can read work logs" on public.work_logs;
drop policy if exists "Users can read own work logs" on public.work_logs;

create policy "Users can read own work logs"
on public.work_logs
for select
to authenticated
using (
  coalesce(is_deleted, false) = false
  and (
    user_id = auth.uid()
    or public.is_admin()
  )
);

-- ======================================================================
-- 3) audit_logs — 컬럼 보강 + target_id 타입 변경 (uuid → text)
--    + RLS 활성화 + 관리자만 SELECT
--
--    배경: 운영 DB의 audit_logs 컬럼이 일부 누락되어 INSERT가 실패하던 문제.
--          모든 컬럼을 IF NOT EXISTS로 보강하고, target_id는 이메일 fallback도
--          수용하도록 text 타입으로 통일.
-- ======================================================================

alter table public.audit_logs enable row level security;

-- 누락 컬럼 보강 (idempotent)
alter table public.audit_logs
  add column if not exists actor_id uuid references auth.users(id),
  add column if not exists actor_email text,
  add column if not exists target_table text,
  add column if not exists target_id text,
  add column if not exists details jsonb,
  add column if not exists ip_address text,
  add column if not exists user_agent text;

-- target_id가 uuid로 만들어졌던 경우 text로 변환
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'audit_logs'
      and column_name = 'target_id'
      and data_type = 'uuid'
  ) then
    alter table public.audit_logs alter column target_id type text using target_id::text;
  end if;
end$$;

drop policy if exists "Admins can read audit logs" on public.audit_logs;
create policy "Admins can read audit logs"
on public.audit_logs
for select
to authenticated
using (public.is_admin());

-- INSERT/UPDATE/DELETE 정책 없음 → 기본 deny.
-- 서버는 service_role로 INSERT하므로 RLS 우회 → 정상 동작.

-- ======================================================================
-- 4) app_settings — 관리자 전용
-- ======================================================================

alter table public.app_settings enable row level security;

drop policy if exists "Admins can read app settings" on public.app_settings;
create policy "Admins can read app settings"
on public.app_settings
for select
to authenticated
using (public.is_admin());

drop policy if exists "Admins can write app settings" on public.app_settings;
create policy "Admins can write app settings"
on public.app_settings
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

-- ======================================================================
-- 5) otp_send_log — OTP 폭격 방지용 cooldown 테이블
--    /api/auth/send-otp가 60초 cooldown 체크에 사용
-- ======================================================================

create table if not exists public.otp_send_log (
  email text primary key,
  last_sent_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.otp_send_log enable row level security;
-- 정책 없음 → 일반 사용자 접근 차단. 서버(service_role)만 사용.

create index if not exists otp_send_log_last_sent_at_idx
  on public.otp_send_log (last_sent_at desc);

-- ======================================================================
-- 적용 확인 쿼리 (실행해보세요)
-- ======================================================================
-- select tablename, policyname, cmd
--   from pg_policies
--  where schemaname = 'public'
--    and tablename in ('work_logs','audit_logs','app_settings','otp_send_log')
--  order by tablename, policyname;
