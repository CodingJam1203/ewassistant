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

/**
 * v1.75 — 시작/끝 시간 선택용 30분 step 옵션.
 *
 *   - LEAVE_START_HHMM_OPTIONS: 00:00 ~ 23:30 (48개)
 *   - LEAVE_END_HHMM_OPTIONS:   00:30 ~ 24:00 (48개) — 24:00은 자정(다음날 X) 표현
 *
 * UI dropdown 옵션으로 사용. 24:00 = 1440분 (다음날 00:00 의미가 아니라 그 날의 종료).
 */
function buildHhmmOptions(startMin: number, endMin: number): { value: string; label: string }[] {
  const opts: { value: string; label: string }[] = []
  for (let m = startMin; m <= endMin; m += 30) {
    const h  = Math.floor(m / 60)
    const mm = m % 60
    const label = `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
    opts.push({ value: label, label })
  }
  return opts
}

export const LEAVE_START_HHMM_OPTIONS = buildHhmmOptions(0, 23 * 60 + 30)
export const LEAVE_END_HHMM_OPTIONS   = buildHhmmOptions(30, 24 * 60)

/**
 * v1.75 — 휴가 시작/끝 + 점심포함 여부 → 실 휴가 분 계산.
 *
 *   실휴가(분) = (끝 - 시작) - (점심포함이면 60 else 0)
 *
 * 점심차감 조건: 시작 ≤ 12:00 AND 끝 ≥ 13:00 (12~13시 구간을 완전히 포함). 호출자가 사전
 * 검증해서 lunchIncluded=false로 호출하든지, 본 함수가 자체 가드. 본 함수는 자체 가드 —
 * 12~13시를 포함하지 않으면 lunchIncluded 무시.
 */
export function computeLeaveMinutes(
  startHhmm: string,
  endHhmm: string,
  lunchIncluded: boolean,
): number {
  const s = toMinutes(startHhmm)
  const e = toMinutes(endHhmm)
  if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) return 0
  const spansLunch = s <= 12 * 60 && e >= 13 * 60
  const lunchCut   = lunchIncluded && spansLunch ? 60 : 0
  return Math.max(0, e - s - lunchCut)
}

/**
 * v1.75 — 시작 시각 + 실 휴가 분 → leaveType 분류.
 *
 *   - 실휴가 ≥ 480 (8H)      → full_day
 *   - 시작 ≥ 13:00           → afternoon_half
 *   - else                   → morning_half
 *
 * EW 차감(v1.59 정책)은 full_day만 적용. 반차는 표시·캘린더·상태 용도.
 */
export function classifyLeaveTypeByRange(
  startHhmm: string,
  minutes: number,
): LeaveType | null {
  if (minutes <= 0) return null
  if (minutes >= 480) return 'full_day'
  const s = toMinutes(startHhmm)
  return s >= 13 * 60 ? 'afternoon_half' : 'morning_half'
}

// ─── 휴가: 파싱 / 빌드 ────────────────────────────────────────────────────────

/**
 * 한국어/캘린더 셀값에서 LeaveType 추출.
 *
 * v1.61.9 — Google Calendar (by_title) inferEventType의 VACATION_KEYWORDS와 통일.
 * 양쪽이 동일 키워드 셋을 인식하도록 매핑.
 *
 * 우선순위 (더 구체적인 매칭 먼저):
 *   1. '오전반차' → morning_half
 *   2. '오후반차' → afternoon_half
 *   3. '반반차'   → morning_half (2H 시간단위 — 새 정책상 EW 차감 0, 표시만)
 *   4. '반차' 단독 → morning_half (default 오전)
 *   5. full_day 그룹: 휴가 / 연차 / 연월차 / 월차 / 공가 / 안식월 / 오프
 *   6. 매칭 안 되면 null (휴가 아님)
 */
export function parseLeaveLabel(raw: string | null | undefined): LeaveType | null {
  const s = (raw ?? '').trim()
  if (!s) return null
  if (s.includes('오전반차')) return 'morning_half'
  if (s.includes('오후반차')) return 'afternoon_half'
  if (s.includes('반반차'))   return 'morning_half'  // 2H 시간단위
  if (s.includes('반차'))     return 'morning_half'  // 단독 → 오전 default
  if (
    s.includes('휴가') ||
    s.includes('연월차') ||  // '연차' 보다 먼저 검사 (연차 포함 substring이지만 isolation은 includes라 무관, 명시성 위해)
    s.includes('연차') ||
    s.includes('월차') ||
    s.includes('공가') ||
    s.includes('안식월') ||
    s.includes('오프')
  ) return 'full_day'
  return null
}

/**
 * LeaveType + 표시 라벨로 LeaveTimelineItem 생성.
 * - displayLabel은 사용자 입력값 보존용 (예: '연차'). 미지정 시 기본 라벨.
 * - deductionMinutes 미지정 시 LEAVE_TYPE_DEFINITIONS의 default 사용.
 *   사용자가 UI에서 차감시간을 조정한 경우 호출자가 직접 값을 넘김.
 *
 * v1.83 — startTime/endTime 사용자 입력 인자 추가. 누락 시 LEAVE_TYPE_DEFINITIONS fallback
 * (= 기존 row prefill 케이스 09:00~18:00 등 자연스럽게 동작). HH:mm 정규식 미통과면 같은 fallback.
 */
export function buildLeaveItem(
  leaveType: LeaveType,
  displayLabel?: string,
  source: LeaveTimelineItem['source'] = 'manual',
  deductionMinutes?: number,
  startTime?: string,
  endTime?: string,
): LeaveTimelineItem {
  const def = LEAVE_TYPE_DEFINITIONS[leaveType]
  const minutes = (typeof deductionMinutes === 'number' && deductionMinutes >= 0)
    ? deductionMinutes
    : def.defaultDeductionMinutes
  const start = startTime && LEAVE_HHMM_REGEX.test(startTime) ? startTime : def.startTime
  const end   = endTime   && LEAVE_HHMM_REGEX.test(endTime)   ? endTime   : def.endTime
  return {
    kind: 'leave',
    leaveType,
    label: displayLabel?.trim() || LEAVE_TYPE_LABELS[leaveType],
    startTime: start,
    endTime: end,
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

/**
 * v1.83 — 휴가 시각 검증 정규식. 일반 HH:mm + 자정 종료 표현 '24:00' 허용.
 * UI 종료 dropdown에 24:00이 마지막 옵션으로 들어가서 사용자가 선택 가능.
 */
const LEAVE_HHMM_REGEX = /^(?:(?:[01]\d|2[0-3]):[0-5]\d|24:00)$/

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
    const startOk = LEAVE_HHMM_REGEX.test(it.startTime)
    const endOk   = LEAVE_HHMM_REGEX.test(it.endTime)
    if (!startOk || !endOk) {
      errors.push({ message: '휴가 시간 형식이 올바르지 않습니다.', index: i })
    } else if (toMinutes(it.endTime) <= toMinutes(it.startTime)) {
      // v1.83 — 자정 넘김 불가. 끝 > 시작 강제.
      errors.push({ message: '휴가 종료 시간이 시작보다 늦어야 합니다.', index: i })
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
