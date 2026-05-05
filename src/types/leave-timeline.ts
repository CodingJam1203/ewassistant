/**
 * 휴가/반차 타임라인 타입 정의
 *
 * 휴가는 근무지와 분리해서 leave_timeline에 저장.
 * 휴게처럼 실근무시간에서 차감되지만, 표시는 근무지와 별개로.
 *
 * 입력 매핑:
 *   휴가/연차      → full_day (09:00~18:00, 8h = 480분)
 *   오전반차/반차  → morning_half (09:00~14:00, 5h = 300분)
 *   오후반차       → afternoon_half (14:00~18:00, 4h = 240분)
 *
 * 휴가/반차는 30분 단위 시간 블록이므로 actualMinutes == roundedMinutes.
 */

export type LeaveType = 'full_day' | 'morning_half' | 'afternoon_half'

/** 한국어 표시 라벨 */
export const LEAVE_TYPE_LABELS: Record<LeaveType, string> = {
  full_day: '휴가',
  morning_half: '오전반차',
  afternoon_half: '오후반차',
}

/**
 * 각 휴가 타입의 시간 블록과 기본 차감 분.
 *
 * - startTime/endTime: 표시용 시간 폭 (예: 오전반차 09:00~14:00)
 * - defaultDeductionMinutes: 차감시간 select의 초기값 (사용자가 자유 조정 가능)
 *
 * 정책: 반차 = 4시간 차감 (점심시간 제외, 점심 1H는 EW 계산기가 자동 차감)
 */
export const LEAVE_TYPE_DEFINITIONS: Record<LeaveType, {
  startTime: string
  endTime: string
  defaultDeductionMinutes: number
}> = {
  full_day:       { startTime: '09:00', endTime: '18:00', defaultDeductionMinutes: 8 * 60 },  // 480
  morning_half:   { startTime: '09:00', endTime: '14:00', defaultDeductionMinutes: 4 * 60 },  // 240
  afternoon_half: { startTime: '14:00', endTime: '18:00', defaultDeductionMinutes: 4 * 60 },  // 240
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
}

export type LeaveTimeline = LeaveTimelineItem[]
