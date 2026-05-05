/**
 * 휴가/반차 + 휴게 계산 헬퍼
 *
 * - 휴가: parseLeaveLabel, buildLeaveItem, validateLeaveTimeline,
 *         totalLeaveRoundedMinutes, leaveIncludesLunch, formatLeaveLine
 * - 휴게: ceilTo30Min, calculateBreakAutoMinutesFromIso, breakRoundedFromActual
 */

import {
  LEAVE_TYPE_DEFINITIONS,
  LEAVE_TYPE_LABELS,
  type LeaveTimeline,
  type LeaveTimelineItem,
  type LeaveType,
} from '@/types/leave-timeline'

// ─── 휴가: 파싱 / 빌드 ────────────────────────────────────────────────────────

/**
 * 한국어/캘린더 셀값에서 LeaveType 추출.
 * 우선순위:
 *   1. '오전반차' 정확 매칭
 *   2. '오후반차' 정확 매칭
 *   3. '반차' 단독 → 오전반차로 처리
 *   4. '휴가' 또는 '연차' → 종일 휴가
 *   5. 매칭 안 되면 null (휴가 아님)
 */
export function parseLeaveLabel(raw: string | null | undefined): LeaveType | null {
  const s = (raw ?? '').trim()
  if (!s) return null
  if (s.includes('오전반차')) return 'morning_half'
  if (s.includes('오후반차')) return 'afternoon_half'
  if (s.includes('반차'))     return 'morning_half'  // 반차만 있으면 오전반차로
  if (s.includes('휴가') || s.includes('연차')) return 'full_day'
  return null
}

/**
 * LeaveType + 표시 라벨로 LeaveTimelineItem 생성.
 * - displayLabel은 사용자 입력값 보존용 (예: '연차'). 미지정 시 기본 라벨.
 */
export function buildLeaveItem(
  leaveType: LeaveType,
  displayLabel?: string,
  source: LeaveTimelineItem['source'] = 'manual'
): LeaveTimelineItem {
  const def = LEAVE_TYPE_DEFINITIONS[leaveType]
  return {
    kind: 'leave',
    leaveType,
    label: displayLabel?.trim() || LEAVE_TYPE_LABELS[leaveType],
    startTime: def.startTime,
    endTime: def.endTime,
    actualMinutes: def.minutes,
    roundedMinutes: def.minutes,
    source,
  }
}

// ─── 휴가: 검증 ────────────────────────────────────────────────────────────────

export interface LeaveValidationError {
  message: string
  index?: number
}

const TIME_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/

export function validateLeaveTimeline(timeline: LeaveTimeline): LeaveValidationError[] {
  const errors: LeaveValidationError[] = []
  if (!Array.isArray(timeline)) return errors

  // 종일 휴가는 오직 1개만 가능
  const fullDays = timeline.filter(it => it.leaveType === 'full_day')
  if (fullDays.length > 1) {
    errors.push({ message: '종일 휴가는 하나만 등록할 수 있습니다.' })
  }
  // 종일 휴가가 있으면 다른 항목은 안 됨
  if (fullDays.length >= 1 && timeline.length > 1) {
    errors.push({ message: '종일 휴가가 있을 때는 다른 휴가/반차 항목을 함께 등록할 수 없습니다.' })
  }

  // 오전반차 / 오후반차 각각 최대 1개
  if (timeline.filter(it => it.leaveType === 'morning_half').length > 1) {
    errors.push({ message: '오전반차는 하나만 등록할 수 있습니다.' })
  }
  if (timeline.filter(it => it.leaveType === 'afternoon_half').length > 1) {
    errors.push({ message: '오후반차는 하나만 등록할 수 있습니다.' })
  }

  timeline.forEach((it, i) => {
    if (!TIME_REGEX.test(it.startTime) || !TIME_REGEX.test(it.endTime)) {
      errors.push({ message: '휴가 시간 형식이 올바르지 않습니다.', index: i })
    }
    if (typeof it.roundedMinutes !== 'number' || it.roundedMinutes < 0) {
      errors.push({ message: '휴가 분 계산값이 올바르지 않습니다.', index: i })
    }
  })

  return errors
}

