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

import { useEffect, useState } from 'react'
import { X, Plane } from 'lucide-react'
import { Button, Field, Input, DateInputWithDow } from '@/components/ui'
import CustomDropdown from '@/components/ui/CustomDropdown'
import { LEAVE_TIME_OPTIONS } from '@/lib/leave-timeline'
import { cn } from '@/lib/utils/cn'
import { useRegisterModalOpen } from '@/contexts/ModalOpenContext'

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

// 30분 단위 휴가 시간 옵션 ('휴가 없음'(0) 제외 — 등록 모달은 최소 30분)
const VACATION_TIME_OPTIONS = LEAVE_TIME_OPTIONS
  .filter(o => o.minutes > 0)
  .map(o => ({ value: String(o.minutes), label: o.minutes === 480 ? `${o.label} (종일)` : o.label }))

export default function VacationRegisterModal({
  initialStartDate,
  initialEndDate,
  onClose,
  onSuccess,
}: VacationRegisterModalProps) {
  // Stage 4: 글로벌 모달 카운터 등록
  useRegisterModalOpen()
  const today = new Date().toISOString().slice(0, 10)
  const [startDate, setStartDate] = useState(initialStartDate ?? today)
  const [endDate, setEndDate]     = useState(initialEndDate ?? initialStartDate ?? today)
  // 휴가 시간(분) — default 480(종일). 30분 단위.
  const [leaveMinutes, setLeaveMinutes] = useState<number>(480)
  const [excludeWeekends, setExcludeWeekends] = useState(true)
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<BulkLeaveResult | null>(null)
  // pre-submit 안내: 시작일~종료일 범위에 이미 보고가 있는 본인 일자들.
  // bulk-leave는 이런 날을 안전장치로 skip하므로 submit 전 미리 표시해서
  // "등록 시 실제로 만들어질 건 수 / 건너뛸 건 수"를 사용자가 인지할 수 있게 한다.
  const [existingDates, setExistingDates] = useState<string[]>([])
  const [previewLoading, setPreviewLoading] = useState(false)

  // pre-submit 조회 — 날짜 범위 안에 이미 본인 보고가 있는 날 미리 확인.
  // bulk-leave는 그런 날 skip이라 사용자에게 등록 시 실제 동작을 미리 알려준다.
  // 결과 화면 표시 중이면 skip(이미 등록 처리됨).
  useEffect(() => {
    if (result) return
    if (!startDate || !endDate || startDate > endDate) {
      setExistingDates([])
      return
    }
    const ac = new AbortController()
    setPreviewLoading(true)
    fetch(
      `/api/work-logs?mine=true&from=${startDate}&to=${endDate}&limit=500`,
      { signal: ac.signal, cache: 'no-store' },
    )
      .then(r => r.ok ? r.json() : [])
      .then((logs: Array<{ leave_date: string; is_deleted: boolean }>) => {
        if (ac.signal.aborted) return
        const dates = (Array.isArray(logs) ? logs : [])
          .filter(l => !l.is_deleted)
          .map(l => l.leave_date)
        // 중복 제거 + 정렬
        const unique = Array.from(new Set(dates)).sort()
        // 주말 제외 옵션 적용 — 사용자가 어차피 등록 안 할 날은 안내에서도 제외
        const filtered = excludeWeekends
          ? unique.filter(d => {
              const dow = new Date(`${d}T00:00:00`).getUTCDay()
              return dow !== 0 && dow !== 6
            })
          : unique
        setExistingDates(filtered)
      })
      .catch(() => { /* 무시 — best-effort */ })
      .finally(() => { if (!ac.signal.aborted) setPreviewLoading(false) })
    return () => ac.abort()
  }, [startDate, endDate, excludeWeekends, result])

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
          leaveMinutes,
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
            {result.created === 0 && result.skipped > 0 ? (
              // 모두 skip된 케이스 — 사용자가 "등록 안 됨"으로 오해하기 쉬워 명확히 경고 + 대안 안내
              <div className="rounded-[10px] bg-danger-bg border border-danger-border p-3 text-sm text-danger-text">
                <strong className="font-semibold">휴가가 등록되지 않았습니다</strong>
                <span className="block mt-1 text-[12px] text-text-primary">
                  대상 일자({result.skipped}건)에 이미 출근/퇴근보고가 있어 건너뛰었습니다.
                </span>
                <span className="block mt-2 text-[12px] text-text-secondary">
                  💡 이미 보고된 날에 휴가를 추가하려면 캘린더 셀을 클릭한 후
                  <strong className="text-text-primary"> 출근보고 수정(✏) 모달의 "휴가" 영역</strong>에서
                  반차·부분휴가를 추가하세요.
                </span>
              </div>
            ) : (
              <div className="rounded-[10px] bg-success-bg border border-success-border p-3 text-sm text-success-text">
                <strong className="font-semibold">{result.created}건</strong> 등록 완료
                {result.skipped > 0 && (
                  <span className="block mt-1 text-[12px] text-text-secondary">
                    {result.skipped}건은 이미 보고가 있어 건너뛰었습니다. 출근보고 수정에서 휴가 추가 가능.
                  </span>
                )}
              </div>
            )}
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
                <DateInputWithDow
                  value={startDate}
                  onChange={(newStart) => {
                    // v1.61.10 — 시작일 변경 시 종료일 자동 따라가기.
                    // 종료일이 기존 시작일과 같았으면(단일 날짜 의도) 새 시작일로 동기화.
                    // 종료일이 기존 시작일 ~ 새 시작일 사이 또는 새 시작일보다 작으면 동기화 (역전 방지).
                    // 사용자가 명시 늘려둔 기간(종료 > 새 시작)이면 그대로 유지.
                    setStartDate(newStart)
                    if (newStart && (endDate === startDate || endDate < newStart)) {
                      setEndDate(newStart)
                    }
                  }}
                  className="w-full"
                />
              </Field>
              <Field label="종료일" required>
                <DateInputWithDow value={endDate} onChange={setEndDate} className="w-full" />
              </Field>
            </div>

            <Field label="휴가 시간" required hint="30분 단위로 선택. 8:00은 종일 휴가입니다.">
              <CustomDropdown
                value={String(leaveMinutes)}
                onChange={v => setLeaveMinutes(parseInt(v, 10))}
                options={VACATION_TIME_OPTIONS}
                ariaLabel="휴가 시간"
                className="w-full"
              />
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
              종일(8H) 외 부분 휴가는 기본 시작/종료 시각(예: 오전반차 09:00~14:00)으로 등록됩니다. 시각을 다르게 입력하려면 캘린더 셀의 출퇴근보고에서 직접 조정해주세요.
            </div>

            {/* pre-submit 안내 — 선택한 범위 내 이미 보고된 날 미리 표시 */}
            {existingDates.length > 0 && (
              <div className="rounded-[10px] bg-warning-bg border border-warning-border p-3 text-[12px] text-warning-text">
                <div className="flex items-start gap-2">
                  <span className="font-semibold">⚠️ 건너뛸 날짜 {existingDates.length}건</span>
                  {previewLoading && <span className="text-[11px] text-text-muted">(확인 중…)</span>}
                </div>
                <div className="mt-1 text-text-primary tabular-nums break-all">
                  {existingDates.join(', ')}
                </div>
                <div className="mt-1 text-text-secondary">
                  이 날짜에는 이미 출근/퇴근 보고가 있어 등록 시 자동으로 제외됩니다. 휴가를 추가하시려면 캘린더 셀의 출근보고 수정(✏)에서 직접 추가해주세요.
                </div>
              </div>
            )}

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
