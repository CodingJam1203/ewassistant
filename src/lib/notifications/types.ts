import type { WorkLocationTimeline } from '@/types/work-location-timeline'
import type { WorkLocations } from '@/types/work-locations-v2'
import type { LeaveTimeline } from '@/types/leave-timeline'

// ─── 이벤트 타입 ─────────────────────────────────────────────────────────────

export type EventType =
  | 'worklog_submitted'
  | 'checkout_resubmitted'
  | 'worklog_updated'           // @deprecated — 호환용. 신규 코드는 worklog_updated_checkin/_checkout 사용
  | 'worklog_updated_checkin'   // 출근보고 수정 → 출근보고 채널
  | 'worklog_updated_checkout'  // 퇴근보고 수정 → 퇴근보고 채널
  | 'worklog_deleted'
  | 'checkin_submitted'
  | 'location_changed'
  | 'break_started'
  | 'break_ended'
  | 'account_pending'
  | 'daily_checkin_reminder_20'
  | 'daily_checkin_reminder_22'
  | 'daily_morning_summary'
  | 'missing_report_nudge'      // 미보고 현황에서 리더/관리자가 수동 발송하는 알림

// ─── 페이로드 타입 ────────────────────────────────────────────────────────────

export interface WorklogNotifyPayload {
  name: string
  leaveDate: string
  workTypeLabel: string
  /** legacy 단일 라벨. 메시지 표시는 workLocationTimeline 우선 사용 */
  workLocation: string
  /** 본문 근무장소 타임라인 (퇴근보고 — 마지막은 'checkout' kind). null이면 단일 workLocation으로 fallback. */
  workLocationTimeline?: WorkLocationTimeline | null
  /** v2: 본문 실제 근무장소 칩 배열. 메시지 표시는 이쪽이 최우선. */
  actualWorkLocations?: WorkLocations | null
  /** 본문 휴가/반차 타임라인 */
  leaveTimeline?: LeaveTimeline | null
  /** 휴게 자동 누적 실제 분 */
  breakAutoActualMinutes?: number | null
  /** 휴게 자동 30분 올림 분 */
  breakAutoRoundedMinutes?: number | null
  /** EW 계산에 실제 사용된 휴게 분 (= 점심 외 추가 휴게) */
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
  /** v2: 다음 출근 예정 근무장소 칩 배열. 메시지 표시는 이쪽이 최우선. */
  plannedWorkLocations?: WorkLocations | null
  division?: string | null
  team?: string | null
}

/**
 * 수정된 필드 1건. kind로 출근/퇴근 분류.
 *
 * - 'check_in'  : 출근보고 영역 필드 (expected_*)
 * - 'check_out' : 퇴근보고 영역 필드 (실근무 + 메타 필드)
 *
 * 라우팅과 메시지 헤더 분기에 사용.
 */
export interface ChangedField {
  label: string
  before: string
  after: string
  kind: 'check_in' | 'check_out'
}

export interface WorklogUpdateNotifyPayload {
  name: string
  leaveDate: string
  division?: string | null
  team?: string | null
  /** 수정자 표시명 (이름 우선, 없으면 식별자). 이메일은 절대 노출하지 않음 */
  updatedByName: string
  originalReportType: '출근보고' | '퇴근보고'
  scheduledWorkDate?: string | null
  scheduledWorkTime?: string | null
  changedFields: ChangedField[]
}

export interface WorklogDeletedNotifyPayload {
  name: string
  leaveDate: string
  /** 삭제자 표시명 (이름 우선, 없으면 식별자). 이메일은 절대 노출하지 않음 */
  deletedByName: string
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
  /** v2: 출근 시점의 예정 근무장소 칩 배열 (메시지 표시 최우선) */
  plannedWorkLocations?: WorkLocations | null
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
  /** v2: 변경 후 actual chips 배열 (메시지 표시 최우선) */
  actualWorkLocations?: WorkLocations | null
  /** v2: 현재 위치(★) 라벨 — chips 중 어느 것이 ★인지 표시 */
  currentLabel?: string | null
  /** v2: 현재 위치(★) 칩 index — 같은 라벨 칩이 여러 개일 때 정확한 식별 */
  currentIndex?: number | null
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
  /** 내부 식별용 (서버 로그/관리자 페이지 link)에만 사용. 메시지 본문에는 노출 금지 */
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
    /** 다음날 출근보고 작성됨 여부 — 1줄 per person 새 포맷에서 ✅/⚠️ 표식 */
    hasReport?: boolean
  }>
  /**
   * 22시 알림에 추가되는 내일 캘린더 일정 (휴가 제외).
   * 20시 알림에서는 비어있거나 undefined.
   */
  calendarEvents?: Array<{
    name: string
    startTime: string | null  // HH:mm 또는 null (종일)
    endTime: string | null
    title: string
  }>
}

/**
 * 미보고 알림 — 수동 발송.
 * 미보고 현황 탭에서 리더/관리자가 [팀즈 알림] 버튼을 누르면 해당 사용자의
 * 팀 출근/퇴근보고 채널 스레드에 reply로 발송됨.
 */
export interface MissingReportNudgePayload {
  name: string
  /** 미보고 일자 (YYYY-MM-DD) */
  date: string
  /** 무엇이 누락됐는지 */
  missingType: 'missing_all' | 'missing_checkout'
  division: string
  team: string
  /** 알림을 보낸 사람 표시명 (이메일 노출 금지) */
  senderName: string
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
  yesterdayWorkLogs: Array<{
    name: string
    status: string
    /** 야근 여부 — EW 실근무 8시간(=480분) 초과 (정확히 480분은 야근 아님) */
    isOvertime?: boolean
  }>
  /** @deprecated legacy — 기존 메시지 빌더 호환용. 신규 코드는 completedSection 사용 */
  todayCheckins: Array<{ name: string; status: string }>
}
