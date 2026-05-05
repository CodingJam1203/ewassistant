-- 008_security_hardening.sql
-- 목적: 보안 강화 (RLS 정책 좁히기 + 누락 정책 보강)
-- 주의: API 라우트들은 createAdminClient()(service_role)로 RLS를 우회해서 호출하므로
--       이 정책 변경은 (a) 클라이언트가 직접 supabase-js로 접근하는 경로,
--       (b) 사용자가 SQL Editor/REST에서 anon/authenticated key로 직접 호출하는 경로 만 영향.
--       즉 API 라우트의 동작은 그대로 유지되며, 본 변경은 "직접 DB 접근 시 데이터 노출 방지"가 목적임.

-- =====================================================================
-- 1) work_logs SELECT 정책 — 본인 또는 관리자만 조회 가능하도록 좁힘
--    (기존: 모든 인증 사용자가 모든 사람의 work_logs 조회 가능 → 정보 유출)
-- =====================================================================

drop policy if exists "Authenticated users can read work logs" on public.work_logs;

create policy "Users can read own work logs"
on public.work_logs
for select
to authenticated
using (
  is_deleted = false
  and (
    user_id = auth.uid()
    or public.is_admin()
  )
  and exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.is_blocked = false
  )
);

-- =====================================================================
-- 2) profiles 테이블 — UPDATE / INSERT 정책 보강 (누락분 보충)
--    기존: SELECT 정책만 있어 직접 DB 접근 시 본인 프로필 수정 불가/모든 수정 가능 등
--    의도치 않은 동작 가능. 명시적 제한.
-- =====================================================================

-- 본인 프로필만 업데이트 (관리자는 service_role로 admin API에서 처리)
drop policy if exists "Users can update own profile" on public.profiles;
create policy "Users can update own profile"
on public.profiles
for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

-- INSERT는 트리거로만 처리되므로 별도 정책 불필요. 만약 직접 INSERT 차단을 원하면 아래 정책 추가:
-- (현재는 supabase auth가 자동 트리거로 profiles row를 만들거나, service_role이 만든다고 가정)

-- =====================================================================
-- 3) audit_logs — 관리자만 SELECT, INSERT는 service_role(서버)만
--    (RLS는 활성화돼 있지만 정책이 명시되지 않은 상태일 수 있음 → 명시화)
-- =====================================================================

drop policy if exists "Admins can read audit logs" on public.audit_logs;
create policy "Admins can read audit logs"
on public.audit_logs
for select
to authenticated
using (public.is_admin());

-- INSERT는 클라이언트(authenticated)가 직접 못하게 — 서버(service_role)만 가능.
-- 별도 INSERT/UPDATE/DELETE 정책 없음 → 기본 deny.

-- =====================================================================
-- 4) app_settings — 관리자만 SELECT/UPDATE/INSERT, 일반 사용자는 못 봄
--    (운영 설정 정보가 노출되지 않도록)
-- =====================================================================

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

-- =====================================================================
-- 5) (참고) 다음 테이블들은 마이그레이션 003~007에서 RLS를 명시적으로 활성화/정책을
--    설정했어야 함. 현재 상태가 불확실하면 Supabase Studio → Authentication → Policies
--    에서 시각적으로 확인 후 누락된 항목은 별도 마이그레이션으로 추가할 것:
--    - notification_logs
--    - leave_calendar_cache
--    - daily_work_status (006 추가됐다면)
--    - work_status_events (006 추가됐다면)
--    - service_notices (003 추가됐다면)
-- =====================================================================

-- =====================================================================
-- 6) otp_send_log — OTP 폭격 방지용 cooldown 추적 테이블
--    /api/auth/send-otp가 60초 cooldown을 위해 사용. authenticated 접근 차단.
-- =====================================================================

create table if not exists public.otp_send_log (
  email text primary key,
  last_sent_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.otp_send_log enable row level security;

-- service_role(서버)만 INSERT/SELECT/UPDATE 가능. 별도 정책 없음 → 기본 deny.
-- (anon/authenticated는 이 테이블에 직접 접근 불가)

-- 정리 인덱스 (cooldown 시간 검색 효율)
create index if not exists otp_send_log_last_sent_at_idx
  on public.otp_send_log (last_sent_at desc);

-- 적용 후 확인 쿼리 (실행해보세요):
-- select tablename, policyname, cmd, qual
--   from pg_policies
--  where schemaname = 'public'
--    and tablename in ('work_logs','profiles','audit_logs','app_settings','otp_send_log')
--  order by tablename, cmd;
