'use client'

import { useState, useCallback } from 'react'
import { X, Copy, Loader2 } from 'lucide-react'
import WorkLogForm from '@/components/WorkLogForm'
import CalculationPreview from '@/components/CalculationPreview'
import { EwCalculationResult } from '@/lib/ew-calculator'
import type { WorkLocationTimeline } from '@/types/work-location-timeline'
import type { WorkLocations } from '@/types/work-locations-v2'
import type { LeaveTimeline } from '@/types/leave-timeline'
import type { WorkLog } from '@/types/work-log'
import { dowKo } from '@/lib/utils/date'

interface WorkLogModalProps {
  date: string
  userName: string | null
  /** Legacy: 오늘의 work_location_timeline (퇴근보고 prefill 호환용) */
  initialTimeline?: WorkLocationTimeline | null
  /** v2: 오늘의 actual chips (있으면 initialTimeline보다 우선) */
  initialActualLocations?: WorkLocations | null
  /** v2: 오늘의 planned chips */
  initialPlannedLocations?: WorkLocations | null
  initialLeaveTimeline?: LeaveTimeline | null
  initialBreakAutoActualMinutes?: number | null
  initialStartTime?: string
  initialEndTime?: string
  resubmitWorkLogId?: string | null
  editingLog?: WorkLog | null
  editScope?: 'check_in' | 'check_out'
  onClose: () => void
  onSuccess: () => void
}

