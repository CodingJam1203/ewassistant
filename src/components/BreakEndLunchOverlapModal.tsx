'use client'
import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { X, Loader2 } from 'lucide-react'
import { useRegisterModalOpen } from '@/contexts/ModalOpenContext'
import { LUNCH_OVERLAP_CHOICE, type LunchOverlapChoice } from '@/lib/utils/lunch-overlap'

/**
 * 휴게 종료 시 점심시간 겹침 확인 모달 (v1.65).
 *
 * 휴게 종료 시점에 12:00~13:00 KST와 겹치는 분이 ≥1이면 노출.
 * 사용자가 선택:
 *   - 점심으로 처리(default): 겹친 분은 break_auto 누적에서 제외 → EW 이중 차감 방지
 *   - 별도 휴게로 누적: 그대로 누적 (점심을 따로 가짐을 명시)
 */

interface BreakEndLunchOverlapModalProps {
  /** 휴게 시작 ISO */
  startedAtIso: string
  /** 휴게 종료 ISO (보통 'now') */
  endedAtIso: string
  /** 휴게 총 분 */
  totalMinutes: number
  /** 12~13시 겹친 분 */
  overlapMinutes: number
  onCancel: () => void
  /** 선택 확정 후 호출. 부모가 POST 진행. */
  onConfirm: (choice: LunchOverlapChoice) => void | Promise<void>
}

/** ISO → KST 'HH:mm' */
function isoToKstHHmm(iso: string): string {
  const d = new Date(iso)
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000)
  const h = String(kst.getUTCHours()).padStart(2, '0')
  const m = String(kst.getUTCMinutes()).padStart(2, '0')
  return `${h}:${m}`
}

/** 분 → 'Nh Mm' 또는 'Nm' 표기 */
function fmtMinutes(min: number): string {
  if (min < 60) return `${min}분`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m === 0 ? `${h}시간` : `${h}시간 ${m}분`
}

export default function BreakEndLunchOverlapModal({
  startedAtIso,
  endedAtIso,
  totalMinutes,
  overlapMinutes,
  onCancel,
  onConfirm,
}: BreakEndLunchOverlapModalProps) {
  useRegisterModalOpen(true)
  const [choice, setChoice] = useState<LunchOverlapChoice>(LUNCH_OVERLAP_CHOICE.LUNCH)
  const [submitting, setSubmitting] = useState(false)
  // SSR-safe portal: 클라이언트 mount 후에만 createPortal 실행.
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])

  const handleConfirm = async () => {
    if (submitting) return
    setSubmitting(true)
    try {
      await onConfirm(choice)
    } finally {
      setSubmitting(false)
    }
  }

  const startKst = isoToKstHHmm(startedAtIso)
  const endKst = isoToKstHHmm(endedAtIso)

  if (!mounted) return null

  const modalContent = (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-md rounded-2xl bg-surface border border-border shadow-xl">
        {/* 헤더 */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-base font-semibold text-text-primary">☕ 휴게 종료 — 점심시간 확인</h2>
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
          {/* 휴게 정보 */}
          <div className="rounded-[10px] bg-surface-muted border border-border px-3 py-3 text-sm space-y-1.5">
            <div className="flex justify-between">
              <span className="text-text-secondary">휴게 시간</span>
              <span className="font-medium text-text-primary tabular-nums">
                {startKst} ~ {endKst} ({fmtMinutes(totalMinutes)})
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-text-secondary">점심시간(12:00~13:00) 겹침</span>
              <span className="font-semibold text-warning-text tabular-nums">
                {fmtMinutes(overlapMinutes)}
              </span>
            </div>
          </div>

          {/* 안내 */}
          <p className="text-[13px] text-text-secondary leading-relaxed">
            EW는 12~13시를 자동으로 점심으로 처리합니다. 이 휴게의 점심 겹친 부분({fmtMinutes(overlapMinutes)})을
            어떻게 처리할까요?
          </p>

          {/* 라디오 */}
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
                  점심 겹친 {fmtMinutes(overlapMinutes)}은 휴게에서 제외 → EW 이중 차감 방지
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
                  점심은 따로 가졌고 이 시간은 추가 휴식 → 전체 {fmtMinutes(totalMinutes)} 그대로 휴게에 누적
                </p>
              </div>
            </label>
          </div>
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
            disabled={submitting}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"
          >
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            확인
          </button>
        </div>
      </div>
    </div>
  )

  // Portal로 document.body에 렌더 — 부모가 <tr>/<td> 같은 제한적 컨테이너여도 안전.
  return createPortal(modalContent, document.body)
}
