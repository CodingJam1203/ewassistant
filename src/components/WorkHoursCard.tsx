'use client'

/**
 * 월별 근로현황 진행 바 카드
 *  - 어두운 남색 배경 + 흰색 텍스트 + 청록 액센트
 *  - 진행 바: 전체 길이 = 최대한도시간, 인정 근로시간 청록색 fill,
 *             법정기본 위치에 주황 세로선
 *  - user 대시보드, 관리자 상세 카드에서 공통 사용
 */

import { fmtHours, type MonthBaselines, type UserMonthSummary, riskLabel, type RiskLevel } from '@/lib/utils/work-hours'

interface WorkHoursCardProps {
  baselines: MonthBaselines
  summary: UserMonthSummary
  /** 카드 상단에 보이는 부제목 (예: 본인 이름 또는 "내 현황"). 없으면 미표시 */
  subtitle?: string
}

function riskAccentColor(level: RiskLevel): string {
  switch (level) {
    case 'over':    return '#ef4444' // red-500
    case 'danger':  return '#fb923c' // orange-400
    case 'caution': return '#facc15' // yellow-400
    default:        return '#14b8a6' // teal-500 (정상 = 청록)
  }
}

export default function WorkHoursCard({ baselines, summary, subtitle }: WorkHoursCardProps) {
  const monthLabel = `${baselines.year}년 ${baselines.month}월 근로현황`

  // 진행 바 비율
  const total = baselines.maxLimitHours
  const progress = total > 0 ? Math.min(1, summary.recognizedHours / total) : 0
  const legalBaseRatio = total > 0 ? Math.min(1, baselines.legalBaseHours / total) : 0.769  // 40/52

  const accent = riskAccentColor(summary.risk)
  const overPercent = Math.round(summary.overRate * 100)
  const planHours = baselines.standardHours  // 월 계획 시간 = 소정기준

  return (
    <div className="rounded-2xl bg-slate-900 text-white shadow-lg p-5 sm:p-6 space-y-4">
      {/* 헤더 */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-base sm:text-lg font-semibold tracking-tight">{monthLabel}</h3>
          {subtitle && (
            <p className="text-xs sm:text-sm text-slate-300 truncate mt-0.5">{subtitle}</p>
          )}
        </div>
        <span
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold flex-shrink-0"
          style={{ backgroundColor: `${accent}20`, color: accent }}
        >
          ● {riskLabel(summary.risk)} {overPercent}%
        </span>
      </div>

      {/* 큰 인정 근로시간 */}
      <div>
        <div className="text-xs text-slate-300 mb-1">현재 누적 인정 근로시간</div>
        <div className="flex items-baseline gap-2">
          <span className="text-3xl sm:text-4xl font-bold" style={{ color: accent }}>
            {fmtHours(summary.recognizedHours)}
          </span>
          <span className="text-sm text-slate-400">
            / {fmtHours(baselines.maxLimitHours)} h
          </span>
        </div>
      </div>

      {/* 진행 바 */}
      <div className="space-y-1.5">
        <div className="relative h-3 bg-slate-700/60 rounded-full overflow-hidden">
          {/* fill */}
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              width: `${progress * 100}%`,
              backgroundColor: accent,
            }}
          />
          {/* 법정기본 기준선 (주황) */}
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-orange-400"
            style={{ left: `${legalBaseRatio * 100}%` }}
            title={`법정기본 ${fmtHours(baselines.legalBaseHours)}h`}
          />
        </div>
        {/* 기준선 라벨 */}
        <div className="relative h-4 text-[10px] text-slate-400">
          <span className="absolute left-0">0</span>
          <span
            className="absolute -translate-x-1/2 text-orange-300"
            style={{ left: `${legalBaseRatio * 100}%` }}
          >
            법정 {fmtHours(baselines.legalBaseHours)}h
          </span>
          <span className="absolute right-0">한도 {fmtHours(baselines.maxLimitHours)}h</span>
        </div>
      </div>

      {/* 항목 그리드 */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm pt-2 border-t border-slate-700/60">
        <Row label="실근로 시간"      value={`${fmtHours(summary.actualHours)} h`} />
        <Row label="휴가 시간"        value={`${fmtHours(summary.leaveHours)} h`} />
        <Row label="월 계획 시간"     value={`${fmtHours(planHours)} h`} />
        <Row label="잔여 가능 시간"   value={`${fmtHours(summary.remainingHours)} h`}
             accent={summary.remainingHours <= 0 ? '#ef4444' : undefined} />
        <Row label="법정기본근로시간" value={`${fmtHours(baselines.legalBaseHours)} h`} muted />
        <Row label="최대한도시간"     value={`${fmtHours(baselines.maxLimitHours)} h`} muted />
      </div>
    </div>
  )
}

function Row({ label, value, accent, muted }: { label: string; value: string; accent?: string; muted?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2 min-w-0">
      <span className={`${muted ? 'text-slate-500' : 'text-slate-300'} text-xs flex-shrink-0`}>{label}</span>
      <span
        className={`${muted ? 'text-slate-400' : 'text-white'} font-semibold text-sm truncate`}
        style={accent ? { color: accent } : undefined}
      >
        {value}
      </span>
    </div>
  )
}
