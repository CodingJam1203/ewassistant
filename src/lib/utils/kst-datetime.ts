/**
 * KST 날짜(YYYY-MM-DD) + 시각(HH:mm)을 UTC ISO 문자열로 변환.
 *
 * 자정 넘김 표현('24:00'~'47:59', 예: '27:00' = 익일 03:00)을 정확히 다음 날로 환산한다.
 * `new Date(`${date}T27:00:00+09:00`)`는 Invalid Date가 되어 `.toISOString()`에서
 * RangeError("Invalid time value")를 던진다 (이정영 5/20 퇴근보고 500 근본원인 — 07:00~27:00
 * 야간 근무의 daily_work_status checked_out_at 생성에서 throw). 시각을 분으로 환산해
 * KST 자정 기준 timestamp에 가산하면 24h 초과도 안전하게 다음 날로 넘어간다.
 */
export function kstHHmmToIso(dateStr: string, hhmm: string): string {
  const [hStr, mStr] = (hhmm || '00:00').split(':')
  const h = parseInt(hStr, 10)
  const m = parseInt(mStr ?? '0', 10)
  const totalMin = (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0)
  const kstMidnightMs = new Date(`${dateStr}T00:00:00+09:00`).getTime()
  return new Date(kstMidnightMs + totalMin * 60_000).toISOString()
}
