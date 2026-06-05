'use client'
import { useState, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { X, Loader2 } from 'lucide-react'
import { useRegisterModalOpen } from '@/contexts/ModalOpenContext'
import HalfHourTimeSelect from '@/components/HalfHourTimeSelect'
import {
  LUNCH_OVERLAP_CHOICE,
  calculateLunchOverlapMinutes,
  type LunchOverlapChoice,
} from '@/lib/utils/lunch-overlap'

/**
 * 휴게 종료 확인 모달 (v1.79).
 *
 * v1.65의 BreakEndLunchOverlapModal을 대체.
 * 휴게 종료 시 항상 띄워서:
 *   - 시작/종료 시각을 30분 단위로 조정 가능 (사용자가 늦게 누르거나 일찍 끝낸 경우 보정)
 *   - 조정한 시각 기준으로 점심 겹침(12:00~13:00) 분 동적 재계산
 *   - 겹침 > 0이면 점심/별도 선택지 추가 노출
 *
 * Prefill 정책:
 *   - 시작 시각: 실제 break_started_at 에서 30분 floor (예: 09:35 → 09:30)
 *   - 종료 시각: NOW 에서 30분 floor (예: 09:35 → 09:30)
 *
 * 사용자가 확인 누르면 부모가 /api/team-status/break-end POST 시 startedAt/endedAt ISO + choice 전송.
 */

interface BreakEndConfirmModalProps {
  /** KST 'YYYY-MM-DD' (휴게 일자) */
  date: string
  /** 휴게 시작 ISO — DB 값 */
  startedAtIso: string
  onCancel: () => void
  /** 확인 시 호출. 부모가 POST 진행. */
  onConfirm: (args: {
    startedAtIso: string
    endedAtIso: string
    lunchOverlapChoice: LunchOverlapChoice | null
  }) => void | Promise<void>
}

/** ISO → KST 'HH:mm' 30분 floor */
function isoToKstHHmmFloor(iso: string): string {
  const d = new Date(iso)
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000)
  const h = kst.getUTCHours()
  const m = kst.getUTCMinutes()
  const floored = m < 30 ? 0 : 30
  return `${String(h).padStart(2, '0')}:${String(floored).padStart(2, '0')}`
}

/** KST 'YYYY-MM-DD' + 'HH:mm' → ISO (UTC). 시는 0~36 허용 (명일 24~36은 +1d). */
function kstHHmmToIso(date: string, hhmm: string): string {
  const [hStr, mStr] = hhmm.split(':')
  const h = parseInt(hStr, 10)
  const m = parseInt(mStr, 10)
  if (!Number.isFinite(h) || !Number.isFinite(m)) return new Date().toISOString()
  // 24+ 는 다음 날 처리
  const dayOffset = Math.floor(h / 24)
  const realHour = h % 24
  const [y, mo, d] = date.split('-').map(Number)
  // KST 기준 시각을 만들고 UTC ISO로
  const kstDate = new Date(Date.UTC(y, mo - 1, d + dayOffset, realHour, m, 0))
  // KST = UTC + 9h 이므로 UTC 시간은 kstDate - 9h
  const utcMs = kstDate.getTime() - 9 * 60 * 60 * 1000
  return new Date(utcMs).toISOString()
}

/** 분 → 'Nh Mm' 또는 'Nm' */
function fmtMinutes(min: number): string {
  if (min < 60) return `${min}분`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m === 0 ? `${h}시간` : `${h}시간 ${m}분`
}

