/**
 * 근로시간 계산 유틸리티
 *
 * 월별 기준시간 (모두 해당 월의 총일수로 계산):
 *   소정기준근로시간 = 40 * (총일수 / 7)
 *   법정기본근로시간 = 40 * (총일수 / 7)
 *   최대한도시간     = 52 * (총일수 / 7)
 *
 * 인정 근로시간 = 실근로시간 (이번 정의에서는 동일)
 * 잔여 가능 시간 = 최대한도시간 - 인정 근로
 * 초과율         = 인정 근로 / 최대한도시간
 *
 * 위험 분류:
 *   정상  최대한도시간의 80% 미만
 *   주의  80% 이상 ~ 90% 미만
 *   위험  90% 이상 ~ 100% 미만
 *   초과  100% 이상
 */

export type RiskLevel = 'normal' | 'caution' | 'danger' | 'over'

export interface MonthBaselines {
  year: number
  month: number          // 1~12
  daysInMonth: number    // 28~31
  /** 소정기준근로시간 = 40 * (총일수 / 7) — 시간 단위 (소수 1자리) */
  standardHours: number
  /** 법정기본근로시간 = 40 * (총일수 / 7) — 동일 */
  legalBaseHours: number
  /** 최대한도시간 = 52 * (총일수 / 7) */
  maxLimitHours: number
}

export interface UserMonthSummary {
  email: string
  display_name: string | null
  division: string | null
  team: string | null
  /** 인정 근로시간(시간) */
  recognizedHours: number
  /** 실근로시간(시간) */
  actualHours: number
  /** 휴가시간(시간) */
  leaveHours: number
  /** 잔여 가능 시간(시간) */
  remainingHours: number
  /** 초과율 (0.0 ~ 1.5+) */
  overRate: number
  /** 위험 상태 */
  risk: RiskLevel
}

/** 해당 월의 총일수 */
export function getDaysInMonth(year: number, month1based: number): number {
  return new Date(year, month1based, 0).getDate()
}

/** 시간을 소수점 1자리로 정리 (정수면 정수로) */
export function fmtHours(h: number): string {
  if (!Number.isFinite(h)) return '0'
  const rounded = Math.round(h * 10) / 10
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
}

/** 분 → 시간(소수점 보존) */
export function minutesToHours(min: number): number {
  return Math.max(0, min) / 60
}

/** 월 기준시간 계산 */
export function getMonthBaselines(year: number, month1based: number): MonthBaselines {
  const days = getDaysInMonth(year, month1based)
  const ratio = days / 7
  const standard = Math.round(40 * ratio * 10) / 10
  const max     = Math.round(52 * ratio * 10) / 10
  return {
    year,
    month: month1based,
    daysInMonth: days,
    standardHours: standard,
    legalBaseHours: standard,
    maxLimitHours: max,
  }
}

/** 위험 분류 — 비율 기준 */
export function classifyRisk(recognizedHours: number, maxLimitHours: number): RiskLevel {
  if (maxLimitHours <= 0) return 'normal'
  const ratio = recognizedHours / maxLimitHours
  if (ratio >= 1) return 'over'
  if (ratio >= 0.9) return 'danger'
  if (ratio >= 0.8) return 'caution'
  return 'normal'
}

/** 위험 라벨 */
export function riskLabel(level: RiskLevel): string {
  switch (level) {
    case 'over':    return '초과'
    case 'danger':  return '위험'
    case 'caution': return '주의'
    default:        return '정상'
  }
}

/**
 * @deprecated 디자인 시스템 정비 후 직접 클래스 발급은 비권장.
 *   새 코드에서는 `riskBadgeVariant(level)` + `<Badge variant=...>` 사용.
 *   호환을 위해 semantic 토큰 기반 클래스로 매핑 갱신.
 */
export function riskBadgeClass(level: RiskLevel): string {
  switch (level) {
    case 'over':    return 'bg-danger-bg text-danger-text border border-danger-border'
    case 'danger':  return 'bg-danger-bg text-danger-text border border-danger-border'
    case 'caution': return 'bg-warning-bg text-warning-text border border-warning-border'
    default:        return 'bg-success-bg text-success-text border border-success-border'
  }
}

/** RiskLevel → 디자인 시스템 BadgeVariant 매핑 */
export type RiskBadgeVariant = 'success' | 'warning' | 'danger'
export function riskBadgeVariant(level: RiskLevel): RiskBadgeVariant {
  switch (level) {
    case 'over':    return 'danger'
    case 'danger':  return 'danger'
    case 'caution': return 'warning'
    default:        return 'success'
  }
}

/**
 * Postgres interval 또는 'HH:mm:ss' 또는 'HH:mm' 또는 분(number) → 분 단위 정수
 */
export function intervalToMinutes(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0
  if (typeof value === 'number') return Math.max(0, Math.round(value))
  if (typeof value !== 'string') return 0
  const trimmed = value.trim()
  if (!trimmed) return 0
  // "HH:mm:ss" 또는 "HH:mm"
  if (/^\d{1,3}:\d{1,2}(:\d{1,2})?$/.test(trimmed)) {
    const parts = trimmed.split(':').map(s => parseInt(s, 10))
    const h = parts[0] || 0
    const m = parts[1] || 0
    return Math.max(0, h * 60 + m)
  }
  // PG interval text "1 day 02:00:00" 같은 형식 단순 fallback
  const m = trimmed.match(/(\d+)\s*day/)
  let total = 0
  if (m) total += parseInt(m[1], 10) * 24 * 60
  const t = trimmed.match(/(\d+):(\d{1,2})(?::(\d{1,2}))?/)
  if (t) {
    total += parseInt(t[1], 10) * 60 + parseInt(t[2], 10)
  }
  return Math.max(0, total)
}

