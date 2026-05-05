/**
 * 근무장소 타임라인 관련 헬퍼
 *
 * - 검증: validateTimeline (30분 단위 강제 포함)
 * - 추출: firstWorkLocation, endItemOf, getWorkLocations
 * - 시간 유틸: is30MinUnit, floorToHalfHour, nowKstHHmmFloor
 * - 변환: appendWorkLocationToTimeline, finalizeAsCheckout, prefillFromExpected
 * - 호환성: legacyToTimeline (기존 단일 컬럼 → 단일 항목 timeline)
 * - 표시: formatTimelineForTeams, buildLocationSummary
 */

import {
  KOREAN_LABEL_TO_TYPE,
  WORK_LOCATION_TYPE_LABELS,
  type CheckoutItem,
  type EndItem,
  type ExpectedCheckoutItem,
  type WorkLocationItem,
  type WorkLocationTimeline,
  type WorkLocationType,
} from '@/types/work-location-timeline'

// ─── 시간 단위 유틸 ───────────────────────────────────────────────────────────

const TIME_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/

/** 'HH:mm' 분이 00 또는 30 인지 검사 */
export function is30MinUnit(hhmm: string): boolean {
  if (!TIME_REGEX.test(hhmm)) return false
  const m = parseInt(hhmm.split(':')[1], 10)
  return m === 0 || m === 30
}

/**
 * 시각을 30분 단위로 내림 처리.
 * - 17:02 → 17:00
 * - 17:31 → 17:30
 * - 23:59 → 23:30
 * - 잘못된 형식이면 입력 그대로 반환
 */
export function floorToHalfHour(hhmm: string): string {
  if (!TIME_REGEX.test(hhmm)) return hhmm
  const [hStr, mStr] = hhmm.split(':')
  const h = parseInt(hStr, 10)
  const m = parseInt(mStr, 10)
  const flooredM = m < 30 ? 0 : 30
  return `${String(h).padStart(2, '0')}:${String(flooredM).padStart(2, '0')}`
}

/** 현재 KST 시각을 HH:mm으로, 30분 단위 내림 적용 */
export function nowKstHHmmFloor(): string {
  const now = new Date()
  const kst = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }))
  const h = kst.getHours()
  const m = kst.getMinutes()
  const flooredM = m < 30 ? 0 : 30
  return `${String(h).padStart(2, '0')}:${String(flooredM).padStart(2, '0')}`
}

/** 'HH:mm:ss' 또는 'HH:mm' → 'HH:mm' 정규화 */
function normalizeHHmm(t: string | null | undefined): string {
  if (!t) return ''
  return t.slice(0, 5)
}

/** 'HH:mm' 또는 'HH:mm:ss' → 분 단위 정수 */
function timeToMinutes(hhmm: string): number {
  const parts = (hhmm ?? '').split(':')
  const h = parseInt(parts[0] ?? '0', 10)
  const m = parseInt(parts[1] ?? '0', 10)
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0)
}

// ─── 추출 ─────────────────────────────────────────────────────────────────────

export function getWorkLocations(timeline: WorkLocationTimeline): WorkLocationItem[] {
  return timeline.filter((e): e is WorkLocationItem => e.kind === 'work_location')
}

export function firstWorkLocation(timeline: WorkLocationTimeline): WorkLocationItem | null {
  return getWorkLocations(timeline)[0] ?? null
}

export function lastWorkLocation(timeline: WorkLocationTimeline): WorkLocationItem | null {
  const wls = getWorkLocations(timeline)
  return wls[wls.length - 1] ?? null
}

/** 마지막 종료 항목 (expected_checkout 또는 checkout) */
export function endItemOf(timeline: WorkLocationTimeline): EndItem | null {
  return timeline.find(
    (e): e is EndItem => e.kind === 'expected_checkout' || e.kind === 'checkout'
  ) ?? null
}

/** @deprecated endItemOf 사용 권장. expected_checkout만 매칭. */
export function expectedCheckoutOf(timeline: WorkLocationTimeline): ExpectedCheckoutItem | null {
  return timeline.find((e): e is ExpectedCheckoutItem => e.kind === 'expected_checkout') ?? null
}

// ─── 검증 ─────────────────────────────────────────────────────────────────────

export interface TimelineValidationError {
  message: string
  /** 문제 항목의 timeline 배열 인덱스 (있으면) */
  index?: number
}

