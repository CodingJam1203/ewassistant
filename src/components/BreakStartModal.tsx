'use client'
import { useState } from 'react'
import { X, Loader2 } from 'lucide-react'
import HalfHourTimeSelect from '@/components/HalfHourTimeSelect'
import EditableLocationChips from '@/components/EditableLocationChips'
import type { WorkLocations } from '@/types/work-locations-v2'
import { useRegisterModalOpen } from '@/contexts/ModalOpenContext'

/**
 * 휴게 시작 모달 (v1.44, 2026-05-24).
 *
 * 신규 휴게 정책 — 휴게 시작 버튼 클릭 시 이 모달이 뜬다:
 *  - 휴게 시작시각: 현재 KST 시각을 30분 단위 floor (예 13:07 → 13:00). 사용자가 30분 단위 수정 가능.
 *  - 휴게 종료 예정시각: 시작 +30분 default. **단순 UI 안내용** (DB 저장 X, 자동 종료 X).
 *  - 근무장소: EditableLocationChips 그대로 — ★ 편집은 즉시 daily_work_status에 반영(기존 동작).
 *  - 메모: 기존 메모 정책과 동일하게 work_logs.work_content 공유(덮어쓰기).
 *
 * 저장 시 POST /api/team-status/break-start { date, startTime, memo? }
 *  → 라우트가 startTime(HH:mm)을 KST ISO로 변환해 daily_work_status.break_started_at에 박음.
 *  → 종료 클릭 시 (now - break_started_at) ceil 30분 → break_auto_rounded_minutes 누적 → 퇴근보고 prefill.
 *
 * 기존 즉시 휴게 시작 흐름(home.triggerBreak('break-start'))은 home의 USE_BREAK_MODAL_FLOW 토글로 보존.
 */

interface BreakStartModalProps {
  date: string
  userName: string | null
  /** 모달 진입 시점의 actual 근무장소 chips */
  currentLocations: WorkLocations
  /** 현재 위치 라벨 (★ 매칭용) */
  currentLocationLabel: string | null
  /** 현재 위치 chip index (★ 매칭 우선) */
  currentLocationIndex: number | null
  /** 보기 모드 안내용 — 예정 위치 화살표 */
  plannedHint?: string | null
  /** 기존 메모(work_content) prefill */
  currentMemo?: string | null
  onClose: () => void
  /** 휴게 시작 성공 시 — 부모가 myCard 재fetch */
  onSuccess: () => void
  /** EditableLocationChips가 즉시 저장 후 부모에게 refetch 요청 */
  onLocationChange?: () => void
}

/** 현재 KST HH:mm을 30분 단위 floor (09:37 → 09:30). */
function nowKstHHmmFloor(): string {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul', hour12: false, hour: '2-digit', minute: '2-digit',
  })
  const parts = fmt.formatToParts(new Date())
  const h = parseInt(parts.find(p => p.type === 'hour')?.value ?? '0', 10) % 24
  const m = parseInt(parts.find(p => p.type === 'minute')?.value ?? '0', 10)
  return `${String(h).padStart(2, '0')}:${m < 30 ? '00' : '30'}`
}

/** HH:mm + 30분 (24h wrap). 13:00 → 13:30, 23:30 → 00:00. */
function addHalfHour(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number)
  const total = ((h || 0) * 60 + (m || 0) + 30)
  const hh = Math.floor(total / 60) % 24
  const mm = total % 60
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}

export default function BreakStartModal({
  date, userName,
  currentLocations, currentLocationLabel, currentLocationIndex,
  plannedHint, currentMemo,
  onClose, onSuccess, onLocationChange,
}: BreakStartModalProps) {
  useRegisterModalOpen()
  const [startTime, setStartTime] = useState<string>(() => nowKstHHmmFloor())
  const [endPlanned, setEndPlanned] = useState<string>(() => addHalfHour(nowKstHHmmFloor()))
  const [memo, setMemo] = useState<string>(currentMemo ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 시작시간 바뀌면 종료예정도 자동 +30 따라감 (사용자가 종료예정을 직접 수정한 후엔 따라가지 않게
  // 별도 ref 추적할 수도 있으나 v1.44 초도엔 단순 follow로 시작)
  const handleStartChange = (next: string) => {
    setStartTime(next)
    setEndPlanned(addHalfHour(next))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSaving(true)
    try {
      const res = await fetch('/api/team-status/break-start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date,
          startTime,
          memo: memo.trim() || null,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data?.error ?? '휴게 시작에 실패했습니다.')
        return
      }
      onSuccess()
    } catch {
      setError('네트워크 오류가 발생했습니다.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 overflow-y-auto py-6 px-4">
      <div className="bg-surface rounded-[20px] shadow-[var(--shadow-popover)] w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div>
            <h3 className="text-base font-semibold text-text-primary">휴게 시작</h3>
            <p className="text-[12px] text-text-secondary mt-0.5">
              {userName ? `${userName}님 — ` : ''}{date} · 시작시간·종료예정·근무장소·메모를 확인하고 저장하세요
            </p>
          </div>
          <button
            onClick={onClose}
            className="inline-flex items-center justify-center h-9 w-9 rounded-[10px] text-text-muted hover:text-text-primary hover:bg-surface-muted transition-colors"
            aria-label="닫기"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[12px] font-semibold text-text-secondary mb-1.5">휴게 시작시간 *</label>
              <HalfHourTimeSelect
                value={startTime}
                onChange={handleStartChange}
                ariaLabel="휴게 시작시간"
              />
            </div>
            <div>
              <label className="block text-[12px] font-semibold text-text-secondary mb-1.5">
                휴게 종료 예정시간
                <span className="ml-1 text-[11px] font-normal text-text-muted">(안내용)</span>
              </label>
              <HalfHourTimeSelect
                value={endPlanned}
                onChange={setEndPlanned}
                allowNextDay
                ariaLabel="휴게 종료 예정시간"
              />
            </div>
          </div>

          <div>
            <label className="block text-[12px] font-semibold text-text-secondary mb-1.5">근무장소</label>
            <p className="text-[11px] text-text-muted mb-2">★ 표시는 현재 위치. 편집은 즉시 반영됩니다.</p>
            <EditableLocationChips
              value={currentLocations}
              currentLabel={currentLocationLabel}
              currentIndex={currentLocationIndex}
              plannedHint={plannedHint ?? null}
              date={date}
              onChange={() => { onLocationChange?.() }}
              alwaysEditing
              hideDoneButton
            />
          </div>

          <div>
            <label className="block text-[12px] font-semibold text-text-secondary mb-1.5">메모</label>
            <textarea
              value={memo}
              onChange={e => setMemo(e.target.value)}
              rows={2}
              placeholder="비고"
              className="w-full rounded-[10px] border border-border-strong bg-surface text-sm px-3 py-2 focus:outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 resize-none"
            />
          </div>

          {error && (
            <p className="text-sm text-danger-text bg-danger-bg border border-danger-border rounded-[10px] px-3 py-2">{error}</p>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center justify-center h-10 px-4 rounded-[10px] text-sm font-medium text-text-primary bg-surface border border-border-strong hover:bg-surface-muted transition-colors"
            >
              취소
            </button>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-1.5 h-10 px-4 rounded-[10px] text-sm font-semibold text-white bg-primary-600 hover:bg-primary-700 disabled:opacity-50 transition-colors"
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              휴게 시작
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

