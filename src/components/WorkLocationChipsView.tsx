'use client'

/**
 * 근무장소 chips — 보기 전용.
 *
 * `WorkLocationChipsInput`의 미리보기 사촌. 칩만 렌더 + 화살표 + ★ 마커.
 * 컨트롤 (← → ✕ ☆) 일체 없음. 우상단에 옵셔널 "수정" 버튼.
 *
 * 사용:
 *   <WorkLocationChipsView value={chips} currentIndex={idx} />
 *   <WorkLocationChipsView value={chips} currentLabel={label} onEdit={() => setEditing(true)} />
 */

import { ArrowRight, MapPin, Star, Pencil } from 'lucide-react'
import type { WorkLocations } from '@/types/work-locations-v2'
import { chipLabel } from '@/lib/work-locations-v2'

interface WorkLocationChipsViewProps {
  value: WorkLocations
  /** index 우선 매칭. 같은 라벨 칩이 여러 개일 때 정확한 식별. */
  currentIndex?: number | null
  /** index 없을 때 fallback 매칭. 같은 라벨 첫 번째만 ★. */
  currentLabel?: string | null
  /** "수정" 버튼 노출 시 클릭 콜백. */
  onEdit?: () => void
  /** 빈 상태 안내 문구. */
  emptyText?: string
}

export default function WorkLocationChipsView({
  value, currentIndex, currentLabel, onEdit, emptyText,
}: WorkLocationChipsViewProps) {
  const isEmpty = !value || value.length === 0

  return (
    <div className="space-y-1.5">
      {/* 우상단 수정 버튼 (있을 때만) */}
      {onEdit && (
        <div className="flex items-center justify-end">
          <button
            type="button"
            onClick={onEdit}
            className="inline-flex items-center gap-1 h-6 px-1.5 rounded-md text-[11px] text-primary-600 hover:bg-primary-50 transition-colors"
            aria-label="근무장소 수정"
          >
            <Pencil className="h-3 w-3" aria-hidden />
            수정
          </button>
        </div>
      )}

      {/* 칩 목록 */}
      {!isEmpty ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {value.map((chip, i) => {
            const label = chipLabel(chip)
            const labelMatchFirst =
              !!currentLabel &&
              currentLabel.trim() === label.trim() &&
              value.findIndex(c => chipLabel(c).trim() === currentLabel.trim()) === i
            const isCurrent =
              typeof currentIndex === 'number'
                ? currentIndex === i
                : labelMatchFirst
            return (
              <div key={i} className="inline-flex items-center gap-1">
                <div
                  className={`inline-flex items-center gap-1 rounded-full border-2 px-2.5 py-1 text-[13px] ${
                    isCurrent
                      ? 'border-warning-text bg-warning-bg text-warning-text'
                      : 'border-primary-200 bg-primary-50 text-primary-700'
                  }`}
                >
                  <span className={`text-[10px] tabular-nums font-semibold ${isCurrent ? 'text-warning-text' : 'text-primary-600'}`}>
                    {i + 1}
                  </span>
                  <MapPin className={`h-3 w-3 shrink-0 ${isCurrent ? 'text-warning-text' : 'text-primary-600'}`} aria-hidden />
                  <span className="font-semibold px-0.5">{label}</span>
                  {isCurrent && (
                    <Star className="h-3 w-3 fill-current shrink-0" aria-hidden />
                  )}
                </div>

                {/* 칩 사이 → 화살표 */}
                {i < value.length - 1 && (
                  <ArrowRight className="h-4 w-4 text-text-muted shrink-0" aria-hidden />
                )}
              </div>
            )
          })}
        </div>
      ) : (
        emptyText && (
          <p className="text-[12px] text-text-muted">{emptyText}</p>
        )
      )}
    </div>
  )
}
