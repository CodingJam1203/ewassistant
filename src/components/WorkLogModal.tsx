'use client'

import { useState, useCallback } from 'react'
import { X } from 'lucide-react'
import WorkLogForm from '@/components/WorkLogForm'
import CalculationPreview from '@/components/CalculationPreview'
import { EwCalculationResult } from '@/lib/ew-calculator'
import type { WorkLocationTimeline } from '@/types/work-location-timeline'
import type { LeaveTimeline } from '@/types/leave-timeline'

interface WorkLogModalProps {
  date: string           // YYYY-MM-DD — 퇴근 날짜, check-out API에 전달
  userName: string | null
  /** 오늘의 실제 work_location_timeline (출근보고/근무지변경 누적분) */
  initialTimeline?: WorkLocationTimeline | null
  /** 오늘의 leave_timeline (휴가/반차) */
  initialLeaveTimeline?: LeaveTimeline | null
  /** 휴게 시작/종료 로그 누적 실제 분 (휴게 자동 계산값) */
  initialBreakAutoActualMinutes?: number | null
  initialStartTime?: string  // legacy fallback
  initialEndTime?: string    // legacy fallback
  resubmitWorkLogId?: string | null // 퇴근취소 후 재제출일 때 기존 로그 ID
  onClose: () => void
  onSuccess: () => void  // 폼 제출 + check-out 완료 후 호출
}

export default function WorkLogModal({
  date,
  userName,
  initialTimeline,
  initialLeaveTimeline,
  initialBreakAutoActualMinutes,
  initialStartTime,
  initialEndTime,
  resubmitWorkLogId,
  onClose,
  onSuccess,
}: WorkLogModalProps) {
  const [calculationResult, setCalculationResult] = useState<EwCalculationResult | null>(null)
  const [calculationError, setCalculationError]   = useState<string | null>(null)
  const [checkingOut, setCheckingOut]             = useState(false)

  const handleCalculate = useCallback(
    (result: EwCalculationResult | null, error: string | null) => {
      setCalculationResult(prev => JSON.stringify(prev) === JSON.stringify(result) ? prev : result)
      setCalculationError(prev => prev === error ? prev : error)
    },
    []
  )

  // WorkLogForm 제출 성공 → check-out API 호출 → 모달 닫기
  const handleSubmitSuccess = async () => {
    setCheckingOut(true)
    try {
      await fetch('/api/team-status/check-out', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date }),
      })
    } catch {
      // check-out 실패해도 보고서는 저장됐으므로 그냥 진행
    } finally {
      setCheckingOut(false)
    }
    onSuccess()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 overflow-y-auto py-6 px-4"
    >
      <div className="relative w-full max-w-5xl bg-white dark:bg-gray-800 rounded-2xl shadow-2xl">
        {/* 헤더 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <div>
            <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">출퇴근보고 입력</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{date} — 퇴근보고를 작성하면 퇴근 처리됩니다</p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* 본문 */}
        <div className="p-6">
          {checkingOut ? (
            <div className="py-12 text-center">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-4 border-gray-200 border-t-blue-600 mb-3" />
              <p className="text-sm text-gray-500">퇴근 처리 중...</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              <div className="lg:col-span-2">
                <WorkLogForm
                  userName={userName}
                  initialTimeline={initialTimeline}
                  initialLeaveTimeline={initialLeaveTimeline}
                  initialBreakAutoActualMinutes={initialBreakAutoActualMinutes}
                  initialStartTime={initialStartTime}
                  initialEndTime={initialEndTime}
                  resubmitLogId={resubmitWorkLogId}
                  onCalculate={handleCalculate}
                  onSubmitSuccess={handleSubmitSuccess}
                />
              </div>
              <div className="lg:col-span-1">
                <CalculationPreview result={calculationResult} error={calculationError} />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