/**
 * 타임라인 검증 규칙
 * 1. 최소 1개의 work_location 필요
 * 2. 종료 항목(expected_checkout 또는 checkout) 정확히 1개, 마지막 위치
 * 3. type === 'custom'이면 customLabel이 비어있지 않아야 함
 * 4. 각 startTime은 'HH:mm' 형식 + 30분 단위 (분 ∈ {00, 30})
 * 5. timeline 시간이 엄격하게 증가
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

  const endEntries = timeline.filter(e => e.kind === 'expected_checkout' || e.kind === 'checkout')
  if (endEntries.length === 0) {
    errors.push({ message: '퇴근(예정) 시간이 필요합니다.' })
  } else if (endEntries.length > 1) {
    errors.push({ message: '퇴근(예정)은 하나만 등록할 수 있습니다.' })
  } else {
    const lastKind = timeline[timeline.length - 1].kind
    if (lastKind !== 'expected_checkout' && lastKind !== 'checkout') {
      errors.push({ message: '퇴근(예정)은 마지막 항목이어야 합니다.' })
    }
  }

  timeline.forEach((entry, i) => {
    if (!TIME_REGEX.test(entry.startTime)) {
      errors.push({ message: '시간 형식이 올바르지 않습니다 (HH:mm).', index: i })
    } else if (!is30MinUnit(entry.startTime)) {
      errors.push({ message: '시간은 30분 단위(00 또는 30분)만 입력할 수 있습니다.', index: i })
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

// ─── 변환 ─────────────────────────────────────────────────────────────────────

/**
 * 근무지 변경 시 새 work_location 항목을 timeline에 누적합니다.
 *
 * 규칙:
 * 1. 마지막 종료 항목(expected_checkout 또는 checkout) 직전에 삽입
 * 2. 직전 work_location과 displayLocation이 같으면 변경 없이 그대로 반환
 * 3. 새 항목 startTime은 자동으로 30분 단위 floor 처리
 * 4. 새 항목 startTime이 직전 항목 시간보다 작거나 같으면 변경 없이 반환 (호출자가 처리)
 *    이런 경우 호출자가 별도로 노티/에러 처리할 수 있도록 결과 메타 반환
 *
 * @returns next: 변경된 timeline, changed: 실제로 추가됐는지
 */
export function appendWorkLocationToTimeline(
  timeline: WorkLocationTimeline,
  newItem: Omit<WorkLocationItem, 'kind'>
): { next: WorkLocationTimeline; changed: boolean; reason?: 'duplicate' | 'time_not_after_last' | 'invalid_time' } {
  const flooredStartTime = floorToHalfHour(newItem.startTime)
  if (!is30MinUnit(flooredStartTime)) {
    return { next: timeline, changed: false, reason: 'invalid_time' }
  }

  const items = Array.isArray(timeline) ? [...timeline] : []
  const lastWL = lastWorkLocation(items)
  const newDisplay = newItem.type === 'custom' && newItem.customLabel?.trim()
    ? newItem.customLabel.trim()
    : newItem.label

  // 직전 work_location과 라벨이 같으면 중복 추가 방지
  if (lastWL) {
    const lastDisplay = displayLocation(lastWL)
    if (lastDisplay === newDisplay) {
      return { next: items, changed: false, reason: 'duplicate' }
    }
  }

  // 시간 단조 증가 검사: 직전 항목이 있다면 그보다 늦어야 함
  // (직전 항목은 work_location 또는 종료 항목 직전 위치)
  const endIdx = items.findIndex(e => e.kind === 'expected_checkout' || e.kind === 'checkout')
  const insertAt = endIdx === -1 ? items.length : endIdx
  const prevEntry = insertAt > 0 ? items[insertAt - 1] : null
  if (prevEntry) {
    const prevMin = timeToMinutes(prevEntry.startTime)
    const newMin = timeToMinutes(flooredStartTime)
    if (newMin <= prevMin) {
      return { next: items, changed: false, reason: 'time_not_after_last' }
    }
  }

  const newEntry: WorkLocationItem = {
    kind: 'work_location',
    type: newItem.type,
    label: newItem.label,
    customLabel: newItem.customLabel ?? null,
    startTime: flooredStartTime,
  }

  const next = [...items.slice(0, insertAt), newEntry, ...items.slice(insertAt)]
  return { next, changed: true }
}

/**
 * 진행 중 timeline의 마지막 expected_checkout을 실제 checkout으로 확정합니다.
 * - 시간이 주어지지 않으면 기존 expected_checkout.startTime 그대로 유지
 * - 30분 floor 적용
 */
export function finalizeAsCheckout(
  timeline: WorkLocationTimeline,
  finalEndTime?: string
): WorkLocationTimeline {
  const items = Array.isArray(timeline) ? [...timeline] : []
  const idx = items.findIndex(e => e.kind === 'expected_checkout' || e.kind === 'checkout')
  if (idx === -1) return items

  const startTime = floorToHalfHour(finalEndTime ?? items[idx].startTime)
  const checkout: CheckoutItem = { kind: 'checkout', startTime }
  return [...items.slice(0, idx), checkout, ...items.slice(idx + 1)]
}

