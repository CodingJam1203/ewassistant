/**
 * 근무장소 v2 헬퍼 — 정규화, 표시, legacy 호환, 검증.
 */

import {
  KOREAN_LABEL_TO_KIND,
  WORK_LOCATION_KIND_LABELS,
  type WorkLocationChip,
  type WorkLocationKind,
  type WorkLocations,
} from '@/types/work-locations-v2'
import type {
  WorkLocationItem,
  WorkLocationTimeline,
} from '@/types/work-location-timeline'

// ─── 정규화 ────────────────────────────────────────────────────────────────

/** 임의 값을 안전한 WorkLocationChip으로 정규화. invalid면 null. */
export function normalizeChip(raw: unknown): WorkLocationChip | null {
  if (raw == null || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>
  const kindRaw = obj.kind
  const customLabelRaw = obj.customLabel

  let kind: WorkLocationKind
  if (kindRaw === 'office' || kindRaw === 'remote' || kindRaw === 'field' || kindRaw === 'custom') {
    kind = kindRaw
  } else {
    return null
  }

  if (kind === 'custom') {
    const label = typeof customLabelRaw === 'string' ? customLabelRaw.trim() : ''
    if (!label) return null
    return { kind: 'custom', customLabel: label }
  }
  return { kind }
}

/** 임의 값을 안전한 WorkLocations로 정규화. */
export function normalizeWorkLocations(raw: unknown): WorkLocations | null {
  if (!Array.isArray(raw)) return null
  const chips: WorkLocations = []
  for (const item of raw) {
    const chip = normalizeChip(item)
    if (chip) chips.push(chip)
  }
  return chips.length > 0 ? chips : null
}

// ─── 표시 ─────────────────────────────────────────────────────────────────

/** 칩 1개의 표시 라벨 */
export function chipLabel(chip: WorkLocationChip): string {
  if (chip.kind === 'custom') {
    return chip.customLabel?.trim() || WORK_LOCATION_KIND_LABELS.custom
  }
  return WORK_LOCATION_KIND_LABELS[chip.kind]
}

/** 칩 배열을 화살표 문자열로: "사무실 → 외근 → 재택" */
export function formatChipsArrow(locs: WorkLocations | null | undefined): string {
  if (!Array.isArray(locs) || locs.length === 0) return '미입력'
  return locs.map(chipLabel).join(' → ')
}

/** 칩 배열을 콤마 문자열로: "사무실, 외근, 재택" */
export function formatChipsComma(locs: WorkLocations | null | undefined): string {
  if (!Array.isArray(locs) || locs.length === 0) return '미입력'
  return locs.map(chipLabel).join(', ')
}

/** 첫 칩 라벨 (legacy 단일 문자열 mirror용) */
export function firstChipLabel(locs: WorkLocations | null | undefined): string {
  if (!Array.isArray(locs) || locs.length === 0) return ''
  return chipLabel(locs[0])
}

// ─── 표시 fallback chain ──────────────────────────────────────────────────

/**
 * 표시할 근무장소 칩 배열을 결정.
 * 우선순위: actual → planned → legacy(timeline) → legacy 단일 문자열
 *
 * @returns 칩 배열 (빈 배열은 반환하지 않음, 정말 아무것도 없으면 null)
 */
export function resolveDisplayLocations(opts: {
  actual?: unknown
  planned?: unknown
  legacyActualTimeline?: WorkLocationTimeline | null
  legacyExpectedTimeline?: WorkLocationTimeline | null
  legacyWorkLocation?: string | null
  legacyExpectedWorkLocation?: string | null
}): WorkLocations | null {
  const actual = normalizeWorkLocations(opts.actual)
  if (actual && actual.length > 0) return actual

  const planned = normalizeWorkLocations(opts.planned)
  if (planned && planned.length > 0) return planned

  const fromLegacyActual = legacyTimelineToLocations(opts.legacyActualTimeline ?? null)
  if (fromLegacyActual && fromLegacyActual.length > 0) return fromLegacyActual

  const fromLegacyExpected = legacyTimelineToLocations(opts.legacyExpectedTimeline ?? null)
  if (fromLegacyExpected && fromLegacyExpected.length > 0) return fromLegacyExpected

  const fromSingle = legacySingleToLocations(opts.legacyWorkLocation ?? null)
  if (fromSingle && fromSingle.length > 0) return fromSingle

  const fromSingleExpected = legacySingleToLocations(opts.legacyExpectedWorkLocation ?? null)
  if (fromSingleExpected && fromSingleExpected.length > 0) return fromSingleExpected

  return null
}

/**
 * 예정 표시용 — 출근보고에서 입력한 planned만 우선 (actual은 무시).
 * 둘러보기 카드의 "출근예정 장소"처럼 예정값을 노출하는 자리에 사용.
 */
export function resolvePlannedLocations(opts: {
  planned?: unknown
  legacyExpectedTimeline?: WorkLocationTimeline | null
  legacyExpectedWorkLocation?: string | null
}): WorkLocations | null {
  const planned = normalizeWorkLocations(opts.planned)
  if (planned && planned.length > 0) return planned

  const fromLegacy = legacyTimelineToLocations(opts.legacyExpectedTimeline ?? null)
  if (fromLegacy && fromLegacy.length > 0) return fromLegacy

  const fromSingle = legacySingleToLocations(opts.legacyExpectedWorkLocation ?? null)
  if (fromSingle && fromSingle.length > 0) return fromSingle

  return null
}

// ─── Legacy 호환 ──────────────────────────────────────────────────────────

/** 기존 timeline의 work_location 항목들 → chips */
export function legacyTimelineToLocations(
  timeline: WorkLocationTimeline | null | undefined
): WorkLocations | null {
  if (!Array.isArray(timeline) || timeline.length === 0) return null
  const chips: WorkLocations = []
  for (const entry of timeline) {
    if (entry.kind !== 'work_location') continue
    const item = entry as WorkLocationItem
    if (item.type === 'office' || item.type === 'remote' || item.type === 'field') {
      chips.push({ kind: item.type })
    } else if (item.type === 'custom') {
      const label = (item.customLabel ?? '').trim() || (item.label ?? '').trim() || '미입력'
      chips.push({ kind: 'custom', customLabel: label })
    } else {
      // type 미지정 — 한글 라벨로 매핑 시도
      const labelTrim = (item.label ?? '').trim()
      if (labelTrim && KOREAN_LABEL_TO_KIND[labelTrim]) {
        const k = KOREAN_LABEL_TO_KIND[labelTrim]
        if (k === 'custom') {
          chips.push({ kind: 'custom', customLabel: labelTrim })
        } else {
          chips.push({ kind: k })
        }
      } else if (labelTrim) {
        chips.push({ kind: 'custom', customLabel: labelTrim })
      }
    }
  }
  return chips.length > 0 ? chips : null
}

/** legacy 단일 문자열 → 1-element chips */
export function legacySingleToLocations(loc: string | null | undefined): WorkLocations | null {
  if (!loc) return null
  const trimmed = loc.trim()
  if (!trimmed) return null
  if (KOREAN_LABEL_TO_KIND[trimmed]) {
    const k = KOREAN_LABEL_TO_KIND[trimmed]
    if (k === 'custom') {
      return [{ kind: 'custom', customLabel: trimmed }]
    }
    return [{ kind: k }]
  }
  return [{ kind: 'custom', customLabel: trimmed }]
}

// ─── 검증 ─────────────────────────────────────────────────────────────────

export interface LocationsValidationError {
  message: string
  index?: number
}

/**
 * chips 배열 검증.
 * 1. 최소 1개 필요
 * 2. custom kind는 customLabel 필수
 */
export function validateWorkLocations(
  locs: WorkLocations | null | undefined
): LocationsValidationError[] {
  const errors: LocationsValidationError[] = []
  if (!Array.isArray(locs) || locs.length === 0) {
    errors.push({ message: '근무장소를 1개 이상 선택해주세요.' })
    return errors
  }
  locs.forEach((chip, i) => {
    if (chip.kind === 'custom') {
      const label = (chip.customLabel ?? '').trim()
      if (!label) {
        errors.push({
          message: '"기타" 선택 시 상세 장소를 입력해주세요.',
          index: i,
        })
      }
    } else if (
      chip.kind !== 'office' &&
      chip.kind !== 'remote' &&
      chip.kind !== 'field'
    ) {
      errors.push({
        message: '알 수 없는 근무장소 종류입니다.',
        index: i,
      })
    }
  })
  return errors
}

// ─── 편집 헬퍼 ────────────────────────────────────────────────────────────

/**
 * 마지막 칩과 동일하면 추가하지 않음 (둘러보기 근무지 변경 누적용).
 * @returns { next, changed }
 */
export function appendChipIfChanged(
  locs: WorkLocations | null | undefined,
  newChip: WorkLocationChip
): { next: WorkLocations; changed: boolean } {
  const arr = Array.isArray(locs) ? [...locs] : []
  const last = arr[arr.length - 1]
  if (last && chipLabel(last) === chipLabel(newChip)) {
    return { next: arr, changed: false }
  }
  arr.push(newChip)
  return { next: arr, changed: true }
}

/** 사용자 입력 한글/임의 라벨 → 칩 (location 즉시 변경 API용) */
export function locationStringToChip(label: string): WorkLocationChip {
  const trimmed = label.trim()
  if (KOREAN_LABEL_TO_KIND[trimmed]) {
    const k = KOREAN_LABEL_TO_KIND[trimmed]
    if (k === 'custom') {
      return { kind: 'custom', customLabel: trimmed }
    }
    return { kind: k }
  }
  return { kind: 'custom', customLabel: trimmed }
}

// ─── 비교 ─────────────────────────────────────────────────────────────────

/** 두 chips 배열이 동일한지 (kind + customLabel 기준) */
export function locationsEqual(
  a: WorkLocations | null | undefined,
  b: WorkLocations | null | undefined,
): boolean {
  const aa = a ?? []
  const bb = b ?? []
  if (aa.length !== bb.length) return false
  for (let i = 0; i < aa.length; i++) {
    if (aa[i].kind !== bb[i].kind) return false
    const al = (aa[i].customLabel ?? '').trim()
    const bl = (bb[i].customLabel ?? '').trim()
    if (al !== bl) return false
  }
  return true
}
