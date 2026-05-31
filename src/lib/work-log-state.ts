/**
 * work-log-state — 한 사용자 + 한 일자(work_log row)의 상태 계산.
 *
 * 5단계 상태:
 *   A. 미작성              : work_log row 없음
 *   B. 출근 예정 등록됨    : row 있음, 실제 출근 안 함 (checked_in_at NULL)
 *   C. 근무 중              : 실제 출근함, 휴게 X, 퇴근 안 함
 *   D. 휴게 중              : 실제 출근함, is_on_break=true
 *   E. 퇴근 완료            : checked_out_at 있음
 *
 * UI 분기에 사용:
 *   - 카드 배지 라벨/색상
 *   - 버튼 노출/텍스트 (출근보고 작성/수정, 출근 완료, 퇴근보고 작성/수정, 휴게)
 */

export type WorkLogState = 'A' | 'B' | 'C' | 'D' | 'E'

export interface WorkLogStateInput {
  /** D-day work_log row 존재 여부 */
  hasWorkLog: boolean
  /** 실제 출근 시각 (ISO) — daily_work_status.checked_in_at */
  checkedInAt: string | null
  /** 실제 퇴근 시각 (ISO) — daily_work_status.checked_out_at */
  checkedOutAt: string | null
  /** 휴게 진행 중 여부 — daily_work_status.is_on_break */
  isOnBreak: boolean
  /**
   * v1.63 — 출근완료 미사용 팀 read-time 보정값 ('HH:mm:ss' 또는 NULL).
   * computeEffectiveActualStart 결과. 있으면 checkedInAt이 NULL이라도 '실 출근'으로 간주(C/D).
   *
   * 배경: lazy write가 아직 daily_work_status.checked_in_at을 채우지 못한 짧은 윈도우(첫 fetch)
   * 또는 lazy write 자체가 실패한 케이스에도 사용자가 즉시 'C' 상태를 보게 한다.
   * 서버 응답의 effective_actual_start_time을 그대로 넘기면 됨.
   */
  effectiveActualStart?: string | null
}

export function computeWorkLogState(input: WorkLogStateInput): WorkLogState {
  const { hasWorkLog, checkedInAt, checkedOutAt, isOnBreak, effectiveActualStart } = input

  // E. 퇴근 완료 (실제 퇴근 있음 — 다른 모든 조건 무관)
  if (checkedOutAt) return 'E'

  // 실제 출근 있음 — DB checked_in_at 또는 effective 보정값 어느 쪽이든
  if (checkedInAt || effectiveActualStart) {
    if (isOnBreak) return 'D'
    return 'C'
  }

  // 실제 출근 없음 — row 유무로 분기
  if (hasWorkLog) return 'B'
  return 'A'
}

// ─── 배지 라벨/색상 ──────────────────────────────────────────────────────────

export interface StateBadgeInfo {
  label: string
  /** 디자인 토큰 기반 색상 카테고리 */
  variant: 'danger' | 'warning' | 'success' | 'info' | 'neutral'
  /** dot 강조 여부 */
  dot: boolean
}

export const STATE_BADGE: Record<WorkLogState, StateBadgeInfo> = {
  A: { label: '미작성',          variant: 'danger',  dot: true },
  B: { label: '출근 예정 등록됨', variant: 'warning', dot: true },
  C: { label: '근무 중',         variant: 'success', dot: true },
  D: { label: '휴게 중',         variant: 'success', dot: true },
  E: { label: '퇴근 완료',        variant: 'warning', dot: false },
}

// ─── 버튼 노출 분기 ──────────────────────────────────────────────────────────

export interface ButtonVisibility {
  showCheckInCreate: boolean   // [출근보고 작성]
  showCheckInEdit: boolean     // [출근보고 수정]
  showCheckInComplete: boolean // [출근 완료]
  showCheckOutCreate: boolean  // [퇴근보고 작성]
  showCheckOutEdit: boolean    // [퇴근보고 수정]
  showBreakStart: boolean      // [휴게 시작]
  showBreakEnd: boolean        // [휴게 종료]
}

/**
 * 팀 설정 옵션.
 * useCheckInComplete=false면 [출근 완료] 버튼 항상 숨김 (B 상태에서도).
 * 이 경우 출근보고 제출과 동시에 서버가 checked_in_at을 자동 세팅하므로
 * 사용자는 C 상태로 직행 — B 상태가 잠시도 노출되지 않음 (이론상).
 */
