'use client'

/**
 * 근무장소 칩 입력 컴포넌트 (v2).
 *
 * - 드롭다운: 사무실 / 외근 / 재택 / 기타
 * - 기타 선택 시 인라인 텍스트 input 노출 → "추가" 버튼으로 칩 누적
 * - 사용자가 선택한 순서대로 칩 누적 (중복 허용 — 사용자 요구)
 * - 각 칩: 라벨 + 좌/우 이동 + 삭제
 * - 시간 정보는 일절 다루지 않음 — 출퇴근 시간은 별도 input으로 분리
 *
 * 입력 검증은 부모에서 props.errors로 내려받아 인라인 표시.
 */

import { useState, useMemo } from 'react'
import { Plus, X, MapPin, ChevronLeft, ChevronRight } from 'lucide-react'
import {
  WORK_LOCATION_KIND_LABELS,
  type WorkLocationChip,
  type WorkLocationKind,
  type WorkLocations,
} from '@/types/work-locations-v2'
import { chipLabel, type LocationsValidationError } from '@/lib/work-locations-v2'

interface WorkLocationChipsInputProps {
  value: WorkLocations
  onChange: (next: WorkLocations) => void
  /** 부모 검증 결과 — 인덱스 없는 일반 에러 + index 있는 항목별 에러 */
  errors?: LocationsValidationError[]
  disabled?: boolean
  /** 라벨/안내 등 부가 helper UI 숨김 (간략 노출 모드) */
  compact?: boolean
}

const KIND_ORDER: WorkLocationKind[] = ['office', 'field', 'remote', 'custom']

export default function WorkLocationChipsInput({
  value,
  onChange,
  errors,
  disabled,
  compact,
}: WorkLocationChipsInputProps) {
  const [pendingKind, setPendingKind] = useState<WorkLocationKind>('office')
  const [pendingCustom, setPendingCustom] = useState('')

  /** 인덱스별 에러 매핑 */
  const errorByIndex = useMemo(() => {
    const map = new Map<number, string[]>()
    const general: string[] = []
    ;(errors ?? []).forEach(err => {
      if (typeof err.index === 'number') {
        const arr = map.get(err.index) ?? []
        arr.push(err.message)
        map.set(err.index, arr)
      } else {
        general.push(err.message)
      }
    })
    return { byIndex: map, general }
  }, [errors])

  const handleAdd = () => {
    if (disabled) return
    if (pendingKind === 'custom') {
      const trimmed = pendingCustom.trim()
      if (!trimmed) return
      onChange([...value, { kind: 'custom', customLabel: trimmed }])
      setPendingCustom('')
      return
    }
    onChange([...value, { kind: pendingKind }])
  }

  const handleRemove = (i: number) => {
    if (disabled) return
    onChange(value.filter((_, idx) => idx !== i))
  }

  const handleMove = (i: number, dir: -1 | 1) => {
    if (disabled) return
    const next = [...value]
    const j = i + dir
    if (j < 0 || j >= next.length) return
    ;[next[i], next[j]] = [next[j], next[i]]
    onChange(next)
  }

  return (
    <div className="space-y-2">
      {/* 추가 영역 — 드롭다운 + (기타 시) 텍스트 input + 추가 버튼 */}
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={pendingKind}
          onChange={e => setPendingKind(e.target.value as WorkLocationKind)}
          disabled={disabled}
          aria-label="근무장소 종류"
          className="select-tight rounded-[10px] border border-border-strong bg-surface h-9 px-3 text-sm focus:outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 disabled:opacity-50"
        >
          {KIND_ORDER.map(k => (
            <option key={k} value={k}>
              {WORK_LOCATION_KIND_LABELS[k]}
            </option>
          ))}
        </select>

        {pendingKind === 'custom' && (
          <input
            type="text"
            value={pendingCustom}
            onChange={e => setPendingCustom(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault()
                handleAdd()
              }
            }}
            placeholder="상세 장소 (예: 카페, 거래처)"
            disabled={disabled}
            className="flex-1 min-w-[160px] h-9 rounded-[10px] border border-border-strong bg-surface px-3 text-sm focus:outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 disabled:opacity-50"
          />
        )}

        <button
          type="button"
          onClick={handleAdd}
          disabled={disabled || (pendingKind === 'custom' && !pendingCustom.trim())}
          className="inline-flex items-center gap-1 h-9 px-3 rounded-[10px] text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 disabled:opacity-50 transition-colors"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden />
          추가
        </button>
      </div>

      {/* 칩 목록 */}
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((chip, i) => {
            const itemErrors = errorByIndex.byIndex.get(i) ?? []
            return (
              <div
                key={i}
                className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[12px] ${
                  itemErrors.length > 0
                    ? 'border-danger-border bg-danger-bg text-danger-text'
                    : 'border-border-strong bg-surface text-text-primary'
                }`}
              >
                <span className="text-[10px] tabular-nums text-text-muted">
                  {i + 1}.
                </span>
                <MapPin className="h-3 w-3 text-text-muted shrink-0" aria-hidden />
                <span className="font-medium px-0.5">{chipLabel(chip)}</span>

                {!disabled && i > 0 && (
                  <button
                    type="button"
                    onClick={() => handleMove(i, -1)}
                    aria-label={`${i + 1}번째 항목 앞으로 이동`}
                    className="inline-flex items-center justify-center h-5 w-5 rounded-full text-text-muted hover:text-text-primary hover:bg-surface-muted transition-colors"
                  >
                    <ChevronLeft className="h-3 w-3" aria-hidden />
                  </button>
                )}
                {!disabled && i < value.length - 1 && (
                  <button
                    type="button"
                    onClick={() => handleMove(i, 1)}
                    aria-label={`${i + 1}번째 항목 뒤로 이동`}
                    className="inline-flex items-center justify-center h-5 w-5 rounded-full text-text-muted hover:text-text-primary hover:bg-surface-muted transition-colors"
                  >
                    <ChevronRight className="h-3 w-3" aria-hidden />
                  </button>
                )}
                {!disabled && (
                  <button
                    type="button"
                    onClick={() => handleRemove(i)}
                    aria-label={`${i + 1}번째 항목 삭제`}
                    className="inline-flex items-center justify-center h-5 w-5 rounded-full text-text-muted hover:text-danger-text hover:bg-danger-bg transition-colors"
                  >
                    <X className="h-3 w-3" aria-hidden />
                  </button>
                )}

                {itemErrors.length > 0 && (
                  <span className="ml-1 text-[10px] text-danger-text">
                    {itemErrors[0]}
                  </span>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* 빈 상태 안내 */}
      {value.length === 0 && !compact && (
        <p className="text-[12px] text-text-muted">
          위에서 근무장소를 선택하고 <span className="font-medium">추가</span>를 눌러주세요.
        </p>
      )}

      {/* 일반 에러 */}
      {errorByIndex.general.length > 0 && (
        <div className="space-y-0.5">
          {errorByIndex.general.map((m, i) => (
            <p key={i} className="text-[12px] text-danger-text">
              {m}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}
