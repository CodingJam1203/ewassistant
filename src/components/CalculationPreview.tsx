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

  return (
    <div className="bg-surface border border-border rounded-2xl shadow-[var(--shadow-card)] overflow-hidden sticky top-6">
      <div className="px-5 py-4 border-b border-border bg-background">
        <h3 className="text-base font-semibold text-text-primary">계산 결과</h3>
      </div>
      <div className="px-5 py-5 space-y-4">
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
