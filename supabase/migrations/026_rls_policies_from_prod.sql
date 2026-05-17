-- DEV/STG Supabase 프로젝트(`nqjlvortaczonnkgmqnk` = ewassistant-devstg)에
-- PROD(`ulesbsovwunyjdlabkwu` = CodingJam1203's Project)의 RLS 정책 + helper 함수를
-- 1:1 복제한다. SoT = PROD.
--
-- 배경:
--   DEV 프로젝트는 `init_schema_from_prod` + `init_indexes_from_prod` 두 마이그레이션으로
--   PROD 스키마/인덱스를 dump해 가져왔으나, RLS 정책과 helper 함수는 누락된 채 RLS만
--   `ENABLE` 상태였다. 그 결과 사용자 세션에서 모든 SELECT/INSERT/UPDATE/DELETE가 차단되어
--   middleware의 `user_profiles` 조회가 실패 → PGRST116 fail-close → /consent 무한 루프.
--
-- 본 마이그레이션은 PROD의 14개 테이블 27개 정책과 2개 helper 함수를 그대로 복제한다.
-- (정책 중 일부는 PROD에 중복 누적된 잔재이지만 SoT 정합을 위해 그대로 가져옴 — 정리는 별도 작업)
--
-- IDEMPOTENT 보장: helper 함수는 CREATE OR REPLACE, 정책은 DROP IF EXISTS 후 CREATE.

-- ============================================================================
-- [1] HELPER 함수
-- ============================================================================

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from public.user_profiles
    where id = auth.uid() and role = 'admin'
  );
$function$;

CREATE OR REPLACE FUNCTION public.is_leader_of(target_division text, target_team text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
$function$;

-- ============================================================================
-- [2] app_settings
-- ============================================================================

DROP POLICY IF EXISTS "Admins can write app settings" ON public.app_settings;
CREATE POLICY "Admins can write app settings"
  ON public.app_settings
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

DROP POLICY IF EXISTS "Admins can read app settings" ON public.app_settings;
CREATE POLICY "Admins can read app settings"
  ON public.app_settings
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (is_admin());

-- ============================================================================
-- [3] audit_logs
-- ============================================================================

DROP POLICY IF EXISTS "Admins can insert audit logs" ON public.audit_logs;
CREATE POLICY "Admins can insert audit logs"
  ON public.audit_logs
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (is_admin());

DROP POLICY IF EXISTS "Admins can read audit logs" ON public.audit_logs;
CREATE POLICY "Admins can read audit logs"
  ON public.audit_logs
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (is_admin());

DROP POLICY IF EXISTS "Admins can view audit logs" ON public.audit_logs;
CREATE POLICY "Admins can view audit logs"
  ON public.audit_logs
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (is_admin());

-- ============================================================================
-- [4] daily_work_status
-- ============================================================================

DROP POLICY IF EXISTS "Authenticated users can read daily status" ON public.daily_work_status;
CREATE POLICY "Authenticated users can read daily status"
  ON public.daily_work_status
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (auth.uid() IS NOT NULL);

-- ============================================================================
-- [5] notification_logs
-- ============================================================================

DROP POLICY IF EXISTS "Admin users can view notification_logs" ON public.notification_logs;
CREATE POLICY "Admin users can view notification_logs"
  ON public.notification_logs
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (EXISTS (
    SELECT 1
    FROM profiles p
    WHERE p.id = auth.uid()
      AND p.role = 'admin'::text
      AND p.is_blocked = false
  ));

-- ============================================================================
-- [6] org_divisions
-- ============================================================================

DROP POLICY IF EXISTS "Authenticated users can read divisions" ON public.org_divisions;
CREATE POLICY "Authenticated users can read divisions"
  ON public.org_divisions
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (auth.uid() IS NOT NULL);

-- ============================================================================
-- [7] org_teams
-- ============================================================================

DROP POLICY IF EXISTS "Authenticated users can read teams" ON public.org_teams;
CREATE POLICY "Authenticated users can read teams"
  ON public.org_teams
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (auth.uid() IS NOT NULL);

-- ============================================================================
-- [8] pre_approved_emails
-- ============================================================================

DROP POLICY IF EXISTS "Admins only" ON public.pre_approved_emails;
CREATE POLICY "Admins only"
  ON public.pre_approved_emails
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING (is_admin());

-- ============================================================================
-- [9] profiles (legacy)
-- ============================================================================

DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
CREATE POLICY "Users can view own profile"
  ON public.profiles
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((id = auth.uid()) OR is_admin());

-- ============================================================================
-- [10] teams_routing
-- ============================================================================

DROP POLICY IF EXISTS "teams_routing_admin_all" ON public.teams_routing;
CREATE POLICY "teams_routing_admin_all"
  ON public.teams_routing
  AS PERMISSIVE
  FOR ALL
  TO public
  USING (EXISTS (
    SELECT 1
    FROM user_profiles
    WHERE user_profiles.id = auth.uid()
      AND user_profiles.role = 'admin'::text
  ))
  WITH CHECK (EXISTS (
    SELECT 1
    FROM user_profiles
    WHERE user_profiles.id = auth.uid()
      AND user_profiles.role = 'admin'::text
  ));

-- ============================================================================
-- [11] user_policy_consents
-- ============================================================================

DROP POLICY IF EXISTS "Users can view own consents" ON public.user_policy_consents;
CREATE POLICY "Users can view own consents"
  ON public.user_policy_consents
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (user_email = (auth.jwt() ->> 'email'::text));

-- ============================================================================
-- [12] user_profiles
-- ============================================================================

DROP POLICY IF EXISTS "Users can read profiles in scope" ON public.user_profiles;
CREATE POLICY "Users can read profiles in scope"
  ON public.user_profiles
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((id = auth.uid()) OR is_admin() OR is_leader_of(division, team));

DROP POLICY IF EXISTS "users_read_own_profile" ON public.user_profiles;
CREATE POLICY "users_read_own_profile"
  ON public.user_profiles
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (auth.uid() = id);

-- ============================================================================
-- [13] work_log_submissions
-- ============================================================================

DROP POLICY IF EXISTS "submissions_admin_all" ON public.work_log_submissions;
CREATE POLICY "submissions_admin_all"
  ON public.work_log_submissions
  AS PERMISSIVE
  FOR ALL
  TO public
  USING (EXISTS (
    SELECT 1
    FROM user_profiles
    WHERE user_profiles.id = auth.uid()
      AND user_profiles.role = 'admin'::text
  ))
  WITH CHECK (EXISTS (
    SELECT 1
    FROM user_profiles
    WHERE user_profiles.id = auth.uid()
      AND user_profiles.role = 'admin'::text
  ));

DROP POLICY IF EXISTS "submissions_leader_select" ON public.work_log_submissions;
CREATE POLICY "submissions_leader_select"
  ON public.work_log_submissions
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (EXISTS (
    SELECT 1
    FROM user_profiles up
    WHERE up.id = auth.uid()
      AND up.role = 'leader'::text
      AND (
        (up.team IS NOT NULL AND up.team = work_log_submissions.team)
        OR (up.team IS NULL AND up.division = work_log_submissions.division)
      )
  ));

DROP POLICY IF EXISTS "submissions_self_select" ON public.work_log_submissions;
CREATE POLICY "submissions_self_select"
  ON public.work_log_submissions
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (user_id = auth.uid());

-- ============================================================================
-- [14] work_logs  ※ PROD에 누적된 중복 정책 그대로 복제 — 정리는 별도 작업
-- ============================================================================

DROP POLICY IF EXISTS "Users can delete own work_logs" ON public.work_logs;
CREATE POLICY "Users can delete own work_logs"
  ON public.work_logs
  AS PERMISSIVE
  FOR DELETE
  TO public
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own work logs" ON public.work_logs;
CREATE POLICY "Users can insert own work logs"
  ON public.work_logs
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (user_id = auth.uid())
    AND EXISTS (
      SELECT 1
      FROM profiles p
      WHERE p.id = auth.uid()
        AND p.is_blocked = false
    )
  );

