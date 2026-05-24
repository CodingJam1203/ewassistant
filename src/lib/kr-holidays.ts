/**
 * 한국 공휴일 정적 데이터 (2024-2028).
 *
 * 임시공휴일/대체공휴일 포함. 정부 발표에 따라 매년 12월경 갱신 필요.
 *
 * 사용:
 *   isKoreanHoliday('2026-08-15')   // true
 *   isKoreanHoliday('2026-05-12')   // false
 *
 * 출처: 행정안전부 공휴일 발표, KASI 천문력
 */

// YYYY-MM-DD → 공휴일명 (한글)
const HOLIDAYS: Record<string, string> = {
  // 2024
  '2024-01-01': '신정',
  '2024-02-09': '설날 연휴',
  '2024-02-10': '설날',
  '2024-02-11': '설날 연휴',
  '2024-02-12': '설날 대체',
  '2024-03-01': '삼일절',
  '2024-04-10': '제22대 국회의원선거',
  '2024-05-05': '어린이날',
  '2024-05-06': '어린이날 대체',
  '2024-05-15': '부처님오신날',
  '2024-06-06': '현충일',
  '2024-08-15': '광복절',
  '2024-09-16': '추석 연휴',
  '2024-09-17': '추석',
  '2024-09-18': '추석 연휴',
  '2024-10-01': '국군의 날',
  '2024-10-03': '개천절',
  '2024-10-09': '한글날',
  '2024-12-25': '성탄절',

  // 2025
  '2025-01-01': '신정',
  '2025-01-27': '임시공휴일',
  '2025-01-28': '설날 연휴',
  '2025-01-29': '설날',
  '2025-01-30': '설날 연휴',
  '2025-03-01': '삼일절',
  '2025-03-03': '삼일절 대체',
  '2025-05-05': '어린이날 / 부처님오신날',
  '2025-05-06': '어린이날 대체',
  '2025-06-03': '제21대 대통령선거',
  '2025-06-06': '현충일',
  '2025-08-15': '광복절',
  '2025-10-03': '개천절',
  '2025-10-06': '추석 연휴',
  '2025-10-07': '추석',
  '2025-10-08': '추석 연휴',
  '2025-10-09': '한글날',
  '2025-12-25': '성탄절',

  // 2026 — 공휴일/대체공휴일 발표 기준 (변경 가능)
  '2026-01-01': '신정',
  '2026-02-16': '설날 연휴',
  '2026-02-17': '설날',
  '2026-02-18': '설날 연휴',
  '2026-03-01': '삼일절',
  '2026-03-02': '삼일절 대체',
  '2026-05-05': '어린이날',
  '2026-05-24': '부처님오신날',
  '2026-05-25': '부처님오신날 대체',
  '2026-06-06': '현충일',
  '2026-08-15': '광복절',
  '2026-08-17': '광복절 대체',
  '2026-09-24': '추석 연휴',
  '2026-09-25': '추석',
  '2026-09-26': '추석 연휴',
  '2026-10-03': '개천절',
  '2026-10-05': '개천절 대체',
  '2026-10-09': '한글날',
  '2026-12-25': '성탄절',

  // 2027 — 잠정 (정부 발표 후 확정)
  '2027-01-01': '신정',
  '2027-02-06': '설날 연휴',
  '2027-02-07': '설날',
  '2027-02-08': '설날 연휴',
  '2027-02-09': '설날 대체',
  '2027-03-01': '삼일절',
  '2027-05-05': '어린이날',
  '2027-05-13': '부처님오신날',
  '2027-06-06': '현충일',
  '2027-06-07': '현충일 대체',
  '2027-08-15': '광복절',
  '2027-08-16': '광복절 대체',
  '2027-09-14': '추석 연휴',
  '2027-09-15': '추석',
  '2027-09-16': '추석 연휴',
  '2027-10-03': '개천절',
  '2027-10-04': '개천절 대체',
  '2027-10-09': '한글날',
  '2027-10-11': '한글날 대체',
  '2027-12-25': '성탄절',
}

/** YYYY-MM-DD 문자열이 한국 공휴일이면 공휴일명, 아니면 null */
export function getKoreanHolidayName(dateStr: string): string | null {
  return HOLIDAYS[dateStr] ?? null
}

/** YYYY-MM-DD 문자열이 한국 공휴일이면 true */
export function isKoreanHoliday(dateStr: string): boolean {
  return dateStr in HOLIDAYS
}

/** 토요일 판정 — Date를 KST 기준 요일로 환산 */
export function isSaturday(dateStr: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false
  const [y, m, d] = dateStr.split('-').map(Number)
  // KST 정오 기준 요일 판정 (UTC 변환 영향 회피)
  return new Date(Date.UTC(y, m - 1, d, 3, 0, 0)).getUTCDay() === 6
}

/** 일요일 판정 */
export function isSunday(dateStr: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d, 3, 0, 0)).getUTCDay() === 0
}

/**
 * 날짜에 권장되는 근무유형 카테고리.
 *
 * 토요일이 동시에 공휴일인 경우 — '토요일' 룰 우선 (사용자 결정 E1)
 */
export type DateCategory = 'weekday' | 'saturday' | 'sunday_or_holiday'

export function categorizeDate(dateStr: string): DateCategory {
  if (isSaturday(dateStr)) return 'saturday'
  if (isSunday(dateStr) || isKoreanHoliday(dateStr)) return 'sunday_or_holiday'
  return 'weekday'
}

/**
 * YYYY-MM-DD에서 다음 영업일(토/일/한국 공휴일이 아닌 첫 날짜) 반환.
 * 출근보고 prefill default용 — "금요일에 퇴근+다음날 출근 콤보 제출 시 토요일이 아니라 월요일"처럼
 * 보통 출근하지 않는 날을 건너뛴다. 사용자가 주말 출근 등 다른 일자에 출근 예정이면 폼에서 수동 변경.
 *
 * 안전 가드 — 무한 루프 방지로 최대 14일까지만 점프(공휴일 연휴 등 현실적 상한). 그 안에 영업일을 못 찾으면 +1일을 그대로 반환.
 */
export function nextBusinessDay(dateStr: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr
  const [y, m, d] = dateStr.split('-').map(Number)
  const MAX_HOPS = 14
  for (let i = 1; i <= MAX_HOPS; i++) {
    const utc = new Date(Date.UTC(y, m - 1, d + i, 3, 0, 0))
    const yy = utc.getUTCFullYear()
    const mm = String(utc.getUTCMonth() + 1).padStart(2, '0')
    const dd = String(utc.getUTCDate()).padStart(2, '0')
    const next = `${yy}-${mm}-${dd}`
    if (!isSaturday(next) && !isSunday(next) && !isKoreanHoliday(next)) {
      return next
    }
  }
  // fallback — 14일 안에 영업일을 못 찾는 비현실 케이스: +1일 그대로
  const fallback = new Date(Date.UTC(y, m - 1, d + 1, 3, 0, 0))
  return `${fallback.getUTCFullYear()}-${String(fallback.getUTCMonth() + 1).padStart(2, '0')}-${String(fallback.getUTCDate()).padStart(2, '0')}`
}
