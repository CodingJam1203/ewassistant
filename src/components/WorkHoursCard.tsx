'use client'

/**
 * 월별 근로현황 진행 바 카드
 *
 * - 흰색 surface + 옅은 primary tint
 * - 진행 바: 인정 근로시간 = primary 또는 위험도에 따른 semantic 색
 * - 법정기본 기준선 = warning 톤
 * - user 대시보드, 관리자 상세 카드에서 공통 사용
 */

import {
  fmtHours,
  riskLabel,
  riskBadgeVariant,
  type MonthBaselines,
  type UserMonthSummary,
  type RiskLevel,
} from '@/lib/utils/work-hours'
import { Badge } from '@/components/ui'
import { cn } from '@/lib/utils/cn'

interface WorkHoursCardProps {
  baselines: MonthBaselines
  summary: UserMonthSummary
  /** 카드 상단에 보이는 부제목 (예: 본인 이름 또는 "내 현황"). 없으면 미표시 */
  subtitle?: string
  /** 컴팩트 모드 — 패딩/글자 크기 줄이고 항목 그리드 숨김. mypage 상단용 */
  compact?: boolean
}

/** Risk → progress fill의 hex 색 (semantic token에 매핑된 값) */
function riskFillColor(level: RiskLevel): string {
  switch (level) {
    case 'over':    return '#DC2626' // danger-text
    case 'danger':  return '#DC2626' // danger-text
    case 'caution': return '#B45309' // warning-text
    default:        return '#1D4ED8' // primary-600
  }
}

