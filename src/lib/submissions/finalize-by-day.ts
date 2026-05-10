/**
 * 제출 이력 → 날짜별 최종 상태 계산 헬퍼
 *
 * 같은 사용자의 같은 날짜에 여러 제출 row가 있을 때 (출근보고 → 출근보고 수정 →
 * 출근취소 → 다시 출근보고 등) 가장 최근 row만 남겨 "최종 상태"를 만들어준다.
 *
 * - "일자별 최종 보고" 탭, "캘린더뷰" 탭 등 여러 화면에서 같은 정의를 공유.
 * - SubmissionsRawTable과 MyHistoryCalendar 양쪽에서 import.
 */

/**
 * 제출 row가 만족해야 할 최소 필드 (구조적 타이핑).
 * 실제 SubmissionRow 인터페이스를 import하지 않고도 사용 가능.
 */
export interface SubmissionRowLike {
  user_email: string
  target_date: string
  submitted_at: string
  report_type: 'check_in' | 'check_out' | 'check_in_update' | 'check_out_update' | 'check_in_complete'
}

/**
 * (user_email, target_date, family) 별로 가장 최신 row 1건만 남긴다.
 *
 * - family는 'check_in'(출근/출근수정) / 'check_out'(퇴근/퇴근수정) 둘로 분류.
 * - 결과 정렬: target_date desc → 같은 날짜 안에서는 퇴근(out)이 위, 출근(in)이 아래.
 *   (테이블 표시용. 캘린더뷰는 어차피 다시 인덱싱하므로 정렬 결과를 신경 쓸 필요 없음.)
 */
export function pickLatestPerDay<T extends SubmissionRowLike>(rows: T[]): T[] {
  const map = new Map<string, T>()
  for (const r of rows) {
    const family = r.report_type.startsWith('check_in') ? 'in' : 'out'
    const key = `${r.user_email}__${r.target_date}__${family}`
    const existing = map.get(key)
    if (!existing || existing.submitted_at < r.submitted_at) {
      map.set(key, r)
    }
  }
  return Array.from(map.values()).sort((a, b) => {
    if (a.target_date !== b.target_date) return a.target_date < b.target_date ? 1 : -1
    const fa = a.report_type.startsWith('check_out') ? 0 : 1
    const fb = b.report_type.startsWith('check_out') ? 0 : 1
    return fa - fb
  })
}

/**
 * 날짜별 최종 상태를 (출근, 퇴근) 한 쌍으로 인덱싱.
 * 캘린더뷰가 각 날짜 셀을 채울 때 사용.
 *
 * - 같은 사용자의 본인 데이터를 가정 (mine=true). 여러 사용자가 섞여 있다면
 *   user_email까지 키에 포함하도록 호출자가 제어.
 */
export function indexFinalsByDate<T extends SubmissionRowLike>(
  rows: T[],
): Map<string, { checkIn: T | null; checkOut: T | null }> {
  const finals = pickLatestPerDay(rows)
  const map = new Map<string, { checkIn: T | null; checkOut: T | null }>()
  for (const r of finals) {
    const key = r.target_date
    const slot = map.get(key) ?? { checkIn: null, checkOut: null }
    if (r.report_type.startsWith('check_in')) {
      slot.checkIn = r
    } else {
      slot.checkOut = r
    }
    map.set(key, slot)
  }
  return map
}
