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
  [key: string]: unknown
}