export default function WorkLogModal({
  date,
  userName,
  initialTimeline,
  initialActualLocations,
  initialPlannedLocations,
  initialLeaveTimeline,
  initialBreakAutoActualMinutes,
  initialStartTime,
  initialEndTime,
  resubmitWorkLogId,
  editingLog,
  editScope,
  onClose,
  onSuccess,
}: WorkLogModalProps) {
  const isEditing = !!editingLog
  const [calculationResult, setCalculationResult] = useState<EwCalculationResult | null>(null)
  const [calculationError, setCalculationError]   = useState<string | null>(null)
  const [checkingOut, setCheckingOut]             = useState(false)
  const [formSubmitting, setFormSubmitting]       = useState(false)

  const handleCalculate = useCallback(
    (result: EwCalculationResult | null, error: string | null) => {
      setCalculationResult(prev => JSON.stringify(prev) === JSON.stringify(result) ? prev : result)
      setCalculationError(prev => prev === error ? prev : error)
    },
    []
  )

  const handleFormStateChange = useCallback(
    (s: { isSubmitting: boolean; submitError: string | null }) => {
      setFormSubmitting(s.isSubmitting)
    },
    []
  )

  const submitButtonLabel = isEditing
    ? (formSubmitting ? '수정 중...' : '수정하기')
    : (formSubmitting ? '제출 중...' : '제출하고 복사하기')

  const DesktopSubmitButton = (
    <button
      type="submit"
      form="work-log-form"
      disabled={formSubmitting}
      className="w-full inline-flex justify-center items-center gap-2 h-12 px-5 rounded-[10px] text-base font-semibold text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-primary-500 disabled:opacity-50 transition-colors"
    >
      {formSubmitting ? <Loader2 className="animate-spin h-5 w-5" aria-hidden /> : <Copy className="h-5 w-5" aria-hidden />}
      {submitButtonLabel}
    </button>
  )

  const handleSubmitSuccess = async () => {
    if (isEditing) {
      onSuccess()
      return
    }
    setCheckingOut(true)
    try {
      await fetch('/api/team-status/check-out', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date }),
      })
    } catch {
      // ignore
    } finally {
      setCheckingOut(false)
    }
    onSuccess()
  }

  const dateWithDow = (() => {
    const dow = dowKo(date)
    return dow ? `${date} (${dow})` : date
  })()
  const headerTitle = isEditing
    ? (editScope === 'check_in'  ? '출근보고 수정'
      : editScope === 'check_out' ? '퇴근보고 수정'
      : '제출 내역 수정')
    : '퇴근보고 작성'
  const headerSubtitle = isEditing
    ? `${dateWithDow} — 필요한 항목을 자유롭게 수정`
    : `${dateWithDow} — 실제 퇴근시간/근무지를 입력해 퇴근 처리`

  const MobileSubmitButton = (
    <button
      type="submit"
      form="work-log-form"
      disabled={formSubmitting}
      className="w-full inline-flex justify-center items-center gap-2 h-12 px-5 rounded-[10px] text-base font-semibold text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-primary-500 disabled:opacity-50 transition-colors"
    >
      {formSubmitting ? <Loader2 className="animate-spin h-5 w-5" aria-hidden /> : <Copy className="h-5 w-5" aria-hidden />}
      {submitButtonLabel}
    </button>
  )

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-start justify-center bg-black/50 sm:py-6 sm:px-4">
      <div className="relative w-full max-w-5xl bg-surface sm:rounded-[20px] shadow-[var(--shadow-popover)] flex flex-col h-[100dvh] sm:h-auto sm:max-h-[calc(100dvh-3rem)]">
        <div className="shrink-0 flex items-center justify-between px-4 sm:px-6 py-4 border-b border-border">
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-text-primary truncate">{headerTitle}</h3>
            <p className="text-[12px] text-text-secondary mt-0.5 truncate">{headerSubtitle}</p>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 inline-flex items-center justify-center h-9 w-9 rounded-[10px] text-text-muted hover:text-text-primary hover:bg-surface-muted transition-colors"
            aria-label="닫기"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          {checkingOut ? (
            <div className="py-12 text-center">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-4 border-border border-t-primary-600 mb-3" />
              <p className="text-sm text-text-secondary">퇴근 처리 중...</p>
            </div>
          ) : (
            editScope === 'check_in' ? (
              <div className="max-w-3xl">
                <WorkLogForm
                  userName={userName}
                  initialTimeline={initialTimeline}
                  initialActualLocations={initialActualLocations}
                  initialPlannedLocations={initialPlannedLocations}
                  initialLeaveTimeline={initialLeaveTimeline}
                  initialBreakAutoActualMinutes={initialBreakAutoActualMinutes}
                  initialStartTime={initialStartTime}
                  initialEndTime={initialEndTime}
                  initialLeaveDate={date}
                  resubmitLogId={resubmitWorkLogId}
                  editingLog={editingLog}
                  editScope={editScope}
                  onCalculate={handleCalculate}
                  onSubmitSuccess={handleSubmitSuccess}
                  onSubmitStateChange={handleFormStateChange}
                />
                <div className="hidden lg:block mt-4">{DesktopSubmitButton}</div>
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div className="lg:col-span-2">
                  <WorkLogForm
                    userName={userName}
                    initialTimeline={initialTimeline}
                    initialActualLocations={initialActualLocations}
                    initialPlannedLocations={initialPlannedLocations}
                    initialLeaveTimeline={initialLeaveTimeline}
                    initialBreakAutoActualMinutes={initialBreakAutoActualMinutes}
                    initialStartTime={initialStartTime}
                    initialEndTime={initialEndTime}
                    initialLeaveDate={date}
                    resubmitLogId={resubmitWorkLogId}
                    editingLog={editingLog}
                    editScope={editScope}
                    onCalculate={handleCalculate}
                    onSubmitSuccess={handleSubmitSuccess}
                    onSubmitStateChange={handleFormStateChange}
                  />
                </div>
                <div className="lg:col-span-1 space-y-4 lg:sticky lg:top-4 lg:self-start">
                  <CalculationPreview result={calculationResult} error={calculationError} />
                  <div className="hidden lg:block">{DesktopSubmitButton}</div>
                </div>
              </div>
            )
          )}
        </div>

        {!checkingOut && (
          <div className="lg:hidden shrink-0 px-4 py-3 bg-surface border-t border-border">
            {MobileSubmitButton}
          </div>
        )}
      </div>
    </div>
  )
}
