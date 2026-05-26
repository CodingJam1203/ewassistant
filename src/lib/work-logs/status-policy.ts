/**
 * 표시 정책 단일 출처 — 출근/퇴근 보고 상태의 화면 분류.
 *
 * /api/missing-reports route 정책 주석을 모든 화면이 일관되게 따르도록 헬퍼로 추출:
 *   "어제 이하 + 출근만 있음 = missing_checkout (퇴근 누락)"
 *   "오늘은 아직 퇴근 시간 전일 수 있어 미보고 게이트 외부"
 *
 * 이 모듈은 read-only 분류 helper만 노출. DB 변경/알림 발송 등 side effect 없음.
 */

import type { WorkLogState } from './unified-times'

/**
 * 과거 일자 + 출근만 보고된 상태(check_in_done) → 퇴근 누락(missing_checkout).
 *
 * 정책:
 *   - 오늘 일자는 미보고 게이트 외부 (퇴근 시간 전일 수 있음) → false
 *   - 토/일은 보고 의무 없는 날 → false (submission-status route의 'weekend' 분기와 일치)
 *   - 그 외 과거 일자 + check_in_done → true
 *
 * @param date YYYY-MM-DD — 해당 row의 leave_date / 셀의 날짜
 * @param state classifyWorkLog 결과
 * @param todayKst KST 기준 오늘 (YYYY-MM-DD). getKstTodayDateString() 결과
 * @param isWorkday 평일 여부 (false면 토/일/공휴일로 의무 없음). 기본 true.
 */
export function isMissingCheckout(
  date: string,
  state: WorkLogState,
  todayKst: string,
  isWorkday: boolean = true,
): boolean {
  return isWorkday && date < todayKst && state === 'check_in_done'
}
