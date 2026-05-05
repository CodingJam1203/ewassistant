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