/**
 * D-1의 expected timeline을 D-day 출근보고의 prefill 값으로 변환.
 * - work_location 항목들은 그대로
 * - 마지막 expected_checkout 또는 checkout은 expected_checkout으로 통일
 *   (다음날에는 아직 진행 중이므로 expected_checkout이 자연스러움)
 */
export function prefillFromExpected(
  expected: WorkLocationTimeline | null | undefined
): WorkLocationTimeline | null {
  if (!Array.isArray(expected) || expected.length === 0) return null

  const next: WorkLocationTimeline = expected.map(e => {
    if (e.kind === 'work_location') return { ...e }
    // expected_checkout 또는 checkout → expected_checkout으로 통일
    return { kind: 'expected_checkout', startTime: e.startTime }
  })

  return next
}

// ─── 호환성 (legacy → timeline) ───────────────────────────────────────────────

/**
 * 기존 단일 컬럼 데이터를 단일 항목 timeline으로 합성합니다.
 * - timeline이 NULL인 기존 work_logs 레코드를 화면/메시지에서 균일하게 다루기 위한 fallback.
 * - fallbackCheckoutTime이 주어지면 종료 항목을 함께 만듭니다.
 *   - asExpected=true: expected_checkout으로 추가 (출근보고 진행 중)
 *   - asExpected=false: checkout으로 추가 (퇴근보고 완료)
 */
export function legacyToTimeline(opts: {
  expectedWorkLocation?: string | null
  expectedWorkLocationType?: string | null
  expectedWorkTime?: string | null
  fallbackCheckoutTime?: string | null
  asExpected?: boolean  // 기본 true (= expected_checkout)
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
      type = 'custom'
      label = WORK_LOCATION_TYPE_LABELS.custom
      customLabel = koreanRaw
    }
  }

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
    if (opts.asExpected === false) {
      timeline.push({ kind: 'checkout', startTime: checkout })
    } else {
      timeline.push({ kind: 'expected_checkout', startTime: checkout })
    }
  }

  return timeline
}

// ─── 표시 (Teams 메시지 / EW 복사) ────────────────────────────────────────────

export interface FormattedTimeline {
  lines: string[]
  /** 멀티라인 모드 여부 (work_location ≥ 2) */
  isMulti: boolean
}

/**
 * Teams 메시지용 타임라인 포매터
 * - 단일(1 work_location + 1 종료): 한 줄 — "사무실 09:00~18:00"
 * - 멀티(2개 이상의 work_location): 여러 줄 — "1. 사무실 09:00~ / 2. 재택 14:00~ / 3. 퇴근 18:00"
 *
 * 종료 라벨 분기:
 * - kind === 'checkout' → "퇴근"
 * - kind === 'expected_checkout' → "퇴근예정"
 */
export function formatTimelineForTeams(
  timeline: WorkLocationTimeline | null | undefined
): FormattedTimeline {
  const items = Array.isArray(timeline) ? timeline : []
  const workLocs = getWorkLocations(items)
  const endItem = endItemOf(items)

  if (workLocs.length === 0) {
    return { lines: ['미입력'], isMulti: false }
  }

  // 단일 모드
  if (workLocs.length === 1) {
    const wl = workLocs[0]
    const loc = displayLocation(wl)
    const end = endItem?.startTime ?? '???'
    return { lines: [`${loc} ${wl.startTime}~${end}`], isMulti: false }
  }

  // 멀티 모드: 순서대로 번호 매겨 출력
  const lines: string[] = []
  let order = 1
  for (const e of items) {
    if (e.kind === 'work_location') {
      lines.push(`${order}. ${displayLocation(e)} ${e.startTime}~`)
    } else if (e.kind === 'checkout') {
      lines.push(`${order}. 퇴근 ${e.startTime}`)
    } else {
      lines.push(`${order}. 퇴근예정 ${e.startTime}`)
    }
    order++
  }
  return { lines, isMulti: true }
}

/**
 * EW 복사 문구의 근무장소 부분에 들어갈 요약 문자열.
 * - 단일: "사무실"  (시간 없이 라벨만)
 * - 멀티: "사무실 09:00~ / 재택 14:00~"  (종료 항목은 제외)
 */
export function buildLocationSummary(
  timeline: WorkLocationTimeline | null | undefined
): string {
  const items = Array.isArray(timeline) ? timeline : []
  const workLocs = getWorkLocations(items)
  if (workLocs.length === 0) return ''
  if (workLocs.length === 1) {
    return displayLocation(workLocs[0])
  }
  return workLocs.map(wl => `${displayLocation(wl)} ${wl.startTime}~`).join(' / ')
}

/** 항목의 화면 표시 라벨 (custom인 경우 customLabel 우선) */
export function displayLocation(item: WorkLocationItem): string {
  if (item.type === 'custom' && item.customLabel?.trim()) {
    return item.customLabel.trim()
  }
  return item.label || WORK_LOCATION_TYPE_LABELS[item.type] || '미입력'
}
