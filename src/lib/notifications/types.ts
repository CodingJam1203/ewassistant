import type { WorkLocationTimeline } from '@/types/work-location-timeline'
import type { LeaveTimeline } from '@/types/leave-timeline'

// ─── 이벤트 타입 ─────────────────────────────────────────────────────────────

export type EventType =
  | 'worklog_submitted'
  | 'checkout_resubmitted'
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
  /** legacy 단일 라벨. 메시지 표시는 workLocationTimeline 우선 사용 */
  workLocation: string
  /** 본문 근무장소 타임라인 (퇴근보고 — 마지막은 'checkout' kind). null이면 단일 workLocation으로 fallback. */
  workLocationTimeline?: WorkLocationTimeline | null
  /** 본문 휴가/반차 타임라인 */
  leaveTimeline?: LeaveTimeline | null
  /** 휴게 자동 누적 실제 분 */
  breakAutoActualMinutes?: number | null
  /** 휴게 자동 30분 올림 분 */
  breakAutoRoundedMinutes?: number | null
  /** EW 계산에 실제 사용된 휴게 분 */
  breakFinalRoundedMinutes?: number | null
  /** 사용자가 휴게시간을 수정했는지 (Teams 메시지 표시용) */
  breakIsManual?: boolean
  /** 실근무시간 (분 단위) — Teams 메시지 표시용 */
  actualWorkMinutes?: number | null
  /** 휴가 차감 분 (Teams 메시지 표시용) */
  leaveMinutes?: number | null
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
  /**
   * 다음 출근 예정 타임라인 (마지막은 'expected_checkout' kind).
   * undefined/null이면 기존 expectedWorkLocation/expectedWorkTime로 fallback.
   */
  expectedTimeline?: WorkLocationTimeline | null
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
  scheduledWorkTime?: string | null
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
  /** 출근 시점의 work_location_timeline (멀티라인 메시지 표시용) */
  timeline?: WorkLocationTimeline | null
  /** 출근 시점의 leave_timeline (휴가/반차) */
  leaveTimeline?: LeaveTimeline | null
  division?: string | null
  team?: string | null
}

export interface LocationChangedNotifyPayload {
  name: string
  date: string
  previousLocation: string
  newLocation: string
  changedAt: string
  /** 변경 후 work_location_timeline (멀티라인 메시지 표시용) */
  timeline?: WorkLocationTimeline | null
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
    division: string
    team: string
    scheduledWorkDate: string
    scheduledWorkTime: string
    scheduledWorkLocation: string
    attendanceRecordType: string
    status: string // fallback display string
  }>
}

export interface MorningSummaryData {
  division: string           // 라우팅용
  team: string               // 라우팅용
  todayDate: string
  yesterdayDate: string

  /** 🏖️ 오늘 휴가/반차자 (종일/오전/오후) */
  leaveSection?: Array<{ name: string; label: string; leaveType: 'full_day' | 'morning_half' | 'afternoon_half' }>
  /** ✅ 오늘 출근보고 작성 완료 */
  completedSection?: Array<{ name: string; status: string }>
  /** ⚠️ 오늘 출근보고 필요 (휴가 없음/오후반차자 + 미작성) */
  needSection?: Array<{ name: string }>
  /** 🕐 오후 출근보고 필요 (오전반차 + 미작성) */
  needAfterSection?: Array<{ name: string; label: string }>

  /** 어제 퇴근보고 요약 (기존 표시 유지) */
  yesterdayWorkLogs: Array<{ name: string; status: string }>
  /** @deprecated legacy — 기존 메시지 빌더 호환용. 신규 코드는 completedSection 사용 */
  todayCheckins: Array<{ name: string; status: string }>
}
