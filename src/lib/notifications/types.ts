// ─── 이벤트 타입 ─────────────────────────────────────────────────────────────

export type EventType =
  | 'worklog_submitted'
  | 'worklog_updated'
  | 'worklog_deleted'
  | 'checkin_submitted'
  | 'location_changed'
  | 'break_started'
  | 'break_ended'
  | 'account_pending'
  | 'daily_checkin_reminder_20'
  | 'daily_checkin_reminder_22'
  | 'daily_morning_summary'

// ─── 페이로드 타입 ────────────────────────────────────────────────────────────

export interface WorklogNotifyPayload {
  name: string
  leaveDate: string                   // YYYY-MM-DD
  workTypeLabel: string
  workLocation: string
  startTime: string                   // HH:mm
  endTime: string                     // HH:mm
  breakTime: string                   // HH:mm or HH:mm:ss (DB 저장 형식)
  lateOrAttendanceStatus: string      // '예' | '아니오'
  previousReportTime?: string | null
  currentReportTime?: string | null
  lateReason?: string | null
  workContent?: string | null
  attendanceRecordType?: string | null
  expectedStartDate?: string | null   // 다음 출근 예정일
  expectedWorkTime?: string | null    // 다음 출근 예정 시각 HH:mm
  expectedWorkLocation?: string | null
}

export interface WorklogDeletedNotifyPayload {
  name: string
  leaveDate: string
  deletedByEmail: string
  workTypeLabel: string
  workLocation: string
  startTime: string
  endTime: string
  breakTime: string
  workContent?: string | null
}

export interface CheckinNotifyPayload {
  name: string
  date: string          // YYYY-MM-DD
  checkedInAt: string   // ISO 문자열
  workLocation: string
}

export interface LocationChangedNotifyPayload {
  name: string
  date: string
  previousLocation: string
  newLocation: string
  changedAt: string     // ISO 문자열
}

export interface BreakNotifyPayload {
  name: string
  date: string
  breakAt: string       // ISO 문자열
  workLocation: string
}

export interface AccountPendingNotifyPayload {
  name: string
  email: string
  createdAt: string     // ISO 문자열
}

export interface DailyCheckinReminderData {
  targetDate: string    // YYYY-MM-DD
  members: Array<{
    name: string
    status: string      // 미리 포맷된 상태 문자열
  }>
}

export interface MorningSummaryData {
  todayDate: string
  yesterdayDate: string
  todayCheckins: Array<{ name: string; status: string }>
  yesterdayWorkLogs: Array<{ name: string; status: string }>
}