// ─── 휴가: 계산 / 표시 ─────────────────────────────────────────────────────────

/** 휴가 항목들의 총 차감 분 */
export function totalLeaveRoundedMinutes(timeline: LeaveTimeline | null | undefined): number {
  if (!Array.isArray(timeline)) return 0
  return timeline.reduce((sum, it) => sum + (it.roundedMinutes ?? 0), 0)
}

/** 휴가 시간 범위 중 어느 하나라도 점심시간(12:00~13:00)을 포함하는지 */
export function leaveIncludesLunch(timeline: LeaveTimeline | null | undefined): boolean {
  if (!Array.isArray(timeline)) return false
  for (const it of timeline) {
    const startMin = toMinutes(it.startTime)
    const endMin   = toMinutes(it.endTime)
    // 점심 12:00~13:00을 완전히 포함하면 true
    if (startMin <= 12 * 60 && endMin >= 13 * 60) return true
  }
  return false
}

/** 종일 휴가 여부 */
export function isFullDayLeave(timeline: LeaveTimeline | null | undefined): boolean {
  if (!Array.isArray(timeline)) return false
  return timeline.some(it => it.leaveType === 'full_day')
}

/** Teams/UI 표시용 한 줄 — 예: "오전반차 09:00~14:00", "휴가 09:00~18:00" */
export function formatLeaveItemLine(item: LeaveTimelineItem): string {
  return `${item.label} ${item.startTime}~${item.endTime}`
}

/** Teams 메시지용 라인 배열 */
export function formatLeaveLines(timeline: LeaveTimeline | null | undefined): string[] {
  if (!Array.isArray(timeline) || timeline.length === 0) return []
  return timeline.map(formatLeaveItemLine)
}

// ─── 휴게: 시간 계산 ──────────────────────────────────────────────────────────

/**
 * 30분 단위 올림.
 *   1~30분 → 30
 *   31~60분 → 60
 *   61~90분 → 90 …
 *   0 또는 음수 → 0
 */
export function ceilTo30Min(minutes: number): number {
  if (!Number.isFinite(minutes) || minutes <= 0) return 0
  return Math.ceil(minutes / 30) * 30
}

/** 휴게 시작/종료 ISO 시각 → 누적 실제 분 */
export function calculateBreakAutoMinutesFromIso(
  breakStartIso: string | null | undefined,
  breakEndIso: string | null | undefined
): number {
  if (!breakStartIso || !breakEndIso) return 0
  const start = new Date(breakStartIso).getTime()
  const end   = new Date(breakEndIso).getTime()
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0
  return Math.floor((end - start) / 60_000)
}

/**
 * 자동 누적 actualMinutes에 새 휴게 1회분 actual을 더해서
 * autoActual / autoRounded 한 쌍을 반환.
 */
export function accumulateBreakAuto(
  prevActual: number | null | undefined,
  newActualToAdd: number
): { actual: number; rounded: number } {
  const prev = Number.isFinite(prevActual as number) ? Number(prevActual) : 0
  const total = prev + Math.max(0, newActualToAdd)
  return {
    actual: total,
    rounded: ceilTo30Min(total),
  }
}

/** 'HH:mm' or 'HH:mm:ss' → 분 단위 정수 */
function toMinutes(hhmm: string): number {
  const parts = (hhmm ?? '').split(':')
  const h = parseInt(parts[0] ?? '0', 10)
  const m = parseInt(parts[1] ?? '0', 10)
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0)
}

/** 분(int) → 'H:MM' 표시 (예: 300 → '5:00') */
export function minutesToDisplay(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return '0:00'
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${h}:${String(m).padStart(2, '0')}`
}
