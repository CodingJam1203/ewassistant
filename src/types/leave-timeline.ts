/**
 * 휴가 타임라인 타입 정의
 *
 * 휴가는 근무지와 분리해서 leave_timeline에 저장.
 * 휴게처럼 실근무시간에서 차감되지만, 표시는 근무지와 별개로.
 *
 * v1.83.3 정책 (사용자 결정):
 *   - 사용자 직접 입력(LeaveTimelineInput): 8H = full_day, 그 외 = hourly (반차 분류 안 만듦)
 *   - Google 캘린더 종일 박스: 텍스트 기반 (휴가/오전반차/오후반차/반차)
 *   - Google 캘린더 시간 박스: 시간 우선 (8H 정확 = full_day, 그 외 = hourly, 텍스트 무시)
 *   - 시트: 텍스트 기반 그대로 (시간 정보 없음)
 *
 * 휴가는 30분 단위 시간 블록이므로 actualMinutes == roundedMinutes.
 */

export type LeaveType = 'full_day' | 'morning_half' | 'afternoon_half' | 'hourly'

/**
 * 한국어 표시 라벨.
 * morning_half/afternoon_half는 시트·Google 종일 박스의 반차 텍스트 sync 용도로 유지.
 * hourly는 사용자 직접 입력 + Google 시간 박스에서 생성되는 신규 타입.
 */
export const LEAVE_TYPE_LABELS: Record<LeaveType, string> = {
  full_day: '휴가',
  morning_half: '오전반차',
  afternoon_half: '오후반차',
  hourly: '시간 휴가',
}

/**
 * 각 휴가 타입의 시간 블록과 기본 차감 분.
 *
 * - startTime/endTime: 표시용 시간 폭 (실제 row에는 사용자 입력 시각 박힘)
 * - defaultDeductionMinutes: 차감시간 select의 초기값 (사용자가 자유 조정 가능)
 *
 * hourly default 09:00~10:00 (1H) — fallback일 뿐, 실제 row는 항상 호출자가 명시.
 */
export const LEAVE_TYPE_DEFINITIONS: Record<LeaveType, {
  startTime: string
  endTime: string
  defaultDeductionMinutes: number
}> = {
  full_day:       { startTime: '09:00', endTime: '18:00', defaultDeductionMinutes: 8 * 60 },  // 480
  morning_half:   { startTime: '09:00', endTime: '14:00', defaultDeductionMinutes: 4 * 60 },  // 240 (legacy)
  afternoon_half: { startTime: '14:00', endTime: '18:00', defaultDeductionMinutes: 4 * 60 },  // 240 (legacy)
  hourly:         { startTime: '09:00', endTime: '10:00', defaultDeductionMinutes: 60 },      // fallback
}

/** 한 항목의 휴가/반차 정보 */
export interface LeaveTimelineItem {
  kind: 'leave'
  leaveType: LeaveType
  /** 표시용 라벨 — 예: '오전반차', '연차' (사용자 입력 보존 가능) */
  label: string
  /** 'HH:mm' */
  startTime: string
  /** 'HH:mm' */
  endTime: string
  /** 실제 분 수 (30분 단위 블록이라 startTime~endTime 폭과 동일) */
  actualMinutes: number
  /** 계산 반영 분 수 (휴가는 actualMinutes와 같음) */
  roundedMinutes: number
  /** 입력 출처 */
  source?: 'manual' | 'calendar' | 'expected'
  /**
   * Phase 1.5b — Google Calendar 휴가 캘린더에 push된 이벤트의 plain id.
   * N-Click → Google push 후 채워짐. 수정/삭제 시 같은 id로 events.update/delete 호출.
   * 양방향 sync 식별 키로도 사용 (reverse hook에서 매칭).
   */
  google_event_id?: string
}

export type LeaveTimeline = LeaveTimelineItem[]
