export function getKstTodayDateString(): string {
  const now = new Date()
  const kst = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Seoul" }))
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
