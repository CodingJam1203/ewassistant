-- 010_role_leader.sql
-- 목적: user_profiles.role에 'leader' 권한 추가 + 관련 RLS 정책 보강
--
-- 새 권한 체계:
--   admin   — 전체 조직
--   leader  — 본인 팀 (또는 본부장이면 본인 본부 전체)
--   user    — 본인 데이터만

-- ============================================================
-- 1) role CHECK 제약 변경 — 'leader' 허용
-- ============================================================

-- 기존 CHECK 제약 이름이 환경마다 다를 수 있으므로 동적으로 찾아 제거 후 재생성
do $$
declare
  c_name text;
begin
  -- user_profiles.role 컬럼에 걸린 CHECK 제약 찾기
  select con.conname into c_name
    from pg_constraint con
    join pg_class cls on cls.oid = con.conrelid
    join pg_namespace ns on ns.oid = cls.relnamespace
   where ns.nspname = 'public'
     and cls.relname = 'user_profiles'
     and con.contype = 'c'
     and pg_get_constraintdef(con.oid) ilike '%role%'
   limit 1;

  if c_name is not null then
    execute format('alter table public.user_profiles drop constraint %I', c_name);
  end if;
end$$;

alter table public.user_profiles
  add constraint user_profiles_role_check
    check (role in ('user', 'leader', 'admin'));

-- ============================================================
-- 2) is_leader() 함수 — 본인이 leader 권한이고 같은 팀(또는 본부장이면 본부)인지 판정용
--    인자 target_division/target_team을 받아 본인 권한 범위인지 검사
-- ============================================================

create or replace function public.is_leader_of(
  target_division text,
  target_team text
)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_profiles me
    where me.id = auth.uid()
      and me.role = 'leader'
      and me.is_active = true
      and (
        -- 일반 팀 리더: 본인 팀 == 대상 팀
        (coalesce(me.team, '') <> '' and me.team = target_team)
        or
        -- 본부장(team 없음): 본인 본부 == 대상 본부
        (coalesce(me.team, '') = '' and me.division is not null and me.division = target_division)
      )
  );
$$;

-- ============================================================
-- 3) work_logs SELECT 정책 확장 — leader가 권한 범위 내 본인 팀/본부 조회 가능
-- ============================================================

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
    or public.is_leader_of(division, team)
  )
);

-- ============================================================
-- 4) user_profiles SELECT 정책 — leader가 권한 범위 내 프로필 조회 가능
-- ============================================================

drop policy if exists "Users can view own profile" on public.user_profiles;
drop policy if exists "Users can read own profile" on public.user_profiles;

create policy "Users can read profiles in scope"
on public.user_profiles
for select
to authenticated
using (
  id = auth.uid()
  or public.is_admin()
  or public.is_leader_of(division, team)
);

-- ============================================================
-- 적용 확인:
-- ============================================================
-- select tablename, policyname, cmd
--   from pg_policies
--  where schemaname = 'public'
--    and tablename in ('work_logs', 'user_profiles')
--  order by tablename, policyname;
