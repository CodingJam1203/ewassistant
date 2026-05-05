/**
 * 근무장소 타임라인 관련 헬퍼
 *
 * - 검증: validateTimeline
 * - 추출: firstWorkLocation, expectedCheckoutOf, getWorkLocations
 * - 호환성: legacyToTimeline (기존 단일 컬럼 → 단일 항목 timeline)
 * - 표시: formatTimelineForTeams (Teams 메시지용 라인 빌드)
 */

import {
  KOREAN_LABEL_TO_TYPE,
  WORK_LOCATION_TYPE_LABELS,
  type ExpectedCheckoutItem,
  type WorkLocationItem,
  type WorkLocationTimeline,
  type WorkLocationType,
} from '@/types/work-location-timeline'

// ─── 추출 ─────────────────────────────────────────────────────────────────────

export function getWorkLocations(timeline: WorkLocationTimeline): WorkLocationItem[] {
  return timeline.filter((e): e is WorkLocationItem => e.kind === 'work_location')
}

export function firstWorkLocation(timeline: WorkLocationTimeline): WorkLocationItem | null {
  return getWorkLocations(timeline)[0] ?? null
}

export function expectedCheckoutOf(timeline: WorkLocationTimeline): ExpectedCheckoutItem | null {
  return timeline.find((e): e is ExpectedCheckoutItem => e.kind === 'expected_checkout') ?? null
}

/** 'HH:mm' 또는 'HH:mm:ss' 문자열을 분 단위 정수로 변환 */
function timeToMinutes(hhmm: string): number {
  const parts = (hhmm ?? '').split(':')
  const h = parseInt(parts[0] ?? '0', 10)
  const m = parseInt(parts[1] ?? '0', 10)
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0)
}

/** 'HH:mm:ss' 또는 'HH:mm' → 'HH:mm' 정규화 */
function normalizeHHmm(t: string | null | undefined): string {
  if (!t) return ''
  return t.slice(0, 5)
}

// ─── 검증 ─────────────────────────────────────────────────────────────────────

export interface TimelineValidationError {
  message: string
  /** 문제 항목의 timeline 배열 인덱스 (있으면) */
  index?: number
}

const TIME_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/

/**
 * 타임라인 검증 규칙
 * 1. 최소 1개의 work_location 필요
 * 2. expected_checkout 정확히 1개, 그리고 마지막 위치
 * 3. type === 'custom'이면 customLabel이 비어있지 않아야 함
 * 4. 각 startTime은 'HH:mm' 형식
 * 5. timeline 시간이 엄격하게 증가 (이전 항목 시간 < 다음 항목 시간)
 */
export function validateTimeline(timeline: WorkLocationTimeline): TimelineValidationError[] {
  const errors: TimelineValidationError[] = []

  if (!Array.isArray(timeline) || timeline.length === 0) {
    errors.push({ message: '근무장소 타임라인이 비어 있습니다.' })
    return errors
  }

  const workLocs = getWorkLocations(timeline)
  if (workLocs.length === 0) {
    errors.push({ message: '최소 하나의 근무장소가 필요합니다.' })
  }

  const checkoutEntries = timeline.filter(e => e.kind === 'expected_checkout')
  if (checkoutEntries.length === 0) {
    errors.push({ message: '퇴근예정 시간이 필요합니다.' })
  } else if (checkoutEntries.length > 1) {
    errors.push({ message: '퇴근예정은 하나만 등록할 수 있습니다.' })
  } else if (timeline[timeline.length - 1].kind !== 'expected_checkout') {
    errors.push({ message: '퇴근예정은 마지막 항목이어야 합니다.' })
  }

  timeline.forEach((entry, i) => {
    if (!TIME_REGEX.test(entry.startTime)) {
      errors.push({ message: '시간 형식이 올바르지 않습니다 (HH:mm).', index: i })
    }
    if (entry.kind === 'work_location' && entry.type === 'custom') {
      if (!entry.customLabel || !entry.customLabel.trim()) {
        errors.push({ message: '"기타" 선택 시 상세 장소를 입력해주세요.', index: i })
      }
    }
  })

  // 시간 엄격 증가 검사
  for (let i = 1; i < timeline.length; i++) {
    const prev = timeToMinutes(timeline[i - 1].startTime)
    const curr = timeToMinutes(timeline[i].startTime)
    if (curr <= prev) {
      errors.push({
        message: '각 항목 시간은 이전 항목보다 늦어야 합니다.',
        index: i,
      })
    }
  }

  return errors
}

// ─── 호환성 (legacy → timeline) ───────────────────────────────────────────────