DROP POLICY IF EXISTS "Users can insert own work_logs" ON public.work_logs;
CREATE POLICY "Users can insert own work_logs"
  ON public.work_logs
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Authenticated users can read all work_logs" ON public.work_logs;
CREATE POLICY "Authenticated users can read all work_logs"
  ON public.work_logs
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Users can read own work logs" ON public.work_logs;
CREATE POLICY "Users can read own work logs"
  ON public.work_logs
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (
    (COALESCE(is_deleted, false) = false)
    AND ((user_id = auth.uid()) OR is_admin() OR is_leader_of(division, team))
  );

DROP POLICY IF EXISTS "Users can read own work_logs" ON public.work_logs;
CREATE POLICY "Users can read own work_logs"
  ON public.work_logs
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can view own logs or admins view all" ON public.work_logs;
CREATE POLICY "Users can view own logs or admins view all"
  ON public.work_logs
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((user_id = auth.uid()) OR is_admin());

DROP POLICY IF EXISTS "Admins can update work logs" ON public.work_logs;
CREATE POLICY "Admins can update work logs"
  ON public.work_logs
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING (is_admin());

DROP POLICY IF EXISTS "Users can update own work_logs" ON public.work_logs;
CREATE POLICY "Users can update own work_logs"
  ON public.work_logs
  AS PERMISSIVE
  FOR UPDATE
  TO public
  USING (auth.uid() = user_id);

-- ============================================================================
-- [15] work_status_events
-- ============================================================================

DROP POLICY IF EXISTS "Authenticated users can read status events" ON public.work_status_events;
CREATE POLICY "Authenticated users can read status events"
  ON public.work_status_events
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (auth.uid() IS NOT NULL);

-- ============================================================================
-- 적용 후 검증 (수동 실행):
--   SELECT COUNT(*) FROM pg_policies WHERE schemaname='public';   -- 기대 27
--   SELECT COUNT(*) FROM pg_proc p JOIN pg_namespace n ON p.pronamespace=n.oid
--   WHERE n.nspname='public' AND p.proname IN ('is_admin','is_leader_of');  -- 기대 2
-- ============================================================================