export default function WorkHoursCard({ baselines, summary, subtitle, compact }: WorkHoursCardProps) {
  const monthLabel = `${baselines.year}년 ${baselines.month}월 근로현황`

  const total = baselines.maxLimitHours
  const progress = total > 0 ? Math.min(1, summary.recognizedHours / total) : 0
  const legalBaseRatio = total > 0 ? Math.min(1, baselines.legalBaseHours / total) : 0.769

  const fillColor = riskFillColor(summary.risk)
  const overPercent = Math.round(summary.overRate * 100)
  const planHours = baselines.standardHours

  return (
    <div
      className={cn(
        'rounded-2xl bg-surface border border-border shadow-[var(--shadow-card)]',
        compact ? 'p-4 space-y-3' : 'p-5 sm:p-6 space-y-4',
      )}
    >
      {/* 헤더 */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0 flex items-baseline gap-3 flex-wrap">
          <h3 className={cn('font-bold text-text-primary tracking-tight', compact ? 'text-sm' : 'text-base sm:text-lg')}>
            {monthLabel}
          </h3>
          {compact && (
            <div className="flex items-baseline gap-1 tabular-nums">
              <span className="text-xl font-bold" style={{ color: fillColor }}>
                {fmtHours(summary.recognizedHours)}
              </span>
              <span className="text-[12px] text-text-muted">
                / {fmtHours(baselines.maxLimitHours)} h
              </span>
            </div>
          )}
          {!compact && subtitle && (
            <p className="text-[13px] text-text-secondary truncate mt-0.5">{subtitle}</p>
          )}
        </div>
        <Badge variant={riskBadgeVariant(summary.risk)} dot>
          {riskLabel(summary.risk)} {overPercent}%
        </Badge>
      </div>

      {/* 큰 인정 근로시간 (full 모드만) */}
      {!compact && (
        <div>
          <div className="text-[12px] text-text-secondary mb-1">현재 누적 인정 근로시간</div>
          <div className="flex items-baseline gap-2 tabular-nums">
            <span className="text-3xl sm:text-4xl font-bold" style={{ color: fillColor }}>
              {fmtHours(summary.recognizedHours)}
            </span>
            <span className="text-sm text-text-muted">
              / {fmtHours(baselines.maxLimitHours)} h
            </span>
          </div>
        </div>
      )}

      {/* 진행 바 */}
      <div className="space-y-1">
        {/* 위쪽 라벨 */}
        {!compact && progress > 0 && (
          <div className="relative h-5 text-[11px] font-semibold">
            <span
              className="absolute -translate-x-1/2 px-1.5 py-0.5 rounded text-white tabular-nums"
              style={{
                left: `${Math.max(4, Math.min(96, progress * 100))}%`,
                backgroundColor: fillColor,
              }}
            >
              {fmtHours(summary.recognizedHours)}
            </span>
          </div>
        )}
        {/* 진행 바 본체 */}
        <div className={cn('relative bg-surface-muted rounded-full overflow-hidden border border-border', compact ? 'h-2' : 'h-3')}>
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{ width: `${progress * 100}%`, backgroundColor: fillColor }}
          />
          {/* 법정기본 기준선 (warning) */}
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-warning-text"
            style={{ left: `${legalBaseRatio * 100}%` }}
            title={`법정기본 ${fmtHours(baselines.legalBaseHours)}h`}
          />
        </div>
        {/* 아래쪽 라벨 */}
        {compact ? (
          <div className="relative h-4 text-[10px] text-text-muted tabular-nums">
            <span className="absolute left-0">0</span>
            <span
              className="absolute -translate-x-1/2 text-warning-text font-medium"
              style={{ left: `${legalBaseRatio * 100}%` }}
            >
              법정 {fmtHours(baselines.legalBaseHours)}
            </span>
            <span className="absolute right-0">{fmtHours(baselines.maxLimitHours)} h</span>
          </div>
        ) : (
          <div className="relative h-5 text-[10px] tabular-nums">
            <span className="absolute left-0 text-text-muted">0</span>
            <span
              className="absolute -translate-x-1/2 text-warning-text font-medium"
              style={{ left: `${legalBaseRatio * 100}%` }}
            >
              법정 {fmtHours(baselines.legalBaseHours)}
            </span>
            <span className="absolute right-0 text-text-secondary font-medium">
              한도 {fmtHours(baselines.maxLimitHours)}
            </span>
          </div>
        )}
      </div>

      {/* 항목 그리드 */}
      {compact ? (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-text-secondary pt-2 border-t border-border tabular-nums">
          <span>실근로 <strong className="text-text-primary">{fmtHours(summary.actualHours)}h</strong></span>
          <span>휴가 <strong className="text-text-primary">{fmtHours(summary.leaveHours)}h</strong></span>
          <span>
            잔여 <strong className={summary.remainingHours <= 0 ? 'text-danger-text' : 'text-text-primary'}>
              {fmtHours(summary.remainingHours)}h
            </strong>
          </span>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm pt-3 border-t border-border tabular-nums">
          <Row label="실근로 시간"      value={`${fmtHours(summary.actualHours)} h`} />
          <Row label="휴가 시간"        value={`${fmtHours(summary.leaveHours)} h`} />
          <Row label="월 계획 시간"     value={`${fmtHours(planHours)} h`} />
          <Row
            label="잔여 가능 시간"
            value={`${fmtHours(summary.remainingHours)} h`}
            tone={summary.remainingHours <= 0 ? 'danger' : 'default'}
          />
          <Row label="법정기본근로시간" value={`${fmtHours(baselines.legalBaseHours)} h`} muted />
          <Row label="최대한도시간"     value={`${fmtHours(baselines.maxLimitHours)} h`} muted />
        </div>
      )}
    </div>
  )
}

function Row({
  label, value, tone = 'default', muted,
}: {
  label: string
  value: string
  tone?: 'default' | 'danger'
  muted?: boolean
}) {
  return (
    <div className="flex items-center justify-between gap-2 min-w-0">
      <span className={cn('text-xs shrink-0', muted ? 'text-text-muted' : 'text-text-secondary')}>
        {label}
      </span>
      <span
        className={cn(
          'font-semibold text-sm truncate',
          muted ? 'text-text-secondary' : 'text-text-primary',
          tone === 'danger' && 'text-danger-text',
        )}
      >
        {value}
      </span>
    </div>
  )
}
