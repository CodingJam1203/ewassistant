'use client'

import { useState, useCallback } from 'react'
import { X, Copy, Loader2, Trash2 } from 'lucide-react'
import WorkLogForm from '@/components/WorkLogForm'
import CalculationPreview from '@/components/CalculationPreview'
import { EwCalculationResult } from '@/lib/ew-calculator'
import type { WorkLocationTimeline } from '@/types/work-location-timeline'
import type { WorkLocations } from '@/types/work-locations-v2'
import type { LeaveTimeline } from '@/types/leave-timeline'
import type { WorkLog } from '@/types/work-log'
import { dowKo } from '@/lib/utils/date'
import { useRegisterModalOpen } from '@/contexts/ModalOpenContext'

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
  /** 신규 퇴근보고에 그날 아침 출근 메모(work_content) prefill */
  initialWorkContent?: string | null
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
  initialWorkContent,
  resubmitWorkLogId,
  editingLog,
  editScope,
  onClose,
  onSuccess,
}: WorkLogModalProps) {
  // Stage 4: 글로벌 모달 카운터 등록
  useRegisterModalOpen()
  const isEditing = !!editingLog
  const [calculationResult, setCalculationResult] = useState<EwCalculationResult | null>(null)
  const [calculationError, setCalculationError]   = useState<string | null>(null)
  const [formSubmitting, setFormSubmitting]       = useState(false)
  // partial delete (isEditing 모드 한정) — scope는 editScope 따라감
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

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

  // ─── partial delete (isEditing 모드 — editScope에 맞춰 ?scope) ────────────
  // 같은 work_log row의 다른 영역은 보존됨 (서버에서 처리).
  // 양쪽 다 비면 서버가 자동으로 row 전체 soft-delete.
  const deleteLabel =
    editScope === 'check_in'  ? '이 출근보고 삭제'
    : editScope === 'check_out' ? '이 퇴근보고 삭제'
    : '이 보고 삭제'
  const handleDelete = useCallback(async () => {
    if (!editingLog?.id || !editScope || deleting) {
      console.log('[WorkLog delete] skip — id:', editingLog?.id, 'scope:', editScope, 'deleting:', deleting)
      return
    }
    const ok = window.confirm(
      editScope === 'check_in'
        ? `${date} 출근보고를 삭제하시겠습니까?\n같은 날 퇴근보고가 있으면 유지됩니다.`
        : `${date} 퇴근보고를 삭제하시겠습니까?\n같은 날 출근보고가 있으면 유지됩니다.`
    )
    console.log('[WorkLog delete] confirm result:', ok)
    if (!ok) return
    setDeleting(true)
    setDeleteError(null)
    try {
      console.log('[WorkLog delete] fetching DELETE id=', editingLog.id, 'scope=', editScope)
      const res = await fetch(`/api/work-logs/${editingLog.id}?scope=${editScope}`, {
        method: 'DELETE',
      })
      const text = await res.text()
      let data: { error?: string; success?: boolean; scope?: string | null; wholeRowDelete?: boolean } = {}
      try { data = text ? JSON.parse(text) : {} } catch {
        console.warn('[WorkLog delete] response not JSON:', text.slice(0, 200))
      }
      console.log('[WorkLog delete] response status=', res.status, 'body=', data)
      if (!res.ok) {
        setDeleteError(`삭제 실패 (HTTP ${res.status}): ${data.error ?? text.slice(0, 100) ?? '서버 오류'}`)
        return
      }
      console.log('[WorkLog delete] success — calling onSuccess()')
      onSuccess()
    } catch (err) {
      console.error('[WorkLog delete] network/parse error:', err)
      setDeleteError(`네트워크 오류: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setDeleting(false)
    }
  }, [editingLog?.id, editScope, deleting, date, onSuccess])

  // 간주근로(workTypeCode=2) + 실근무 8h 미만 — EW 코드 자체가 유효하지 않은 상태라 제출 차단.
  // 사용자는 advisory 안내에 따라 근무유형을 '기본근무 등록'으로 바꿔야 함.
  const submitBlocked = !!calculationResult
    && calculationResult.workTypeCode === 2
    && calculationResult.actualWorkMinutes < 8 * 60

  const submitButtonLabel = isEditing
    ? (formSubmitting ? '수정 중...' : '수정하기')
    : (formSubmitting ? '제출 중...' : '제출하고 복사하기')

  // 제출 차단 시 회색 + cursor-not-allowed. 평소엔 primary 파란색.
  const submitBtnClass = submitBlocked
    ? 'w-full inline-flex justify-center items-center gap-2 h-12 px-5 rounded-[10px] text-base font-semibold text-text-muted bg-surface-muted border border-border cursor-not-allowed transition-colors'
    : 'w-full inline-flex justify-center items-center gap-2 h-12 px-5 rounded-[10px] text-base font-semibold text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-primary-500 disabled:opacity-50 transition-colors'

  // 삭제 버튼 — isEditing + editScope 있을 때만. footer 좌하단 통일된 위치(submit 위 stack).
  const DeleteButton = isEditing && editScope ? (
    <button
      type="button"
      onClick={handleDelete}
      disabled={deleting || formSubmitting}
      className="w-full inline-flex justify-center items-center gap-2 h-10 px-4 rounded-[10px] text-sm font-medium text-danger-text bg-surface border border-border hover:bg-danger-bg hover:border-danger-border disabled:opacity-50 transition-colors"
      title={editScope === 'check_in' ? '같은 날 퇴근보고는 유지됩니다' : '같은 날 출근보고는 유지됩니다'}
    >
      {deleting ? <Loader2 className="animate-spin h-4 w-4" aria-hidden /> : <Trash2 className="h-4 w-4" aria-hidden />}
      {deleteLabel}
    </button>
  ) : null

  const DesktopSubmitButton = (
    <button
      type="submit"
      form="work-log-form"
      disabled={formSubmitting || submitBlocked || deleting}
      className={submitBtnClass}
    >
      {formSubmitting ? <Loader2 className="animate-spin h-5 w-5" aria-hidden /> : <Copy className="h-5 w-5" aria-hidden />}
      {submitButtonLabel}
    </button>
  )

  const handleSubmitSuccess = () => {
    // 모달 즉시 닫고 /api/team-status/check-out는 fire-and-forget으로 백그라운드 실행.
    // /api/work-logs POST가 이미 daily_work_status + actual_end_time을 업데이트하므로
    // 이 호출은 work_status_events 이벤트 기록 등 보조 목적. await으로 폼 영역을
    // "퇴근 처리 중..." 로딩으로 교체하면 사용자에게 깜빡이는 빈 모달이 잠깐 보임.
    if (!isEditing) {
      fetch('/api/team-status/check-out', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date }),
      }).catch(() => { /* ignore */ })
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
      disabled={formSubmitting || submitBlocked || deleting}
      className={submitBtnClass}
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
          {editScope === 'check_in' ? (
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
                initialWorkContent={initialWorkContent}
                initialLeaveDate={date}
                resubmitLogId={resubmitWorkLogId}
                editingLog={editingLog}
                editScope={editScope}
                onCalculate={handleCalculate}
                onSubmitSuccess={handleSubmitSuccess}
                onSubmitStateChange={handleFormStateChange}
              />
              {/* desktop footer — 삭제(좌하단 stack) + submit. lg:block. */}
              <div className="hidden lg:block mt-4 space-y-2">
                {DeleteButton}
                {DesktopSubmitButton}
                {deleteError && (
                  <p className="text-xs text-danger-text bg-danger-bg border border-danger-border rounded-[10px] px-3 py-2">{deleteError}</p>
                )}
              </div>
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
                  initialWorkContent={initialWorkContent}
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
                {/* desktop footer (사이드 컬럼) — 삭제(좌하단 stack) + submit. */}
                <div className="hidden lg:block space-y-2">
                  {DeleteButton}
                  {DesktopSubmitButton}
                  {deleteError && (
                    <p className="text-xs text-danger-text bg-danger-bg border border-danger-border rounded-[10px] px-3 py-2">{deleteError}</p>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* mobile sticky footer — 삭제 + submit horizontal */}
        <div className="lg:hidden shrink-0 px-4 py-3 bg-surface border-t border-border space-y-2">
          {DeleteButton}
          {MobileSubmitButton}
          {deleteError && (
            <p className="text-xs text-danger-text bg-danger-bg border border-danger-border rounded-[10px] px-3 py-2">{deleteError}</p>
          )}
        </div>
      </div>
    </div>
  )
}
