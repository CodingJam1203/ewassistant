'use client'

import { EwCalculationResult } from '@/lib/ew-calculator'

interface CalculationPreviewProps {
  result: EwCalculationResult | null
  error: string | null
}

export default function CalculationPreview({ result, error }: CalculationPreviewProps) {
  if (error) {
    return (
      <div className="rounded-2xl border border-danger-border bg-danger-bg p-5">
        <h3 className="text-sm font-semibold text-danger-text">계산 오류</h3>
        <p className="mt-2 text-sm text-danger-text/90">{error}</p>
      </div>
    )
  }

  if (!result) {
    return (
      <div className="rounded-2xl border border-border bg-surface-muted p-6 flex items-center justify-center h-full min-h-[200px]">
        <p className="text-sm text-text-muted">필수 항목을 모두 입력하면 결과가 표시됩니다.</p>
      </div>
    )
  }

  // 점심시간 자동 처리에 어색한 케이스 — 별도 계산 안내:
  //   1) 실근무 4시간 이하 (= 240분 이하)
  //   2) 공휴일근로 (workTypeCode=3): X=0
  const showLunchAdvisory =
    result.actualWorkMinutes <= 4 * 60 || result.workTypeCode === 3

  // 간주근로(workTypeCode=2)는 8h 이상에서 L1~L9 코드로 인정. 8h 미만은 EW 표시
  // 형식이 어색해질 수 있어 기본근무로 변경 안내.
  const showDeemedWorkAdvisory =
    result.workTypeCode === 2 && result.actualWorkMinutes < 8 * 60

  // 일요일·공휴일 근무 sub-type 안내 — EW를 토요일/일요일 중 어디로 상신할지 강조
  const sunNotice: string | null =
    result.workSubType === 'sun_optional'
      ? '일요일/공휴일이지만 본인의 선택으로 근로한 건입니다. 근무시간을 토요일로 상신해주세요.'
      : result.workSubType === 'sun_required'
        ? '일요일/공휴일이지만 행사, 고객사 요청으로 주말 근무하는 건입니다. 근무시간을 일요일로 상신해주세요.'
        : null

  return (
    <div className="bg-surface border border-border rounded-2xl shadow-[var(--shadow-card)] overflow-hidden sticky top-6">
      <div className="px-5 py-4 border-b border-border bg-background">
        <h3 className="text-base font-semibold text-text-primary">계산 결과</h3>
      </div>
      <div className="px-5 py-5 space-y-4">
        {sunNotice && (
          <div className="rounded-[10px] border-2 border-danger-text bg-danger-bg px-3 py-2.5 text-[13px] font-semibold text-danger-text">
            ⚠ {sunNotice}
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-[12px] font-semibold text-text-secondary">실근무시간</p>
            <p className="mt-1 text-lg font-bold tabular-nums text-text-primary">{result.actualWorkText}</p>
          </div>
          <div>
            <p className="text-[12px] font-semibold text-text-secondary">차감시간</p>
            <p className="mt-1 text-lg font-bold tabular-nums text-text-primary">{result.deductionMinutes / 60}시간</p>
          </div>
          <div className="col-span-2">
            <p className="text-[12px] font-semibold text-text-secondary">EW 시간/코드</p>
            <p className="mt-1 text-lg font-bold tabular-nums text-primary-600">{result.ewValue}</p>
          </div>
        </div>

        {showLunchAdvisory && (
          <div className="rounded-[10px] border border-warning-border bg-warning-bg px-3 py-2 text-[12px] text-warning-text">
            * 점심시간 진행 여부에 따라 근무시간을 별도 계산하여 EW에 상신해주세요.
          </div>
        )}

        {showDeemedWorkAdvisory && (
          <div className="rounded-[10px] border border-warning-border bg-warning-bg px-3 py-2 text-[12px] text-warning-text">
            * 간주근로는 보통 8시간 이상 근무 시 L1~L9 코드로 인정됩니다. 실근무 8시간 미만이면 <span className="font-semibold">근무유형을 &lsquo;기본근무 등록&rsquo;</span>으로 변경해주세요.
          </div>
        )}

        <div className="pt-4 border-t border-border">
          <p className="text-[12px] font-semibold text-text-secondary mb-2">복사용 문구 미리보기</p>
          <div className="bg-surface-muted border border-border p-3 rounded-[10px] text-[13px] font-mono text-text-primary break-words whitespace-pre-wrap">
            {result.copyText}
          </div>
        </div>
      </div>
    </div>
  )
}
