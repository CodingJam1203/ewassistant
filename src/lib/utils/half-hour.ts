/**
 * 30분 단위 정책 — 단일 출처 헬퍼
 *
 * 정책:
 *   1. 모든 시간/분 단위 값은 30분(=1800초)의 배수여야 한다.
 *   2. UI는 30분 단위 옵션만 노출 (클라이언트 1차 방어).
 *   3. API는 저장 직전 본 헬퍼로 강제 (서버 2차 방어, fail-close).
 *   4. DB는 CHECK constraint로 최종 방어 (3차).
 *
 * 스냅 정책:
 *   - 'round' : 반올림  (15분 미만 → 0, 15분 이상 → 30) ← 기본
 *   - 'ceil'  : 올림    (1~30 → 30, 31~60 → 60, …)
 *   - 'floor' : 내림    (0~29 → 0, 30~59 → 30, …)
 *
 * 사용 예:
 *   snapMinutes(62)             // 60   (round)
 *   snapMinutes(62, 'ceil')     // 90
 *   snapMinutes(62, 'floor')    // 60
 *   snapHHmm('09:24')           // '09:30' (round)
 *   isHalfHour(62)              // false
 *   isHalfHour(60)              // true
 */

export type SnapMode = 'round' | 'ceil' | 'floor'

const HALF = 30

/** 분 단위 정수가 30분 배수인지 */
export function isHalfHour(minutes: number | null | undefined): boolean {
  if (typeof minutes !== 'number' || !Number.isFinite(minutes)) return false
  return Math.abs(minutes) % HALF === 0
}

/** 분 단위를 30분 배수로 스냅. 음수는 0으로. */
export function snapMinutes(
  minutes: number | null | undefined,
  mode: SnapMode = 'round',
): number {
  if (typeof minutes !== 'number' || !Number.isFinite(minutes) || minutes <= 0) return 0
  switch (mode) {
    case 'ceil':  return Math.ceil(minutes / HALF) * HALF
    case 'floor': return Math.floor(minutes / HALF) * HALF
    default:      return Math.round(minutes / HALF) * HALF
  }
}

/** "HH:MM" → 분. 잘못된 형식이면 null. (24+ 명일 시간 허용) */
export function hhmmToMinutes(hhmm: string | null | undefined): number | null {
  if (!hhmm || typeof hhmm !== 'string') return null
  const m = hhmm.match(/^(\d{1,2}):(\d{1,2})(?::\d{1,2})?$/)
  if (!m) return null
  const h  = parseInt(m[1], 10)
  const mi = parseInt(m[2], 10)
  if (!Number.isFinite(h) || !Number.isFinite(mi)) return null
  if (mi < 0 || mi > 59) return null
  return h * 60 + mi
}

/** 분 → "HH:MM" (00~36시 명일까지). 음수는 "00:00". */
export function minutesToHHmm(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes < 0) return '00:00'
  const h  = Math.floor(minutes / 60)
  const mi = minutes % 60
  return `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`
}

/** "HH:MM"을 30분 단위로 스냅 (24+ 명일 시간 보존). 잘못된 형식이면 입력 그대로. */
export function snapHHmm(hhmm: string, mode: SnapMode = 'round'): string {
  const total = hhmmToMinutes(hhmm)
  if (total === null) return hhmm
  return minutesToHHmm(snapMinutes(total, mode))
}

/** "HH:MM"이 30분 단위인지 (분이 00 또는 30) */
export function isHalfHourHHmm(hhmm: string | null | undefined): boolean {
  const total = hhmmToMinutes(hhmm ?? '')
  if (total === null) return false
  return total % HALF === 0
}

/** PG interval text/HH:MM:SS/HH:MM/숫자 → 분 정수 (work-hours.ts와 호환) */
export function anyToMinutes(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0
  if (typeof value === 'number') return Math.max(0, Math.round(value))
  if (typeof value !== 'string') return 0
  const trimmed = value.trim()
  if (!trimmed) return 0
  if (/^\d{1,3}:\d{1,2}(:\d{1,2})?$/.test(trimmed)) {
    const parts = trimmed.split(':').map(s => parseInt(s, 10))
    return Math.max(0, (parts[0] || 0) * 60 + (parts[1] || 0))
  }
  let total = 0
  const dayM = trimmed.match(/(\d+)\s*day/)
  if (dayM) total += parseInt(dayM[1], 10) * 24 * 60
  const t = trimmed.match(/(\d+):(\d{1,2})(?::(\d{1,2}))?/)
  if (t) total += parseInt(t[1], 10) * 60 + parseInt(t[2], 10)
  return Math.max(0, total)
}