/**
 * 월별 work_logs row 배열 → UserMonthSummary 1건 생성
 * 인정근로 = 실근로(actual_work_time 합)  (이번 정의)
 * 휴가시간 = leave_timeline의 차감 분 합 (옵션)
 */
export interface UserMonthInputRow {
  email: string
  display_name: string | null
  division: string | null
  team: string | null
  /** Postgres interval 텍스트 또는 분 */
  actual_work_time: string | number | null
  /** 휴가 timeline의 차감분(분) 합 — 옵션 */
  leave_minutes_sum?: number | null
}

export function summarizeUser(
  profile: { email: string; display_name: string | null; division: string | null; team: string | null },
  rows: UserMonthInputRow[],
  baselines: MonthBaselines
): UserMonthSummary {
  let actualMin = 0
  let leaveMin = 0
  for (const r of rows) {
    actualMin += intervalToMinutes(r.actual_work_time)
    leaveMin  += Math.max(0, Number(r.leave_minutes_sum ?? 0))
  }
  // 30분 정책 방어 — legacy 비30분 데이터가 합산에 들어와도 표시는 30분 단위로 정합
  // (DB의 비30분 row는 별도 SQL/마이그레이션으로 보정. 그 전에 화면 표시만 안전하게)
  actualMin = Math.round(actualMin / 30) * 30
  leaveMin  = Math.round(leaveMin  / 30) * 30
  const actualHours = minutesToHours(actualMin)
  const leaveHours  = minutesToHours(leaveMin)
  // 인정 근로 = 실근로 (현재 정책)
  const recognizedHours = actualHours
  const remainingHours = Math.max(0, baselines.maxLimitHours - recognizedHours)
  const overRate = baselines.maxLimitHours > 0
    ? recognizedHours / baselines.maxLimitHours
    : 0
  return {
    email: profile.email,
    display_name: profile.display_name,
    division: profile.division,
    team: profile.team,
    recognizedHours: Math.round(recognizedHours * 10) / 10,
    actualHours:     Math.round(actualHours * 10) / 10,
    leaveHours:      Math.round(leaveHours * 10) / 10,
    remainingHours:  Math.round(remainingHours * 10) / 10,
    overRate:        Math.round(overRate * 1000) / 1000,
    risk: classifyRisk(recognizedHours, baselines.maxLimitHours),
  }
}

// ─── 팀별 / 본부별 집계 ──────────────────────────────────────────────────────

export interface TeamSummary {
  division: string | null
  team: string | null
  totalCount: number
  normalCount: number
  cautionCount: number
  dangerCount: number
  overCount: number
  avgRecognizedHours: number
  avgOverRate: number
  totalRecognizedHours: number
  totalPlanHours: number          // = totalCount * standardHours
}

export function summarizeByTeam(
  users: UserMonthSummary[],
  baselines: MonthBaselines
): TeamSummary[] {
  const buckets = new Map<string, UserMonthSummary[]>()
  for (const u of users) {
    const key = `${u.division ?? ''}/${u.team ?? ''}`
    const arr = buckets.get(key) ?? []
    arr.push(u)
    buckets.set(key, arr)
  }
  const result: TeamSummary[] = []
  for (const [, members] of buckets) {
    const totalRecognized = members.reduce((s, m) => s + m.recognizedHours, 0)
    const sumOverRate = members.reduce((s, m) => s + m.overRate, 0)
    result.push({
      division: members[0].division,
      team: members[0].team,
      totalCount: members.length,
      normalCount:  members.filter(m => m.risk === 'normal').length,
      cautionCount: members.filter(m => m.risk === 'caution').length,
      dangerCount:  members.filter(m => m.risk === 'danger').length,
      overCount:    members.filter(m => m.risk === 'over').length,
      avgRecognizedHours: Math.round((totalRecognized / members.length) * 10) / 10,
      avgOverRate:        Math.round((sumOverRate / members.length) * 1000) / 1000,
      totalRecognizedHours: Math.round(totalRecognized * 10) / 10,
      totalPlanHours: Math.round(baselines.standardHours * members.length * 10) / 10,
    })
  }
  return result
}

/** 전체 인원 요약 (상단 요약 카드) */
export interface OverallSummary {
  totalCount: number
  normalCount: number
  cautionCount: number
  dangerCount: number
  overCount: number
  avgRecognizedHours: number
}

export function summarizeOverall(users: UserMonthSummary[]): OverallSummary {
  const totalCount = users.length
  if (totalCount === 0) {
    return { totalCount: 0, normalCount: 0, cautionCount: 0, dangerCount: 0, overCount: 0, avgRecognizedHours: 0 }
  }
  const totalRecognized = users.reduce((s, u) => s + u.recognizedHours, 0)
  return {
    totalCount,
    normalCount:  users.filter(u => u.risk === 'normal').length,
    cautionCount: users.filter(u => u.risk === 'caution').length,
    dangerCount:  users.filter(u => u.risk === 'danger').length,
    overCount:    users.filter(u => u.risk === 'over').length,
    avgRecognizedHours: Math.round((totalRecognized / totalCount) * 10) / 10,
  }
}
