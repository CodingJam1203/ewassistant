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
  /** 컴팩트 모드 — 패딩/글자 크기 줄이고 항목 그리드 숨김. mypage 상단용 */
  compact?: boolean
}

function riskAccentColor(level: RiskLevel): string {
  switch (level) {
    case 'over':    return '#ef4444' // red-500
    case 'danger':  return '#fb923c' // orange-400
    case 'caution': return '#facc15' // yellow-400
    default:        return '#14b8a6' // teal-500 (정상 = 청록)
  }
}

export default function WorkHoursCard({ baselines, summary, subtitle, compact }: WorkHoursCardProps) {
  const monthLabel = `${baselines.year}년 ${baselines.month}월 근로현황`

  // 진행 바 비율
  const total = baselines.maxLimitHours
  const progress = total > 0 ? Math.min(1, summary.recognizedHours / total) : 0
  const legalBaseRatio = total > 0 ? Math.min(1, baselines.legalBaseHours / total) : 0.769  // 40/52

  const accent = riskAccentColor(summary.risk)
  const overPercent = Math.round(summary.overRate * 100)
  const planHours = baselines.standardHours  // 월 계획 시간 = 소정기준

  return (
    <div className={`rounded-xl bg-slate-900 text-white shadow ${compact ? 'p-3 sm:p-4 space-y-2' : 'rounded-2xl shadow-lg p-5 sm:p-6 space-y-4'}`}>
      {/* 헤더 + (compact일 땐 인정근로 한 줄에 함께) */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0 flex items-baseline gap-3 flex-wrap">
          <h3 className={`${compact ? 'text-sm' : 'text-base sm:text-lg'} font-semibold tracking-tight`}>{monthLabel}</h3>
          {compact && (
            <div className="flex items-baseline gap-1">
              <span className="text-xl font-bold" style={{ color: accent }}>
                {fmtHours(summary.recognizedHours)}
              </span>
              <span className="text-xs text-slate-400">
                / {fmtHours(baselines.maxLimitHours)} h
              </span>
            </div>
          )}
          {!compact && subtitle && (
            <p className="text-xs sm:text-sm text-slate-300 truncate mt-0.5">{subtitle}</p>
          )}
        </div>
        <span
          className={`inline-flex items-center gap-1 ${compact ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs'} rounded-full font-semibold flex-shrink-0`}
          style={{ backgroundColor: `${accent}20`, color: accent }}
        >
          ● {riskLabel(summary.risk)} {overPercent}%
        </span>
      </div>

      {/* 큰 인정 근로시간 (full 모드만) */}
      {!compact && (
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
      )}

      {/* 진행 바 — 시작점/소정/법정/최대한도 4개 마커 + fill 강조 */}
      <div className="space-y-1">
        {/* 위쪽 라벨 (compact 모드는 숨김) */}
        {!compact && (
          <div className="relative h-5 text-[11px] font-semibold">
            {progress > 0 && (
              <span
                className="absolute -translate-x-1/2 px-1.5 py-0.5 rounded text-white"
                style={{
                  left: `${Math.max(4, Math.min(96, progress * 100))}%`,
                  backgroundColor: accent,
                }}
              >
                {fmtHours(summary.recognizedHours)}
              </span>
            )}
          </div>
        )}
        {/* 진행 바 본체 */}
        <div className={`relative ${compact ? 'h-2' : 'h-3'} bg-slate-700/60 rounded-full overflow-hidden`}>
          {/* fill */}
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{ width: `${progress * 100}%`, backgroundColor: accent }}
          />
          {/* 소정기준 마커 (노랑) — 법정과 동일하지만 시각적 명확성 위해 표시는 분리 가능 */}
          {/* 현재 정의상 소정 = 법정이라 같은 위치. 향후 분리 시 다른 위치 표시 가능 */}
          {/* 법정기본 기준선 (주황) */}
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-orange-400"
            style={{ left: `${legalBaseRatio * 100}%` }}
            title={`법정기본 ${fmtHours(baselines.legalBaseHours)}h`}
          />
        </div>
        {/* 아래쪽 라벨 — compact 모드는 단순화 */}
        {compact ? (
          <div className="relative h-4 text-[10px] text-slate-400">
            <span className="absolute left-0">0</span>
            <span className="absolute -translate-x-1/2 text-orange-300"
                  style={{ left: `${legalBaseRatio * 100}%` }}>
              법정 {fmtHours(baselines.legalBaseHours)}
            </span>
            <span className="absolute right-0">{fmtHours(baselines.maxLimitHours)} h</span>
          </div>
        ) : (
          <div className="relative h-5 text-[10px]">
            <span className="absolute left-0 text-slate-500">0</span>
            <span
              className="absolute -translate-x-1/2 text-orange-300 font-medium"
              style={{ left: `${legalBaseRatio * 100}%` }}
            >
              법정 {fmtHours(baselines.legalBaseHours)}
            </span>
            <span className="absolute right-0 text-slate-300 font-medium">
              한도 {fmtHours(baselines.maxLimitHours)}
            </span>
          </div>
        )}
      </div>

      {/* 항목 그리드 — compact 모드는 한 줄 inline summary */}
      {compact ? (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-300 pt-1 border-t border-slate-700/60">
          <span>실근로 <strong className="text-white">{fmtHours(summary.actualHours)}h</strong></span>
          <span>휴가 <strong className="text-white">{fmtHours(summary.leaveHours)}h</strong></span>
          <span>잔여 <strong style={{ color: summary.remainingHours <= 0 ? '#ef4444' : '#fff' }}>{fmtHours(summary.remainingHours)}h</strong></span>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm pt-2 border-t border-slate-700/60">
          <Row label="실근로 시간"      value={`${fmtHours(summary.actualHours)} h`} />
          <Row label="휴가 시간"        value={`${fmtHours(summary.leaveHours)} h`} />
          <Row label="월 계획 시간"     value={`${fmtHours(planHours)} h`} />
          <Row label="잔여 가능 시간"   value={`${fmtHours(summary.remainingHours)} h`}
               accent={summary.remainingHours <= 0 ? '#ef4444' : undefined} />
          <Row label="법정기본근로시간" value={`${fmtHours(baselines.legalBaseHours)} h`} muted />
          <Row label="최대한도시간"     value={`${fmtHours(baselines.maxLimitHours)} h`} muted />
        </div>
      )}
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
