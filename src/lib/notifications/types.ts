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
  leaveDate: string
  workTypeLabel: string
  workLocation: string
  startTime: string
  endTime: string
  breakTime: string
  lateOrAttendanceStatus: string
  previousReportTime?: string | null
  currentReportTime?: string | null
  lateReason?: string | null
  workContent?: string | null
  attendanceRecordType?: string | null
  expectedStartDate?: string | null
  expectedWorkTime?: string | null
  expectedWorkLocation?: string | null
  division?: string | null
  team?: string | null
}

export interface ChangedField {
  label: string
  before: string
  after: string
}

export interface WorklogUpdateNotifyPayload {
  name: string
  leaveDate: string
  division?: string | null
  team?: string | null
  updatedByEmail: string
  originalReportType: '출근보고' | '퇴근보고'
  scheduledWorkDate?: string | null
  changedFields: ChangedField[]
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
  division?: string | null
  team?: string | null
}

export interface CheckinNotifyPayload {
  name: string
  date: string
  checkedInAt: string
  workLocation: string
  division?: string | null
  team?: string | null
}

export interface LocationChangedNotifyPayload {
  name: string
  date: string
  previousLocation: string
  newLocation: string
  changedAt: string
  division?: string | null
  team?: string | null
}

export interface BreakNotifyPayload {
  name: string
  date: string
  breakAt: string
  workLocation: string
  division?: string | null
  team?: string | null
}

export interface AccountPendingNotifyPayload {
  name: string
  email: string
  createdAt: string
}

export interface DailyCheckinReminderData {
  division: string           // 라우팅용
  team: string               // 라우팅용
  targetDate: string
  members: Array<{
    name: string
    status: string
  }>
}

export interface MorningSummaryData {
  division: string           // 라우팅용
  team: string               // 라우팅용
  todayDate: string
  yesterdayDate: string
  todayCheckins: Array<{ name: string; status: string }>
  yesterdayWorkLogs: Array<{ name: string; status: string }>
}