export interface ButtonOptions {
  useCheckInComplete?: boolean
}

export function buttonsForState(state: WorkLogState, opts: ButtonOptions = {}): ButtonVisibility {
  const v = buttonsForStateRaw(state)
  if (opts.useCheckInComplete === false) {
    v.showCheckInComplete = false
  }
  return v
}

// ─── 출근완료 미사용 팀 자동 보정 (정책서 7 — Stage 4) ────────────────────────

export interface EffectiveActualStartInput {
  /** YYYY-MM-DD — work_logs.leave_date */
  leave_date: string | null
  /** 'HH:mm' 또는 'HH:mm:ss'. NULL이면 미보고 상태 → 보정 안 함. */
  planned_start_time: string | null
  /** DB 원본. 값 있으면 그대로 반환. */
  actual_start_time: string | null
}

export interface TeamConfigForEffective {
  /** 팀의 use_check_in_complete. true(기본)면 보정 안 함. */
  use_check_in_complete: boolean
}

/**
 * 조건이 모두 충족되면 planned_start_time 반환, 아니면 actual_start_time(원본).
 *
 * 조건:
 *   1. team.use_check_in_complete = false (출근완료 단계 미사용)
 *   2. leave_date = 오늘 (KST)
 *   3. KST 현재 시각 ≥ planned_start_time
 *   4. actual_start_time IS NULL
 *   5. planned_start_time IS NOT NULL (미보고 아님)
 *
 * DB는 안 건드린다 — 응답 effective_actual_start_time 필드용.
 */
export function computeEffectiveActualStart(
  row: EffectiveActualStartInput,
  team: TeamConfigForEffective,
  now: Date = new Date(),
): string | null {
  // 이미 실제 출근 기록 있음 → 그대로 (v1.63: 빈 문자열/whitespace 가드 추가 — 'HH:mm' 최소 4자)
  const trimmedActual = row.actual_start_time?.trim() ?? ''
  if (trimmedActual.length >= 4) return trimmedActual
  // 출근완료 사용 팀 → 보정 X
  if (team.use_check_in_complete) return null
  // 미보고 → 보정 X (v1.63: planned도 trim 가드)
  const trimmedPlanned = row.planned_start_time?.trim() ?? ''
  if (trimmedPlanned.length < 4) return null
  if (!row.leave_date) return null

  // KST 오늘 비교
  const dayFmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  })
  if (row.leave_date !== dayFmt.format(now)) return null

  // KST 현재 HH:mm vs planned HH:mm
  const timeFmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Seoul', hour12: false, hour: '2-digit', minute: '2-digit',
  })
  const nowHHmm = timeFmt.format(now)
  const plannedHHmm = trimmedPlanned.slice(0, 5)
  if (nowHHmm < plannedHHmm) return null

  return trimmedPlanned
}

function buttonsForStateRaw(state: WorkLogState): ButtonVisibility {
  switch (state) {
    case 'A':
      return {
        showCheckInCreate: true,
        showCheckInEdit: false,
        showCheckInComplete: false,
        showCheckOutCreate: true,
        showCheckOutEdit: false,
        showBreakStart: false,
        showBreakEnd: false,
      }
    case 'B':
      return {
        showCheckInCreate: false,
        showCheckInEdit: true,
        showCheckInComplete: true,  // B 상태에서만 노출 — 실제 출근하면 C로 전환되어 자동 사라짐
        showCheckOutCreate: true,
        showCheckOutEdit: false,
        showBreakStart: false,
        showBreakEnd: false,
      }
    case 'C':
      return {
        showCheckInCreate: false,
        showCheckInEdit: true,
        showCheckInComplete: false,
        showCheckOutCreate: true,
        showCheckOutEdit: false,
        showBreakStart: true,
        showBreakEnd: false,
      }
    case 'D':
      return {
        showCheckInCreate: false,
        showCheckInEdit: true,
        showCheckInComplete: false,
        showCheckOutCreate: true,
        showCheckOutEdit: false,
        showBreakStart: false,
        showBreakEnd: true,
      }
    case 'E':
      return {
        showCheckInCreate: false,
        showCheckInEdit: true,
        showCheckInComplete: false,
        showCheckOutCreate: false,
        showCheckOutEdit: true,
        showBreakStart: false,
        showBreakEnd: false,
      }
  }
}