export default function BreakEndConfirmModal({
  date,
  startedAtIso,
  onCancel,
  onConfirm,
}: BreakEndConfirmModalProps) {
  useRegisterModalOpen(true)

  // Prefill: 시작=실제 시작 30분 floor, 종료=NOW 30분 floor
  const initialStartHHmm = useMemo(() => isoToKstHHmmFloor(startedAtIso), [startedAtIso])
  const initialEndHHmm = useMemo(() => isoToKstHHmmFloor(new Date().toISOString()), [])
  const [startHHmm, setStartHHmm] = useState(initialStartHHmm)
  const [endHHmm, setEndHHmm] = useState(initialEndHHmm)
  const [choice, setChoice] = useState<LunchOverlapChoice>(LUNCH_OVERLAP_CHOICE.LUNCH)
  const [submitting, setSubmitting] = useState(false)

  // SSR-safe portal
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])

  // 조정된 시각 기준 분 계산 (재계산)
  const { totalMin, overlapMin, isValid } = useMemo(() => {
    const sIso = kstHHmmToIso(date, startHHmm)
    const eIso = kstHHmmToIso(date, endHHmm)
    const sMs = new Date(sIso).getTime()
    const eMs = new Date(eIso).getTime()
    const total = Math.max(0, Math.round((eMs - sMs) / 60_000))
    const overlap = sMs < eMs ? calculateLunchOverlapMinutes(sIso, eIso) : 0
    return {
      totalMin: total,
      overlapMin: overlap,
      isValid: sMs < eMs,
    }
  }, [date, startHHmm, endHHmm])

  const handleConfirm = async () => {
    if (submitting || !isValid) return
    setSubmitting(true)
    try {
      const startedAtIsoNew = kstHHmmToIso(date, startHHmm)
      const endedAtIsoNew = kstHHmmToIso(date, endHHmm)
      const finalChoice = overlapMin > 0 ? choice : null
      await onConfirm({
        startedAtIso: startedAtIsoNew,
        endedAtIso: endedAtIsoNew,
        lunchOverlapChoice: finalChoice,
      })
    } finally {
      setSubmitting(false)
    }
  }

  if (!mounted) return null

  const modalContent = (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-md rounded-2xl bg-surface border border-border shadow-xl">
        {/* 헤더 */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-base font-semibold text-text-primary">☕ 휴게 종료 — 시각 확인</h2>
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            className="text-text-muted hover:text-text-primary disabled:opacity-50"
            aria-label="닫기"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* 본문 */}
        <div className="px-5 py-4 space-y-4">
          {/* 시각 input */}
          <div className="space-y-2">
            <p className="text-[12px] text-text-secondary">실제 휴게 시각 (30분 단위)</p>
            <div className="flex items-center gap-2">
              <HalfHourTimeSelect
                value={startHHmm}
                onChange={setStartHHmm}
                ariaLabel="실 시작 시각"
                className="flex-1"
              />
              <span className="text-text-secondary text-sm">~</span>
              <HalfHourTimeSelect
                value={endHHmm}
                onChange={setEndHHmm}
                allowNextDay
                ariaLabel="실 종료 시각"
                className="flex-1"
              />
            </div>
            {!isValid && (
              <p className="text-[12px] text-danger-text">종료 시각이 시작 시각보다 늦어야 합니다.</p>
            )}
          </div>

          {/* 계산 결과 */}
          <div className="rounded-[10px] bg-surface-muted border border-border px-3 py-3 text-sm space-y-1.5">
            <div className="flex justify-between">
              <span className="text-text-secondary">총 휴게</span>
              <span className="font-medium text-text-primary tabular-nums">
                {fmtMinutes(totalMin)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-text-secondary">점심시간(12:00~13:00) 겹침</span>
              <span className={`font-semibold tabular-nums ${overlapMin > 0 ? 'text-warning-text' : 'text-text-muted'}`}>
                {overlapMin > 0 ? fmtMinutes(overlapMin) : '없음'}
              </span>
            </div>
          </div>

          {/* overlap > 0 시 점심/별도 선택 */}
          {overlapMin > 0 && (
            <>
              <p className="text-[13px] text-text-secondary leading-relaxed">
                EW는 12~13시를 자동으로 점심으로 처리합니다. 이 휴게의 점심 겹친 부분({fmtMinutes(overlapMin)})을
                어떻게 처리할까요?
              </p>
              <div className="space-y-2.5">
                <label className="flex gap-3 cursor-pointer rounded-[10px] border border-border px-3 py-3 hover:bg-surface-muted has-[:checked]:border-primary-500 has-[:checked]:bg-primary-50">
                  <input
                    type="radio"
                    name="lunch-overlap-choice"
                    value={LUNCH_OVERLAP_CHOICE.LUNCH}
                    checked={choice === LUNCH_OVERLAP_CHOICE.LUNCH}
                    onChange={() => setChoice(LUNCH_OVERLAP_CHOICE.LUNCH)}
                    className="mt-0.5 h-4 w-4 text-primary-600 focus:ring-primary-500"
                  />
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-text-primary">점심으로 처리</p>
                    <p className="mt-0.5 text-xs text-text-secondary">
                      점심 겹친 {fmtMinutes(overlapMin)}은 휴게에서 제외 → EW 이중 차감 방지
                    </p>
                  </div>
                </label>
                <label className="flex gap-3 cursor-pointer rounded-[10px] border border-border px-3 py-3 hover:bg-surface-muted has-[:checked]:border-primary-500 has-[:checked]:bg-primary-50">
                  <input
                    type="radio"
                    name="lunch-overlap-choice"
                    value={LUNCH_OVERLAP_CHOICE.EXTRA}
                    checked={choice === LUNCH_OVERLAP_CHOICE.EXTRA}
                    onChange={() => setChoice(LUNCH_OVERLAP_CHOICE.EXTRA)}
                    className="mt-0.5 h-4 w-4 text-primary-600 focus:ring-primary-500"
                  />
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-text-primary">별도 휴게로 누적</p>
                    <p className="mt-0.5 text-xs text-text-secondary">
                      점심은 따로 가졌고 이 시간은 추가 휴식 → 전체 {fmtMinutes(totalMin)} 그대로 휴게에 누적
                    </p>
                  </div>
                </label>
              </div>
            </>
          )}
        </div>

        {/* 푸터 */}
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-border">
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            className="rounded-md border border-border bg-surface px-4 py-2 text-sm font-medium text-text-primary hover:bg-surface-muted disabled:opacity-50"
          >
            취소
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={submitting || !isValid}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"
          >
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            확인
          </button>
        </div>
      </div>
    </div>
  )

  return createPortal(modalContent, document.body)
}
