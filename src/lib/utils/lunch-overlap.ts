/**
 * 휴게 시간이 EW 점심시간(12:00~13:00 KST)과 겹친 분 계산.
 *
 * 회사 EW 시스템은 12~13시를 무조건 점심으로 자동 차감 (deduction 60분).
 * 사용자가 그 시간대에 휴게를 잡으면 점심 자동 차감 + 휴게 누적 → 이중 차감 손해.
 *
 * 정책 v1.65: 휴게 종료 시점에 겹침 분이 0보다 크면 사용자에게 모달로 확인:
 *   - "점심으로 처리": 겹친 분은 break_auto 누적에서 제외 (점심으로 흡수)
 *   - "별도 휴게로 누적": 그대로 누적 (사용자가 점심을 따로 가짐을 명시)
 *
 * 점심시간 정의: 12:00~13:00 KST 고정 (v1.64 정책과 동일).
 */

const LUNCH_START_KST_MIN = 12 * 60  // 12:00 KST = 720분
const LUNCH_END_KST_MIN   = 13 * 60  // 13:00 KST = 780분

/** ISO datetime → 그 날짜의 KST 분(0~1439). */
function isoToKstMinuteOfDay(iso: string): number {
  const d = new Date(iso)
  // UTC + 9시간 = KST. getUTCHours/Minutes로 KST 시각 추출.
  const kstDate = new Date(d.getTime() + 9 * 60 * 60 * 1000)
  return kstDate.getUTCHours() * 60 + kstDate.getUTCMinutes()
}

/**
 * 휴게(start~end)가 KST 12:00~13:00과 겹친 분 계산.
 *
 * 가정:
 *   - 휴게가 같은 KST 날짜 내에 시작·종료된다 (자정 넘김 휴게는 극히 드묾 + 점심 무관).
 *   - end >= start (= 음수 휴게 없음). 호출처에서 보장.
 *
 * 자정 넘김 케이스 (start > end on the day): end의 KST 분이 1300 미만이고 start가 1200 이상이면
 * 휴게가 13시 이후 시작·다음날 새벽 종료 가능 → 점심 안 걸침 (0 반환). 단순화 OK.
 */
export function calculateLunchOverlapMinutes(startIso: string, endIso: string): number {
  if (!startIso || !endIso) return 0
  const startKst = isoToKstMinuteOfDay(startIso)
  const endKst = isoToKstMinuteOfDay(endIso)
  // 자정 넘기는 휴게는 점심(12~13)을 가로지를 수 없음 (점심은 정오 1H 짧은 구간)
  if (endKst < startKst) return 0

  const overlapStart = Math.max(startKst, LUNCH_START_KST_MIN)
  const overlapEnd = Math.min(endKst, LUNCH_END_KST_MIN)
  return Math.max(0, overlapEnd - overlapStart)
}

export const LUNCH_OVERLAP_CHOICE = {
  LUNCH: 'lunch',   // 점심으로 처리 — break_auto 누적에서 제외
  EXTRA: 'extra',   // 별도 휴게로 누적 — 그대로
} as const
export type LunchOverlapChoice = typeof LUNCH_OVERLAP_CHOICE[keyof typeof LUNCH_OVERLAP_CHOICE]
