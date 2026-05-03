-- 001_init.sql
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  name text,
  avatar_url text,
  role text not null default 'user' check (role in ('user', 'admin')),
  is_blocked boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.work_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  user_email text not null,
  name text not null,
  work_type_label text not null,
  work_type_code integer not null check (work_type_code in (1, 2, 3)),
  leave_date date not null,
  start_time time not null,
  end_time time not null,
  break_time interval not null default interval '0 minutes',
  break_reason text,
  work_content text,
  work_location text not null,
  late_or_attendance_status text,
  previous_report_time text,
  current_report_time text,
  late_reason text,
  report_type text,
  expected_start_date date,
  expected_work_time text,
  thanks_macaron text,
  deduction_time interval not null,
  actual_work_time interval not null,
  ew_start time,
  ew_end time,
  ew_value text not null,
  copy_text text not null,
  teams_sent boolean not null default false,
  teams_sent_at timestamptz,
  is_deleted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users(id),
  actor_email text,
  action text not null,
  target_table text,
  target_id uuid,
  details jsonb,
  ip_address text,
  user_agent text,
  created_at timestamptz not null default now()
);

-- Enable RLS
alter table public.profiles enable row level security;
alter table public.work_logs enable row level security;
alter table public.app_settings enable row level security;
alter table public.audit_logs enable row level security;

-- Profiles Policies
-- 관리자 여부 확인용 함수 (무한 재귀 방지)
create or replace function public.is_admin()
returns boolean
language sql
security definer
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

create policy "Users can view own profile"
on public.profiles
for select
to authenticated
using (
  id = auth.uid()
  or 
  public.is_admin()
);

-- Work Logs Policies
create policy "Authenticated users can read work logs"
on public.work_logs
for select
to authenticated
using (
  is_deleted = false
  and exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.is_blocked = false
  )
);

create policy "Users can insert own work logs"
on public.work_logs
for insert
to authenticated
with check (
  user_id = auth.uid()
  and exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.is_blocked = false
  )
);

create policy "Admins can update work logs"
on public.work_logs
for update
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
      and p.is_blocked = false
  )
)
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
      and p.is_blocked = false
  )
);

create policy "Admins can delete work logs"
on public.work_logs
for delete
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
      and p.is_blocked = false
  )
);
