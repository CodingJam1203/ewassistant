'use client'

/**
 * 근무장소 chips — 보기 전용.
 *
 * 칩 + 화살표 + ★ 마커. 컨트롤(← → ✕ ☆) 일체 없음.
 * 라벨 칩(좌)이나 수정 버튼(우) 같은 외부 노드는 chipsLeading / chipsTrailing으로 끼움.
 *
 * 사용:
 *   <WorkLocationChipsView value={chips} currentIndex={idx}
 *      chipsLeading={<LabelPill text="실제" />}
 *      chipsTrailing={<EditButton onClick={...} />}
 *   />
 */

import type { ReactNode } from 'react'
import { ArrowRight, MapPin, Star } from 'lucide-react'
import type { WorkLocations } from '@/types/work-locations-v2'
import { chipLabel } from '@/lib/work-locations-v2'

interface WorkLocationChipsViewProps {
  value: WorkLocations
  /** index 우선 매칭. 같은 라벨 칩이 여러 개일 때 정확한 식별. */
  currentIndex?: number | null
  /** index 없을 때 fallback 매칭. 같은 라벨 첫 번째만 ★. */
  currentLabel?: string | null
  /** 칩 줄 시작에 끼우는 노드 (예: 라벨 pill) */
  chipsLeading?: ReactNode
  /** 칩 줄 끝에 끼우는 노드 (예: 수정 버튼) */
  chipsTrailing?: ReactNode
  /** 빈 상태 안내 문구 (leading/trailing 없을 때만 표시) */
  emptyText?: string
}

export default function WorkLocationChipsView({
  value, currentIndex, currentLabel,
  chipsLeading, chipsTrailing, emptyText,
}: WorkLocationChipsViewProps) {
  const showRow = !!chipsLeading || !!chipsTrailing || value.length > 0

  return (
    <div className="space-y-1">
      {showRow ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {chipsLeading}
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
                {i < value.length - 1 && (
                  <ArrowRight className="h-4 w-4 text-text-muted shrink-0" aria-hidden />
                )}
              </div>
            )
          })}
          {chipsTrailing}
        </div>
      ) : (
        emptyText && (
          <p className="text-[12px] text-text-muted">{emptyText}</p>
        )
      )}
    </div>
  )
}
