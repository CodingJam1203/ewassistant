'use client'

/**
 * VacationRegisterModal
 *
 * 시작일/종료일 + 휴가 유형을 선택해 여러 날짜에 휴가를 일괄 등록.
 * 캘린더뷰의 "휴가 등록" 버튼이 트리거.
 *
 * MVP 범위:
 *   - 종일/오전반차/오후반차 (기존 LeaveType 그대로)
 *   - 주말 제외 옵션 (기본 ON)
 *   - 메모(선택)
 *
 * 차후 확장 (자리 표시):
 *   - 시간휴가 (시작/종료 시각 입력)
 *   - 기타 사유
 *   - 드래그로 캘린더 여러 칸 선택 → 폼 prefill
 */

import { useState } from 'react'
import { X, Loader2, Plane } from 'lucide-react'
import { Button, Field, Input, Select } from '@/components/ui'
import { cn } from '@/lib/utils/cn'

export interface VacationRegisterModalProps {
  /** 캘린더에서 선택해 prefill 할 시작일 (YYYY-MM-DD). 미지정 시 today */
  initialStartDate?: string
  initialEndDate?: string
  onClose: () => void
  /** 등록 성공 시 호출 — 부모가 캘린더 다시 fetch */
  onSuccess: (result: BulkLeaveResult) => void
}

interface BulkLeaveResult {
  created: number
  skipped: number
  createdDates: string[]
  skippedDates: string[]
}

const LEAVE_TYPE_OPTIONS = [
  { value: 'full_day',       label: '종일 휴가 (8h)' },
  { value: 'morning_half',   label: '오전반차 (4h)' },
  { value: 'afternoon_half', label: '오후반차 (4h)' },
] as const

export default function VacationRegisterModal({
  initialStartDate,
  initialEndDate,
  onClose,
  onSuccess,
}: VacationRegisterModalProps) {
  const today = new Date().toISOString().slice(0, 10)
  const [startDate, setStartDate] = useState(initialStartDate ?? today)
  const [endDate, setEndDate]     = useState(initialEndDate ?? initialStartDate ?? today)
  const [leaveType, setLeaveType] =
    useState<'full_day' | 'morning_half' | 'afternoon_half'>('full_day')
  const [excludeWeekends, setExcludeWeekends] = useState(true)
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<BulkLeaveResult | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (startDate > endDate) {
      setError('시작일이 종료일보다 늦습니다.')
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch('/api/work-logs/bulk-leave', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          startDate,
          endDate,
          leaveType,
          excludeWeekends,
          note: note.trim() || undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data?.error ?? '등록에 실패했습니다.')
        return
      }
      setResult(data as BulkLeaveResult)
      onSuccess(data as BulkLeaveResult)
    } catch (err: unknown) {
      const m = err instanceof Error ? err.message : String(err)
      setError(`네트워크 오류: ${m}`)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 overflow-y-auto py-6 px-4">
      <div className="bg-surface rounded-[20px] shadow-[var(--shadow-popover)] w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <Plane className="h-4 w-4 text-warning-text" aria-hidden />
            <div>
              <h3 className="text-base font-semibold text-text-primary">휴가 일괄 등록</h3>
              <p className="text-[12px] text-text-secondary mt-0.5">
                여러 날짜에 같은 유형으로 한 번에 등록합니다.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="inline-flex items-center justify-center h-9 w-9 rounded-[10px] text-text-muted hover:text-text-primary hover:bg-surface-muted transition-colors"
            aria-label="닫기"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>

        {/* 결과 화면 */}
        {result ? (
          <div className="px-6 py-5 space-y-4">
            <div className="rounded-[10px] bg-success-bg border border-success-border p-3 text-sm text-success-text">
              <strong className="font-semibold">{result.created}건</strong> 등록 완료
              {result.skipped > 0 && (
                <span className="block mt-1 text-[12px] text-text-secondary">
                  {result.skipped}건은 이미 보고가 있어 건너뛰었습니다.
                </span>
              )}
            </div>
            {result.skippedDates.length > 0 && (
              <details className="text-[12px] text-text-secondary">
                <summary className="cursor-pointer font-medium">건너뛴 날짜 보기</summary>
                <ul className="mt-1 ml-4 list-disc tabular-nums">
                  {result.skippedDates.map(d => <li key={d}>{d}</li>)}
                </ul>
              </details>
            )}
            <div className="flex justify-end pt-2">
              <Button variant="primary" onClick={onClose}>닫기</Button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label="시작일" required>
                <Input
                  type="date"
                  value={startDate}
                  onChange={e => setStartDate(e.target.value)}
                  required
                />
              </Field>
              <Field label="종료일" required>
                <Input
                  type="date"
                  value={endDate}
                  onChange={e => setEndDate(e.target.value)}
                  required
                />
              </Field>
            </div>

            <Field label="휴가 유형" required>
              <Select
                value={leaveType}
                onChange={e => setLeaveType(e.target.value as typeof leaveType)}
              >
                {LEAVE_TYPE_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </Select>
            </Field>

            <Field label="옵션">
              <label className="inline-flex items-center gap-2 h-10 px-3 rounded-[10px] border border-border-strong bg-surface cursor-pointer">
                <input
                  type="checkbox"
                  checked={excludeWeekends}
                  onChange={e => setExcludeWeekends(e.target.checked)}
                  className="h-4 w-4 rounded border-border-strong text-primary-600 focus:ring-primary-500"
                />
                <span className="text-sm text-text-primary">주말(토·일) 제외</span>
              </label>
            </Field>

            <Field label="메모" hint="선택 입력. 등록될 모든 row에 동일하게 들어갑니다.">
              <Input
                type="text"
                placeholder="예: 가족 여행"
                value={note}
                onChange={e => setNote(e.target.value)}
                maxLength={200}
              />
            </Field>

            <div
              className={cn(
                'rounded-[10px] border px-3 py-2 text-[12px]',
                'bg-info-bg border-info-border text-text-primary',
              )}
            >
              💡 이미 보고가 있는 날짜는 건너뜁니다 — 캘린더에서 확인 후 직접 수정해주세요.
              <br />
              반차의 경우 출퇴근 시각은 09:00~18:00로 임시 채워지며, 후속 출퇴근보고에서 조정할 수 있습니다.
            </div>

            {error && (
              <div className="rounded-[10px] bg-danger-bg border border-danger-border p-3 text-sm text-danger-text">
                {error}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <Button variant="secondary" type="button" onClick={onClose} disabled={submitting}>
                취소
              </Button>
              <Button variant="primary" type="submit" loading={submitting} disabled={submitting}>
                {submitting ? '등록 중...' : '휴가 등록'}
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
