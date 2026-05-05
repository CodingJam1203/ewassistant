-- 009_perf_indexes.sql
-- 목적: 자주 사용되는 조회 패턴에 대한 인덱스 보강.
-- - work_logs는 PK(id) 외에는 인덱스가 거의 없어서 leave_date, user_email,
--   (user_id, leave_date) 같은 조회가 full scan으로 동작 중.
-- - 모든 인덱스는 IF NOT EXISTS 로 idempotent하게 생성.
--
-- 적용: Supabase SQL Editor에서 통째로 붙여넣고 Run.

-- ============================================================
-- work_logs
-- ============================================================

-- 본인 work_logs 조회 ( /api/work-logs?mine=true )
create index if not exists idx_work_logs_user_id
  on public.work_logs (user_id);

-- 이메일 기반 필터 (관리자 페이지 등)
create index if not exists idx_work_logs_user_email
  on public.work_logs (user_email);

-- 날짜 범위 조회 (전체 제출 페이지, team-status, history 등)
create index if not exists idx_work_logs_leave_date
  on public.work_logs (leave_date desc);

-- 가장 흔한 패턴: 특정 사용자의 특정 날짜 (또는 날짜 범위) 조회
create index if not exists idx_work_logs_user_id_leave_date
  on public.work_logs (user_id, leave_date desc);

-- is_deleted=false 만 보는 SELECT가 대부분 → 부분 인덱스로 실 데이터 row만 색인
create index if not exists idx_work_logs_active_leave_date
  on public.work_logs (leave_date desc)
  where is_deleted = false;

-- 정렬에 사용되는 created_at (페이지네이션용)
create index if not exists idx_work_logs_created_at
  on public.work_logs (created_at desc);

-- ============================================================
-- daily_work_status (코드에서 사용 중. 마이그레이션에 정의가 누락된 듯)
-- 테이블이 존재하는 경우에만 인덱스 추가 (DO 블록으로 안전 처리)
-- ============================================================

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'daily_work_status'
  ) then
    -- 사용자별 오늘 상태 조회
    if not exists (
      select 1 from pg_indexes
      where schemaname = 'public' and indexname = 'idx_daily_work_status_user_date'
    ) then
      create index idx_daily_work_status_user_date
        on public.daily_work_status (user_email, work_date desc);
    end if;

    -- 날짜 단독 조회
    if not exists (
      select 1 from pg_indexes
      where schemaname = 'public' and indexname = 'idx_daily_work_status_work_date'
    ) then
      create index idx_daily_work_status_work_date
        on public.daily_work_status (work_date desc);
    end if;
  end if;
end$$;

-- ============================================================
-- work_status_events (있는 경우)
-- ============================================================

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'work_status_events'
  ) then
    if not exists (
      select 1 from pg_indexes
      where schemaname = 'public' and indexname = 'idx_work_status_events_user_date'
    ) then
      create index idx_work_status_events_user_date
        on public.work_status_events (user_email, event_at desc);
    end if;
  end if;
end$$;

-- ============================================================
-- user_profiles 자주 쓰이는 lookup
-- ============================================================

-- email은 PK인 경우가 일반적이지만, division/team 필터가 자주 쓰이면 추가 가능.
-- 현재는 fetch 패턴상 email/id로 단건 조회가 대부분이므로 유지.
-- 다만 admin 페이지의 정렬용:
create index if not exists idx_user_profiles_display_order
  on public.user_profiles (display_order nulls last, division, team);

-- ============================================================
-- 적용 후 확인 쿼리:
-- ============================================================
-- select tablename, indexname
--   from pg_indexes
--  where schemaname = 'public'
--    and tablename in ('work_logs', 'daily_work_status', 'work_status_events', 'user_profiles')
--  order by tablename, indexname;
