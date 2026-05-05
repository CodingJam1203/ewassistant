import type { WorkLocationTimeline } from './work-location-timeline'
import type { LeaveTimeline } from './leave-timeline'

export interface WorkLog {
  id: string
  name: string
  work_type_label: string
  leave_date: string
  start_time: string
  end_time: string
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

  // ─── 근무장소 ──────────────────────────────────────────────────────────────
  /** 본문 근무장소 type ('사무실' | '재택' | '외근' | '기타') — legacy + 폼 prefill용 */
  work_location_type?: string | null
  /** type === '기타' 일 때 직접 입력값 */
  work_location_custom?: string | null
  /** 오늘 실제 근무장소 타임라인 (마지막은 'checkout') */
  work_location_timeline?: WorkLocationTimeline | null

  // ─── 휴가 ─────────────────────────────────────────────────────────────────
  /** 오늘 휴가/반차 타임라인 */
  leave_timeline?: LeaveTimeline | null

  // ─── 휴게 4분리 ───────────────────────────────────────────────────────────
  break_auto_actual_minutes?: number | null
  break_auto_rounded_minutes?: number | null
  break_manual_rounded_minutes?: number | null
  break_final_rounded_minutes?: number | null

  // ─── 지각/당일수정 ────────────────────────────────────────────────────────
  late_or_attendance_status?: string | null
  previous_report_time?: string | null
  current_report_time?: string | null
  late_reason?: string | null

  // ─── 다음 출근 예정 (출근보고 진행) ────────────────────────────────────────
  /** 출근보고 근무장소 타임라인 (마지막은 'expected_checkout') */
  expected_work_location_timeline?: WorkLocationTimeline | null
  /** 다음 출근 예정 휴가/반차 */
  expected_leave_timeline?: LeaveTimeline | null
  expected_work_location?: string | null
  expected_work_location_type?: string | null
  expected_work_time?: string | null
  expected_start_date?: string | null

  // ─── 기타 ─────────────────────────────────────────────────────────────────
  thanks_macaron?: string | null
  division?: string | null
  team?: string | null

  [key: string]: unknown
}
