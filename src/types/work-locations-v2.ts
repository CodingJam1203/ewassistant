/**
 * 근무장소 v2 — 시간과 분리된 순서형 칩 배열.
 *
 * 기존 work-location-timeline.ts의 timeline 구조는 read-only 호환용으로 보존하고,
 * 신규 입력/저장은 본 타입을 사용합니다.
 *
 * 형식 예:
 *   [{ kind: 'office' }, { kind: 'field' }, { kind: 'custom', customLabel: '카페' }]
 *
 * - kind: 'office' | 'remote' | 'field' | 'custom'
 *   * office=사무실, remote=재택, field=외근
 *   * custom: 직접 입력 (customLabel 필수)
 * - 시간 정보는 일절 포함하지 않음. 출근/퇴근 시간은 별도 필드.
 */

/** 칩 종류 */
export type WorkLocationKind = 'office' | 'remote' | 'field' | 'custom'

/** 한국어 라벨 ↔ kind */
export const WORK_LOCATION_KIND_LABELS: Record<WorkLocationKind, string> = {
  office: '사무실',
  remote: '재택',
  field: '외근',
  custom: '기타',
}

/** 한국어 라벨 → kind (legacy 데이터/입력 변환용) */
export const KOREAN_LABEL_TO_KIND: Record<string, WorkLocationKind> = {
  '사무실': 'office',
  '재택': 'remote',
  '외근': 'field',
  '기타': 'custom',
}

/** 단일 칩 */
export interface WorkLocationChip {
  kind: WorkLocationKind
  /** kind === 'custom'일 때만 채움 (직접 입력 라벨) */
  customLabel?: string | null
}

/** 칩 배열 */
export type WorkLocations = WorkLocationChip[]

/** 기본 칩 — 폼 첫 진입 시 default */
export function defaultWorkLocations(): WorkLocations {
  return [{ kind: 'office' }]
}
