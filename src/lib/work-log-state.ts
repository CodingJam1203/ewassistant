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
}

export function computeWorkLogState(input: WorkLogStateInput): WorkLogState {
  const { hasWorkLog, checkedInAt, checkedOutAt, isOnBreak } = input

  // E. 퇴근 완료 (실제 퇴근 있음 — 다른 모든 조건 무관)
  if (checkedOutAt) return 'E'

  // 실제 출근 있음
  if (checkedInAt) {
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
