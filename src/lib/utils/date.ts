export function getKstTodayDateString(): string {
  const now = new Date()
  const kst = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Seoul" }))
  const y = kst.getFullYear()
  const m = String(kst.getMonth() + 1).padStart(2, "0")
  const d = String(kst.getDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}

/** 근무일 경계 시각 (KST). 이 시각 전이면 전날을 근무일로 본다. (2026-05-22 정책) */
export const WORK_DAY_BOUNDARY_HOUR = 7

/**
 * 근무일(business day) 기준 KST 날짜 'YYYY-MM-DD'.
 * 새벽 boundaryHour시 전이면 전날을 반환 — 자정~07시 새벽 근무를 전날 근무의 연장으로 본다.
 *   예(07시 경계): 05-23 06:30 → '2026-05-22', 05-23 07:00 → '2026-05-23'.
 * 용도: 퇴근누락(미보고) 판정 게이트 · 퇴근보고 폼의 "당일" 판정(출근보고 동시 노출).
 * 주의: 출근(체크인)·팀 현황 보드의 "오늘"에는 적용하지 않는다 (조기출근 오기입 방지).
 */
export function getKstWorkDateString(boundaryHour: number = WORK_DAY_BOUNDARY_HOUR): string {
  const now = new Date()
  const kst = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Seoul" }))
  if (kst.getHours() < boundaryHour) {
    kst.setDate(kst.getDate() - 1)
  }
  const y = kst.getFullYear()
  const m = String(kst.getMonth() + 1).padStart(2, "0")
  const d = String(kst.getDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}

export function toKstDateString(date: Date | string): string {
  const source = typeof date === "string" ? new Date(date) : date
  const kst = new Date(source.toLocaleString("en-US", { timeZone: "Asia/Seoul" }))
  const y = kst.getFullYear()
  const m = String(kst.getMonth() + 1).padStart(2, "0")
  const d = String(kst.getDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}

/** 'YYYY-MM-DD'가 토(6)/일(0)요일이면 true. 달력 날짜 기준(TZ 무관). */
export function isWeekendDate(dateStr: string): boolean {
  const [y, m, d] = (dateStr ?? '').split('-').map(Number)
  if (!y || !m || !d) return false
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  return dow === 0 || dow === 6
}

/** 'YYYY-MM-DD' 또는 Date → '월','화',...,'일'. 잘못된 입력은 빈 문자열. */
export function dowKo(input: string | Date | null | undefined): string {
  if (!input) return ''
  const d = typeof input === 'string'
    ? new Date(input + 'T00:00:00')
    : input
  if (isNaN(d.getTime())) return ''
  const labels = ['일', '월', '화', '수', '목', '금', '토']
  return labels[d.getDay()]
}
