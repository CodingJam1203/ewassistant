import type { WorkLocationTimeline } from './work-location-timeline'

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
  /** 출근보고 근무장소 타임라인 (신규, NULL 가능 — legacy 레코드는 NULL) */
  expected_work_location_timeline?: WorkLocationTimeline | null
  expected_work_location?: string | null
  expected_work_time?: string | null
  expected_start_date?: string | null
  [key: string]: unknown
}
