'use client'

import { EwCalculationResult } from '@/lib/ew-calculator'

interface CalculationPreviewProps {
  result: EwCalculationResult | null
  error: string | null
}

/** 분 → 'H:MM' 표기. 음수는 0으로 clamp. (예: 90 → '1:30', 0 → '0:00') */
function fmtMin(totalMinutes: number): string {
  const m = Math.max(0, Math.round(totalMinutes))
  const h = Math.floor(m / 60)
  const mm = m % 60
  return `${h}:${String(mm).padStart(2, '0')}`
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

  // 점심시간 자동 처리에 어색한 케이스 — ew-calculator가 동일 조건으로 결과에 플래그.
  // copyText 끝에도 자동으로 ' / 휴게시간 주의하여 상신' 붙음.
  const showLunchAdvisory = result.showLunchAdvisory

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
    <div className="bg-surface border border-border rounded-2xl shadow-[var(--shadow-card)] overflow-hidden">
      <div className="px-5 py-4 border-b border-border bg-background">
        <h3 className="text-base font-semibold text-text-primary">계산 결과</h3>
      </div>
      <div className="px-5 py-5 space-y-4">
        {sunNotice && (
          <div className="rounded-[10px] border-2 border-danger-text bg-danger-bg px-3 py-2.5 text-[13px] font-semibold text-danger-text">
            ⚠ {sunNotice}
          </div>
        )}

        {/* 계산 흐름 — 실제 출/퇴근 → 항목별 차감 → 실근무
            종일 휴가일 땐 수식이 의미 없어 별도 표시 */}
        {result.isFullDayLeave ? (
          <div className="rounded-[10px] border border-border bg-surface-muted px-3 py-3 text-center">
            <p className="text-[12px] font-semibold text-text-secondary">종일 휴가</p>
            <p className="mt-1 text-lg font-bold text-text-primary">실근무 0:00</p>
          </div>
        ) : (
          <div className="rounded-[10px] border border-border bg-surface-muted px-3 py-3">
            {/* 출/퇴근 시각 강조 */}
            <div className="flex items-end justify-center gap-3">
              <div className="text-center">
                <p className="text-2xl font-bold tabular-nums text-text-primary leading-none">{result.startTimeText}</p>
                <p className="mt-1 text-[11px] text-text-secondary">실제 출근</p>
              </div>
              <span className="pb-4 text-text-secondary">~</span>
              <div className="text-center">
                <p className="text-2xl font-bold tabular-nums text-text-primary leading-none">{result.endTimeText}</p>
                <p className="mt-1 text-[11px] text-text-secondary">실제 퇴근</p>
              </div>
            </div>

            {/* 항목별 차감 표 */}
            <dl className="mt-3 space-y-1 text-[13px] tabular-nums">
              <div className="flex justify-between text-text-secondary">
                <dt>총 근무 (퇴근 − 출근)</dt>
                <dd className="font-semibold text-text-primary">{fmtMin(result.totalSpanMinutes)}</dd>
              </div>
              <div className="flex justify-between text-text-secondary">
                <dt>− 점심 자동 차감</dt>
                <dd>{fmtMin(result.deductionMinutes)}</dd>
              </div>
              <div className="flex justify-between text-text-secondary">
                <dt>− 휴게</dt>
                <dd>{fmtMin(result.breakMinutes)}</dd>
              </div>
              {/* 토요일·일요일·공휴일 근무에선 휴가 개념이 일반적으로 안 쓰이므로 hide */}
              {result.workSubType === null && (
                <div className="flex justify-between text-text-secondary">
                  <dt>− 휴가</dt>
                  <dd>{fmtMin(result.leaveMinutes)}</dd>
                </div>
              )}
              <div className="mt-1 pt-2 border-t border-border flex justify-between">
                <dt className="font-semibold text-text-primary">실근무</dt>
                <dd className="font-bold text-primary-600 text-base">{result.actualWorkText}</dd>
              </div>
            </dl>
          </div>
        )}

        {/* EW 시간/코드 — 강조 카드.
            간주근로 8h 미만이면 EW 코드 자체가 유효하지 않은 상태(예: 17:30~17:30)이므로 hide.
            대신 아래 노란 advisory 박스를 강조해서 사용자에게 근무유형 변경 유도. */}
        {!showDeemedWorkAdvisory && (
          <div>
            <p className="text-[12px] font-semibold text-text-secondary">EW 시간/코드</p>
            <p className="mt-1 text-lg font-bold tabular-nums text-primary-600">{result.ewValue}</p>
          </div>
        )}

        {showLunchAdvisory && (
          <div className="rounded-[10px] border-2 border-danger-text bg-danger-bg px-3 py-2.5 text-[13px] font-semibold text-danger-text">
            ⚠ 점심시간 진행 여부에 따라 근무시간을 별도 계산하여 EW에 상신해주세요.
          </div>
        )}

        {showDeemedWorkAdvisory && (
          <div className="rounded-[10px] border-2 border-warning-border bg-warning-bg px-3 py-3 text-[13px] font-semibold text-warning-text">
            ⚠ 간주근로는 8시간 이상의 외근시 L1~L9으로 인정됩니다. 실근무 8시간 미만이면 근무유형을 &lsquo;기본근무 등록&rsquo;으로 변경해주세요.
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
