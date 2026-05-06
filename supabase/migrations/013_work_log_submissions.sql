-- 013_work_log_submissions.sql
-- 모든 제출 이력을 append-only 로그로 보관.
-- - work_logs: 일자별 "최종 상태" (mutable, 1 row per (user, leave_date))
-- - work_log_submissions: 제출 로그 (immutable, append only)
--
-- 정책:
--   POST 신규 → 1~2개 row 생성 (퇴근보고 + 선택적으로 다음날 출근보고)
--   PATCH 수정 → 변경 영역에 따라 0~2개 row 생성 (출근보고 수정 / 퇴근보고 수정)
--   삭제는 별도 row 없이 work_logs.is_deleted = true 만

BEGIN;

CREATE TABLE IF NOT EXISTS work_log_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- ─── 사용자 ─────────────────────────────────────────────────────
  user_id    UUID,
  user_email TEXT NOT NULL,
  name       TEXT,
  division   TEXT,
  team       TEXT,

  -- ─── 분류 ───────────────────────────────────────────────────────
  -- check_in        : 신규 출근보고 (사전 또는 당일)
  -- check_out       : 신규 퇴근보고
  -- check_in_update : 출근보고 영역 수정
  -- check_out_update: 퇴근보고 영역 수정
  report_type TEXT NOT NULL CHECK (report_type IN (
    'check_in', 'check_out', 'check_in_update', 'check_out_update'
  )),

  -- 보고가 가리키는 대상일 (출근보고면 expected_start_date, 퇴근보고면 leave_date)
  target_date DATE NOT NULL,

  -- 제출 시각
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- 연결된 work_logs row (집계 결과 캐시)
  work_log_id UUID REFERENCES work_logs(id) ON DELETE SET NULL,

  -- ─── 퇴근보고 영역 스냅샷 (report_type IN ('check_out', 'check_out_update')) ───
  start_time      TIME,
  end_time        TIME,
  break_time      INTERVAL,
  actual_work_time INTERVAL,
  work_location   TEXT,
  work_location_timeline JSONB,
  leave_timeline  JSONB,
  work_content    TEXT,
  ew_value        TEXT,
  ew_start        TEXT,
  ew_end          TEXT,
  copy_text       TEXT,
  late_or_attendance_status TEXT,
  previous_report_time TEXT,  -- work_logs와 동일 타입 (TEXT)
  current_report_time  TEXT,  -- work_logs와 동일 타입 (TEXT)
  late_reason     TEXT,
  break_reason    TEXT,
  break_auto_actual_minutes    INT,
  break_auto_rounded_minutes   INT,
  break_manual_rounded_minutes INT,
  break_final_rounded_minutes  INT,
  thanks_macaron  TEXT,

  -- ─── 출근보고 영역 스냅샷 (report_type IN ('check_in', 'check_in_update')) ───
  expected_start_date DATE,
  expected_work_time  TIME,
  expected_work_location TEXT,
  expected_work_location_timeline JSONB,
  expected_leave_timeline JSONB,

  -- ─── 수정 메타 (report_type가 _update일 때) ───
  changed_fields JSONB,  -- ChangedField[] (kind, label, before, after)

  -- ─── 공통 메타 ─────────────────────────────────────────────────
  work_type_label TEXT,
  work_type_code  INT,
  attendance_record_type TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── 인덱스 ────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_submissions_user_target_submitted
  ON work_log_submissions (user_email, target_date DESC, submitted_at DESC);

CREATE INDEX IF NOT EXISTS idx_submissions_team_target
  ON work_log_submissions (division, team, target_date DESC);

CREATE INDEX IF NOT EXISTS idx_submissions_work_log
  ON work_log_submissions (work_log_id);

CREATE INDEX IF NOT EXISTS idx_submissions_report_type
  ON work_log_submissions (report_type);

CREATE INDEX IF NOT EXISTS idx_submissions_submitted_at
  ON work_log_submissions (submitted_at DESC);

-- ─── RLS ──────────────────────────────────────────────────────────
ALTER TABLE work_log_submissions ENABLE ROW LEVEL SECURITY;

-- admin: 전체
DROP POLICY IF EXISTS submissions_admin_all ON work_log_submissions;
CREATE POLICY submissions_admin_all ON work_log_submissions
  FOR ALL
  USING (
    EXISTS (SELECT 1 FROM user_profiles
            WHERE user_profiles.id = auth.uid()
              AND user_profiles.role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM user_profiles
            WHERE user_profiles.id = auth.uid()
              AND user_profiles.role = 'admin')
  );

-- leader: 본인 팀(또는 본부장이면 본인 본부) SELECT만
DROP POLICY IF EXISTS submissions_leader_select ON work_log_submissions;
CREATE POLICY submissions_leader_select ON work_log_submissions
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles up
      WHERE up.id = auth.uid()
        AND up.role = 'leader'
        AND (
          (up.team IS NOT NULL AND up.team = work_log_submissions.team)
          OR (up.team IS NULL AND up.division = work_log_submissions.division)
        )
    )
  );

-- user: 본인 row만 SELECT
DROP POLICY IF EXISTS submissions_self_select ON work_log_submissions;
CREATE POLICY submissions_self_select ON work_log_submissions
  FOR SELECT
  USING (user_id = auth.uid());

COMMIT;

-- ─── 백필: 기존 work_logs → submissions ───────────────────────────────
-- 옵션 A: 1 work_log → 1 'check_out' row만 (과거 데이터 단순화)
-- 백필 row의 submitted_at = work_logs.created_at
-- changed_fields = NULL

BEGIN;

INSERT INTO work_log_submissions (
  user_id, user_email, name, division, team,
  report_type, target_date, submitted_at, work_log_id,
  start_time, end_time, break_time, actual_work_time,
  work_location, work_location_timeline, leave_timeline,
  work_content, ew_value, ew_start, ew_end, copy_text,
  late_or_attendance_status, previous_report_time, current_report_time,
  late_reason, break_reason,
  break_auto_actual_minutes, break_auto_rounded_minutes,
  break_manual_rounded_minutes, break_final_rounded_minutes,
  thanks_macaron,
  expected_start_date, expected_work_time, expected_work_location,
  expected_work_location_timeline, expected_leave_timeline,
  work_type_label, work_type_code, attendance_record_type,
  created_at
)
SELECT
  user_id, user_email, name, division, team,
  'check_out' AS report_type,
  leave_date AS target_date,
  created_at AS submitted_at,
  id AS work_log_id,
  start_time, end_time, break_time, actual_work_time,
  work_location, work_location_timeline, leave_timeline,
  work_content, ew_value, ew_start, ew_end, copy_text,
  late_or_attendance_status, previous_report_time, current_report_time,
  late_reason, break_reason,
  break_auto_actual_minutes, break_auto_rounded_minutes,
  break_manual_rounded_minutes, break_final_rounded_minutes,
  thanks_macaron,
  expected_start_date, expected_work_time, expected_work_location,
  expected_work_location_timeline, expected_leave_timeline,
  work_type_label, work_type_code, attendance_record_type,
  created_at
FROM work_logs
WHERE is_deleted = false
  AND NOT EXISTS (
    SELECT 1 FROM work_log_submissions s WHERE s.work_log_id = work_logs.id
  );

COMMIT;

-- 검증
-- SELECT report_type, COUNT(*) FROM work_log_submissions GROUP BY 1;
-- 기대: check_out 행 = 백필 직후 기존 work_logs 활성 row 수
