/**
 * work_log_submissions append-only 로그 기록 헬퍼.
 *
 * POST 신규 / PATCH 수정 시 호출해서 제출 이력을 누적.
 * - work_logs 테이블은 일자별 최종 상태 캐시 (mutable)
 * - 본 테이블은 모든 제출 이벤트의 immutable 로그
 *
 * 실패해도 메인 흐름을 막지 않음 (try/catch 안에서 호출 + console.warn).
 */

import { createAdminClient } from '@/lib/supabase/admin'
import type { ChangedField } from './notifications/types'

export type ReportType =
  | 'check_in'
  | 'check_out'
  | 'check_in_update'
  | 'check_out_update'

export interface SubmissionLogInput {
  user_id: string | null
  user_email: string
  name: string | null
  division: string | null
  team: string | null

  report_type: ReportType
  target_date: string  // YYYY-MM-DD
  submitted_at?: string  // ISO. 미지정 시 now()
  work_log_id: string | null

  // 퇴근보고 영역 (check_out / check_out_update)
  start_time?: string | null
  end_time?: string | null
  break_time?: string | null
  actual_work_time?: string | null
  work_location?: string | null
  work_location_timeline?: unknown
  leave_timeline?: unknown
  work_content?: string | null
  ew_value?: string | null
  ew_start?: string | null
  ew_end?: string | null
  copy_text?: string | null
  late_or_attendance_status?: string | null
  previous_report_time?: string | null
  current_report_time?: string | null
  late_reason?: string | null
  break_reason?: string | null
  break_auto_actual_minutes?: number | null
  break_auto_rounded_minutes?: number | null
  break_manual_rounded_minutes?: number | null
  break_final_rounded_minutes?: number | null
  thanks_macaron?: string | null

  // 출근보고 영역 (check_in / check_in_update)
  expected_start_date?: string | null
  expected_work_time?: string | null
  expected_work_location?: string | null
  expected_work_location_timeline?: unknown
  expected_leave_timeline?: unknown

  // 수정일 때
  changed_fields?: ChangedField[] | null

  // 공통 메타
  work_type_label?: string | null
  work_type_code?: number | null
  attendance_record_type?: string | null
}

/**
 * submissions 테이블에 1 row 삽입.
 * 실패해도 throw 안 함 (warn 로그만).
 */
export async function recordSubmission(input: SubmissionLogInput): Promise<void> {
  try {
    const admin = createAdminClient()
    const { error } = await admin.from('work_log_submissions').insert(input)
    if (error) {
      console.warn('[submission-log] insert failed:', error.message, {
        user: input.user_email,
        type: input.report_type,
      })
    }
  } catch (err) {
    console.warn('[submission-log] exception:', err)
  }
}
