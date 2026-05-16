import type { WorkLocationTimeline } from './work-location-timeline'
import type { LeaveTimeline } from './leave-timeline'
import type { WorkLocations } from './work-locations-v2'

export interface WorkLog {
  id: string
  name: string
  work_type_label: string
  leave_date: string
  start_time: string
  end_time: string
  // 정책서 시간 4종 분리 (Stage 0-1) — 옛 row는 NULL일 수 있어 nullable
  planned_start_time?: string | null
  planned_end_time?: string | null
  actual_start_time?: string | null
  actual_end_time?: string | null
  actual_work_time: string
  break_time: string
  break_reason: string | null
  ew_value: string
  work_location: string
  work_content: string | null
  attendance_record_type: string | null
  copy_text: string
  created_at: string
  updated_at: string | null
  updated_by?: string | null
  user_email?: string | null

  // 근무장소 — legacy 단일 컬럼 (read-only mirror)
  work_location_type?: string | null
  work_location_custom?: string | null
  /**
   * @deprecated 신규 입력은 actual_work_locations 사용. 표시 fallback용으로만 보존.
   */
  work_location_timeline?: WorkLocationTimeline | null

  // 근무장소 v2 — 시간과 분리된 칩 배열
  /** 출근보고 시점의 예정 근무장소 칩 배열 */
  planned_work_locations?: WorkLocations | null
  /** 퇴근보고 시점의 실제 근무장소 칩 배열. NULL = planned와 동일. */
  actual_work_locations?: WorkLocations | null

  // 휴가
  leave_timeline?: LeaveTimeline | null

  // 휴게 4분리 (= 점심 외 추가 휴게. 점심 1h는 워크타입 기반 자동 차감)
  break_auto_actual_minutes?: number | null
  break_auto_rounded_minutes?: number | null
  break_manual_rounded_minutes?: number | null
  break_final_rounded_minutes?: number | null

  // 지각/당일수정
  late_or_attendance_status?: string | null
  previous_report_time?: string | null
  current_report_time?: string | null
  late_reason?: string | null

  // 다음 출근 예정 (출근보고 진행)
  /**
   * @deprecated 신규 입력은 planned_work_locations 사용. 표시 fallback용으로만 보존.
   */
  expected_work_location_timeline?: WorkLocationTimeline | null
  /** 다음 출근 예정 휴가/반차 */
  expected_leave_timeline?: LeaveTimeline | null
  expected_work_location?: string | null
  expected_work_location_type?: string | null
  expected_work_time?: string | null
  expected_start_date?: string | null

  // 기타
  thanks_macaron?: string | null
  division?: string | null
  team?: string | null

  [key: string]: unknown
}