/**
 * 기존 단일 컬럼 데이터를 단일 항목 timeline으로 합성합니다.
 * - expected_work_location_timeline이 NULL인 기존 work_logs 레코드를 화면/메시지에서
 *   균일하게 다루기 위한 fallback.
 * - expected_checkout 정보가 legacy에 없으므로, end_time을 호출자가 함께 넘겨주면
 *   퇴근예정으로 채워줍니다.
 */
export function legacyToTimeline(opts: {
  expectedWorkLocation?: string | null
  expectedWorkLocationType?: string | null  // '사무실' | '재택' | '외근' | '기타' 등
  expectedWorkTime?: string | null          // 'HH:mm[:ss]'
  /** 퇴근예정으로 사용할 시간 (work_logs.end_time) — 없으면 expected_checkout 항목 미생성 */
  fallbackCheckoutTime?: string | null
}): WorkLocationTimeline | null {
  const startTime = normalizeHHmm(opts.expectedWorkTime)
  const koreanRaw = (opts.expectedWorkLocationType ?? opts.expectedWorkLocation ?? '').trim()

  if (!startTime && !koreanRaw && !opts.fallbackCheckoutTime) return null

  let type: WorkLocationType = 'office'
  let label = '사무실'
  let customLabel: string | null = null

  if (koreanRaw) {
    if (KOREAN_LABEL_TO_TYPE[koreanRaw]) {
      type = KOREAN_LABEL_TO_TYPE[koreanRaw]
      label = WORK_LOCATION_TYPE_LABELS[type]
    } else {
      // 알려진 한글 라벨이 아니면 사용자가 직접 입력한 값으로 간주 → custom
      type = 'custom'
      label = WORK_LOCATION_TYPE_LABELS.custom
      customLabel = koreanRaw
    }
  }

  // expectedWorkLocation이 별도 상세 라벨을 담고 있을 수 있음 (type=custom 케이스)
  if (type === 'custom' && !customLabel && opts.expectedWorkLocation) {
    customLabel = opts.expectedWorkLocation
  }

  const timeline: WorkLocationTimeline = [
    {
      kind: 'work_location',
      type,
      label,
      customLabel,
      startTime: startTime || '09:00',
    },
  ]

  const checkout = normalizeHHmm(opts.fallbackCheckoutTime)
  if (checkout) {
    timeline.push({ kind: 'expected_checkout', startTime: checkout })
  }

  return timeline
}

// ─── 표시 (Teams 메시지) ──────────────────────────────────────────────────────

export interface FormattedTimeline {
  /** 메시지 본문에 들어갈 라인들 (이미 \n으로 join할 준비된 배열) */
  lines: string[]
  /** 멀티라인 모드 여부 (work_location ≥ 2) */
  isMulti: boolean
}

/**
 * Teams 메시지용 타임라인 포매터
 * - 단일(1 work_location + 1 expected_checkout): 한 줄 — "사무실 09:00~18:00"
 * - 멀티(2개 이상의 work_location): 여러 줄 — "1. 사무실 09:00~ / 2. 재택 14:00~ / 3. 퇴근예정 18:00"
 *
 * expected_checkout이 없는 (legacy) 케이스도 처리: end가 비어있으면 "~???"
 */
export function formatTimelineForTeams(timeline: WorkLocationTimeline | null | undefined): FormattedTimeline {
  const items = Array.isArray(timeline) ? timeline : []
  const workLocs = getWorkLocations(items)
  const checkout = expectedCheckoutOf(items)

  if (workLocs.length === 0) {
    return { lines: ['미입력'], isMulti: false }
  }

  // 단일 모드: work_location 1개 (+ checkout 0 또는 1)
  if (workLocs.length === 1) {
    const wl = workLocs[0]
    const loc = displayLocation(wl)
    const end = checkout?.startTime ?? '???'
    return { lines: [`${loc} ${wl.startTime}~${end}`], isMulti: false }
  }

  // 멀티 모드: 순서대로 번호 매겨 출력
  const lines: string[] = []
  let order = 1
  for (const e of items) {
    if (e.kind === 'work_location') {
      lines.push(`${order}. ${displayLocation(e)} ${e.startTime}~`)
    } else {
      lines.push(`${order}. 퇴근예정 ${e.startTime}`)
    }
    order++
  }
  return { lines, isMulti: true }
}

/** 항목의 화면 표시 라벨 (custom인 경우 customLabel 우선) */
export function displayLocation(item: WorkLocationItem): string {
  if (item.type === 'custom' && item.customLabel?.trim()) {
    return item.customLabel.trim()
  }
  return item.label || WORK_LOCATION_TYPE_LABELS[item.type] || '미입력'
}
