/**
 * 근무장소 타임라인 타입 정의
 *
 * 하루 안에 여러 장소에서 근무할 수 있도록, 단일 location 필드 대신
 * "장소 + 시작시간" 항목들의 배열로 표현합니다.
 * 마지막에는 항상 expected_checkout(퇴근예정 시간) 항목이 위치합니다.
 *
 * 예) 사무실 09:00~ → 재택 14:00~ → 퇴근예정 18:00
 */

export type WorkLocationType = 'office' | 'remote' | 'field' | 'custom'

/** 한국어 라벨 ↔ type 매핑 (UI/Teams 메시지용) */
export const WORK_LOCATION_TYPE_LABELS: Record<WorkLocationType, string> = {
  office: '사무실',
  remote: '재택',
  field: '외근',
  custom: '기타',
}

/** 한국어 라벨 → type (legacy 데이터 변환용) */
export const KOREAN_LABEL_TO_TYPE: Record<string, WorkLocationType> = {
  '사무실': 'office',
  '재택': 'remote',
  '외근': 'field',
  '기타': 'custom',
}

/** 근무장소 항목 — 시작 시각부터 다음 항목 시작 시각 또는 퇴근예정 직전까지 유지 */
export interface WorkLocationItem {
  kind: 'work_location'
  type: WorkLocationType
  /** 표시용 라벨 (사무실/재택/외근 또는 사용자 입력값) */
  label: string
  /** type === 'custom'일 때만 채움 (직접 입력 상세 장소) */
  customLabel: string | null
  /** 'HH:mm' */
  startTime: string
}

/** 퇴근예정 항목 — 타임라인 끝에 1개만 존재 */
export interface ExpectedCheckoutItem {
  kind: 'expected_checkout'
  /** 'HH:mm' */
  startTime: string
}

export type WorkLocationTimelineEntry = WorkLocationItem | ExpectedCheckoutItem
export type WorkLocationTimeline = WorkLocationTimelineEntry[]
