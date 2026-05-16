/**
 * 정책서 시간 4종 (planned/actual_start/end_time) SoT 추출 + 4단계 상태 분류.
 *
 * Stage 0-1에서 추가된 work_logs의 신규 컬럼을 read path에서 일관되게 사용하기
 * 위한 helper. 옛 start_time/end_time은 planned 의미로만 fallback (의미 모호한
 * legacy column이므로 actual로 fallback하지 않음).
 *
 * Stage 0-3 backfill 후 대부분의 row는 4컬럼이 채워져 있어 fallback 거의 안 탐.
 */

export interface WorkLogTimeRow {
  planned_start_time: string | null
  planned_end_time: string | null
  actual_start_time: string | null
  actual_end_time: string | null
  /** legacy — fallback 전용 (planned 의미). */
  start_time: string | null
  /** legacy — fallback 전용 (planned 의미). */
  end_time: string | null
}

export interface UnifiedTimes {
  /** HH:mm — null이면 정보 없음 */
  plannedStart: string | null
  plannedEnd: string | null
  actualStart: string | null
  actualEnd: string | null
}

export type WorkLogState =
  /** actual_end_time set — 퇴근완료 */
  | 'check_out_done'
  /** actual_start_time set, actual_end_time null — 출근완료, 퇴근 전 */
  | 'check_in_done'
  /** planned_*만 있음 — 출근보고만 작성, 출근완료 전 */
  | 'planned_only'
  /** 4컬럼 모두 NULL + legacy도 NULL — row가 사실상 비어있음 */
  | 'no_data'

const trim5 = (s: string | null | undefined): string | null =>
  s ? s.slice(0, 5) : null

/**
 * 신규 SoT 4컬럼 추출.
 * legacy start_time/end_time은 planned 의미로만 fallback — actual로 fallback하지 않는다.
 */
export function extractUnifiedTimes(row: WorkLogTimeRow): UnifiedTimes {
  return {
    plannedStart: trim5(row.planned_start_time) ?? trim5(row.start_time),
    plannedEnd:   trim5(row.planned_end_time)   ?? trim5(row.end_time),
    actualStart:  trim5(row.actual_start_time),
    actualEnd:    trim5(row.actual_end_time),
  }
}

/** row를 4단계 상태로 분류. */
export function classifyWorkLog(row: WorkLogTimeRow): WorkLogState {
  const t = extractUnifiedTimes(row)
  if (t.actualEnd)    return 'check_out_done'
  if (t.actualStart)  return 'check_in_done'
  if (t.plannedStart) return 'planned_only'
  return 'no_data'
}

/**
 * 정책서 캘린더 4단계 시각 표시 룰 — 셀에 보일 출퇴근 시각 범위.
 *
 *   출근예정만   → planned_start ~ planned_end
 *   출근완료    → actual_start  ~ planned_end
 *   퇴근완료    → actual_start  ~ actual_end
 *   no_data    → null ~ null  (호출자가 "미보고"/공백 처리)
 */
export function displayTimeRange(row: WorkLogTimeRow): {
  state: WorkLogState
  start: string | null
  end: string | null
} {
  const t = extractUnifiedTimes(row)
  const state = classifyWorkLog(row)
  if (state === 'check_out_done') return { state, start: t.actualStart, end: t.actualEnd }
  if (state === 'check_in_done')  return { state, start: t.actualStart, end: t.plannedEnd }
  if (state === 'planned_only')   return { state, start: t.plannedStart, end: t.plannedEnd }
  return { state, start: null, end: null }
}

/** (user_email, leave_date) 별 가장 최근 row 1건만 keep (created_at desc). */
export interface WorkLogIdRow {
  id: string
  user_email: string
  leave_date: string
  created_at: string
}
export function pickLatestWorkLogPerDay<T extends WorkLogIdRow>(rows: T[]): T[] {
  const map = new Map<string, T>()
  for (const r of rows) {
    const key = `${r.user_email}__${r.leave_date}`
    const existing = map.get(key)
    if (!existing || existing.created_at < r.created_at) {
      map.set(key, r)
    }
  }
  return Array.from(map.values())
}
