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

// ─── 휴가: 시간(분) ↔ 유형 매핑 ──────────────────────────────────────────────

/**
 * 휴가 시간(분) → leaveType 자동 매핑.
 * 정규 근무 길이(480min = 8h)일 때만 full_day. 그 외(30~450min)는 morning_half.
 *
 * v1.59 (2026-05-30): 8H 미만(반차/시간단위) 휴가는 EW/실근무 시간 차감에서 제외됨.
 * leaveType은 표시(캘린더·둘러보기·상태) 및 Google 캘린더 push 용도로만 사용.
 * 사용자에게는 "8시간 미만 휴가는 휴게의 형태로 퇴근보고 시 직접 등록" 안내가 노출됨.
 */
export function minutesToLeaveType(minutes: number): LeaveType | null {
  if (minutes <= 0) return null
  if (minutes >= 480) return 'full_day'
  return 'morning_half'
}

/** 30분 단위 휴가 시간 옵션 — '휴가 없음'(0) + 00:30 ~ 08:00 (16개). */
export const LEAVE_TIME_OPTIONS: { minutes: number; label: string }[] = (() => {
  const opts: { minutes: number; label: string }[] = [{ minutes: 0, label: '휴가 없음' }]
  for (let m = 30; m <= 8 * 60; m += 30) {
    const h = Math.floor(m / 60)
    const mm = m % 60
    opts.push({
      minutes: m,
      label: `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`,
    })
  }
  return opts
})()

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
 * - deductionMinutes 미지정 시 LEAVE_TYPE_DEFINITIONS의 default 사용.
 *   사용자가 UI에서 차감시간을 조정한 경우 호출자가 직접 값을 넘김.
 */
export function buildLeaveItem(
  leaveType: LeaveType,
  displayLabel?: string,
  source: LeaveTimelineItem['source'] = 'manual',
  deductionMinutes?: number,
): LeaveTimelineItem {
  const def = LEAVE_TYPE_DEFINITIONS[leaveType]
  const minutes = (typeof deductionMinutes === 'number' && deductionMinutes >= 0)
    ? deductionMinutes
    : def.defaultDeductionMinutes
  return {
    kind: 'leave',
    leaveType,
    label: displayLabel?.trim() || LEAVE_TYPE_LABELS[leaveType],
    startTime: def.startTime,
    endTime: def.endTime,
    actualMinutes: minutes,    // 사용자가 조정 가능한 차감 시간
    roundedMinutes: minutes,
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
    } else if (it.roundedMinutes % 30 !== 0) {
      // 30분 단위 정책 — UI는 30분 step이지만 API 우회 / legacy 클라이언트 방어
      errors.push({ message: '휴가 차감시간은 30분 단위여야 합니다.', index: i })
    }
  })

  return errors
}

// ─── 휴가: 계산 / 표시 ─────────────────────────────────────────────────────────

/**
 * 휴가 항목들의 총 분 합계.
 *
 * 용도 — 통계/표시/알림(work-hours 통계, Teams 메시지 등). EW 계산용 차감 분은 별개 함수
 * [[effectiveLeaveDeductionMinutes]] 를 써야 한다 (v1.59부터 8H 미만은 EW에서 0).
 */
export function totalLeaveRoundedMinutes(timeline: LeaveTimeline | null | undefined): number {
  if (!Array.isArray(timeline)) return 0
  return timeline.reduce((sum, it) => sum + (it.roundedMinutes ?? 0), 0)
}

/**
 * EW/실근무 계산용 휴가 차감 분 (v1.59, 2026-05-30).
 *
 * 정책 — full_day(8H 종일 휴가)만 실근무에서 시간 차감. morning_half / afternoon_half /
 * 시간단위 휴가는 캘린더·둘러보기·상태에 표시는 유지하되 EW 계산에서는 0분으로 처리.
 * 8H 미만 휴가는 사용자가 퇴근보고 시 휴게로 직접 등록하는 워크플로우로 통일.
 *
 * calculateEw 호출처에서 input.leaveMinutes 값으로 이 함수의 결과를 넘겨야 한다.
 * 통계/알림 표시는 [[totalLeaveRoundedMinutes]] 를 그대로 사용한다.
 */
export function effectiveLeaveDeductionMinutes(timeline: LeaveTimeline | null | undefined): number {
  if (!Array.isArray(timeline)) return 0
  return timeline.reduce(
    (sum, it) => sum + (it.leaveType === 'full_day' ? (it.roundedMinutes ?? 0) : 0),
    0,
  )
}

/**
 * 8H 미만 휴가(반차/시간단위)가 timeline에 있는지 — 안내 멘트 노출 분기용.
 * full_day와 무관 (full_day는 별개 경로). v1.59.
 */
export function hasSubFullDayLeave(timeline: LeaveTimeline | null | undefined): boolean {
  if (!Array.isArray(timeline)) return false
  return timeline.some(it => it.leaveType !== 'full_day' && (it.roundedMinutes ?? 0) > 0)
}

/**
 * v1.59 안내 멘트 — LeaveTimelineInput inline notice (legacy).
 * v1.60부터 LeaveTimelineInput 자체는 출퇴근보고에서 hide → 이 상수는 LeaveTimelineInput 단독
 * 사용처(현재 없음)에 보존만. 폼에서는 [[buildSubFullDayLeaveNotice]] 가 동적 카피 사용.
 */
export const SUB_FULL_DAY_LEAVE_NOTICE =
  '8시간 미만의 휴가는 EW 시간에서 차감되지 않습니다. 휴게의 형태로 퇴근보고 시 직접 등록해주세요.'

/**
 * v1.60 — 8H 미만 휴가용 read-only 안내 카피 (출퇴근보고/출근완료 모달).
 * 예: "이 날 캘린더에 오전반차(4H) 등록됨. 휴게로 직접 입력해 주셔야 반영됩니다."
 */
export function buildSubFullDayLeaveNotice(label: string, minutes: number): string {
  return `이 날 캘린더에 ${label}(${formatHours(minutes)}H) 등록됨. 휴게로 직접 입력해 주셔야 반영됩니다.`
}

/**
 * v1.60 — copyText에 붙는 8H 미만 휴가 suffix.
 * 예: " // 🗓 캘린더상 오전반차(4H) — 휴게 등록 주의"
 * full_day만 있으면 null (기존 EW="휴가" 표시가 처리).
 */
export function buildLeaveCopyTextNotice(timeline: LeaveTimeline | null | undefined): string | null {
  const items = subFullDayLeaveItems(timeline)
  if (items.length === 0) return null
  const parts = items.map(it => `${it.label}(${formatHours(it.roundedMinutes ?? 0)}H)`).join(', ')
  return ` // 🗓 캘린더상 ${parts} — 휴게 등록 주의`
}

/** v1.60 — 8H 미만(반차/시간단위) 휴가 항목만 추려서 반환. 안내 박스/카피 생성용. */
export function subFullDayLeaveItems(timeline: LeaveTimeline | null | undefined): LeaveTimelineItem[] {
  if (!Array.isArray(timeline)) return []
  return timeline.filter(
    it => it.leaveType !== 'full_day' && (it.roundedMinutes ?? 0) > 0,
  )
}

/** v1.60 — full_day 휴가 항목만 추려서 반환. read-only 안내 박스용. */
export function fullDayLeaveItems(timeline: LeaveTimeline | null | undefined): LeaveTimelineItem[] {
  if (!Array.isArray(timeline)) return []
  return timeline.filter(it => it.leaveType === 'full_day')
}

/** 분을 H 단위로 — 정수면 "4", 0.5 단위면 "0.5". 30분 단위 정책상 0.5 step. */
function formatHours(minutes: number): string {
  const h = minutes / 60
  return Number.isInteger(h) ? String(h) : h.toFixed(1)
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
 *   0분(휴게 없음) → 0   ← 휴게 자체를 안 한 케이스는 그대로 0
 *   1~30분         → 30  ← 짧게라도 휴게했으면 최소 30분
 *   31~60분        → 60
 *   61~90분        → 90 …
 *   음수 / NaN     → 0
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
