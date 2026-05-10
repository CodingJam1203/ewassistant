'use client'

/**
 * 근무장소 칩 입력 컴포넌트 (v2).
 *
 * - 추가 UI: 4 인라인 pill (사무실 / 재택 / 외근 / 기타)
 * - 칩 누적, 좌/우 이동, 삭제
 * - (옵션) 별표 ★ — 현재 위치 마커
 *   * currentIndex와 일치하는 칩에 ★ 채워짐, 다른 칩은 외곽선 ☆
 *   * ☆ 클릭 시 onSetCurrent 콜백 호출 (해당 칩을 현재 위치로 마킹)
 * - chipsLeading / chipsTrailing — 칩 줄 시작/끝에 외부 노드(라벨 pill, 완료 버튼 등) 끼우기
 */

import { useState, useMemo, type ReactNode } from 'react'
import { ArrowRight, X, MapPin, ArrowLeft, Plus, Star } from 'lucide-react'
import {
  WORK_LOCATION_KIND_LABELS,
  type WorkLocationKind,
  type WorkLocations,
} from '@/types/work-locations-v2'
import { chipLabel, type LocationsValidationError } from '@/lib/work-locations-v2'

interface WorkLocationChipsInputProps {
  value: WorkLocations
  onChange: (next: WorkLocations) => void
  errors?: LocationsValidationError[]
  disabled?: boolean
  compact?: boolean
  /** 현재 위치 라벨 — 일치하는 칩에 ★ 마커 표시 (index가 우선, 그 다음 라벨 fallback) */
  currentLabel?: string | null
  /** 현재 위치 칩 index — 우선 매칭. 같은 라벨이 여러 개일 때 정확한 chip 식별 */
  currentIndex?: number | null
  /** ★ 클릭 시 콜백 — (label, index) 함께 전달 */
  onSetCurrent?: (label: string, index: number) => void
  /** 칩 줄 시작에 끼우는 노드 (예: 라벨 pill) */
  chipsLeading?: ReactNode
  /** 칩 줄 끝에 끼우는 노드 (예: 완료 버튼) */
  chipsTrailing?: ReactNode
  /** 칩 크기. sm은 좁은 셀(리스트뷰)용 */
  chipSize?: 'sm' | 'md'
}

const KIND_ORDER: WorkLocationKind[] = ['office', 'field', 'remote', 'custom']

export default function WorkLocationChipsInput({
  value,
  onChange,
  errors,
  disabled,
  compact,
  currentLabel,
  currentIndex,
  onSetCurrent,
  chipsLeading,
  chipsTrailing,
  chipSize = 'md',
}: WorkLocationChipsInputProps) {
  const chipCls =
    chipSize === 'sm'
      ? 'border px-2 py-0.5 text-[11px]'
      : 'border-2 px-2.5 py-1 text-[13px]'
  const iconCls = chipSize === 'sm' ? 'h-2.5 w-2.5' : 'h-3 w-3'
  const indexCls = chipSize === 'sm' ? 'text-[9px]' : 'text-[10px]'
  const arrowCls = chipSize === 'sm' ? 'h-3 w-3' : 'h-4 w-4'
  const ctrlSize = chipSize === 'sm' ? 'h-4 w-4' : 'h-5 w-5'
  const [selectedKind, setSelectedKind] = useState<WorkLocationKind | ''>('')
  const [pendingCustom, setPendingCustom] = useState('')

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

  const handleKindSelect = (k: WorkLocationKind) => {
    if (disabled) return
    if (k === 'custom') {
      setSelectedKind('custom')
      return
    }
    onChange([...value, { kind: k }])
    setSelectedKind('')
  }

  const handleCustomAdd = () => {
    if (disabled) return
    const trimmed = pendingCustom.trim()
    if (!trimmed) return
    onChange([...value, { kind: 'custom', customLabel: trimmed }])
    setPendingCustom('')
    setSelectedKind('')
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

  const showStar = !!onSetCurrent
  const showChipsRow = !!chipsLeading || !!chipsTrailing || value.length > 0

  return (
    <div className="space-y-2.5">
      {/* 칩 줄 (라벨 + 칩들 + 완료 버튼) */}
      {showChipsRow && (
        <div className="flex flex-wrap items-center gap-1.5">
          {chipsLeading}
          {value.map((chip, i) => {
            const itemErrors = errorByIndex.byIndex.get(i) ?? []
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
                  className={`inline-flex items-center gap-1 rounded-full ${chipCls} ${
                    itemErrors.length > 0
                      ? 'border-danger-border bg-danger-bg text-danger-text'
                      : isCurrent
                        ? 'border-warning-text bg-warning-bg text-warning-text'
                        : 'border-primary-200 bg-primary-50 text-primary-700'
                  }`}
                >
                  <span className={`${indexCls} tabular-nums font-semibold ${isCurrent ? 'text-warning-text' : 'text-primary-600'}`}>
                    {i + 1}
                  </span>
                  <MapPin className={`${iconCls} shrink-0 ${isCurrent ? 'text-warning-text' : 'text-primary-600'}`} aria-hidden />
                  <span className="font-semibold px-0.5">{label}</span>
                  {showStar && (
                    <button
                      type="button"
                      onClick={() => onSetCurrent?.(label, i)}
                      disabled={disabled}
                      aria-label={isCurrent ? '현재 위치' : '이 위치를 현재 위치로 표시'}
                      title={isCurrent ? '현재 위치' : '현재 위치로 표시'}
                      className={`inline-flex items-center justify-center ${ctrlSize} rounded-full transition-colors ${
                        isCurrent
                          ? 'text-warning-text hover:bg-warning-text/10'
                          : 'text-text-muted hover:text-warning-text hover:bg-warning-bg'
                      }`}
                    >
                      <Star className={`${iconCls} ${isCurrent ? 'fill-current' : ''}`} aria-hidden />
                    </button>
                  )}
                  {!disabled && i > 0 && (
                    <button
                      type="button"
                      onClick={() => handleMove(i, -1)}
                      aria-label={`${i + 1}번째 항목 앞으로 이동`}
                      title="앞으로"
                      className={`inline-flex items-center justify-center ${ctrlSize} rounded-full text-primary-700 hover:text-white hover:bg-primary-600 transition-colors`}
                    >
                      <ArrowLeft className={`${iconCls}`} aria-hidden />
                    </button>
                  )}
                  {!disabled && i < value.length - 1 && (
                    <button
                      type="button"
                      onClick={() => handleMove(i, 1)}
                      aria-label={`${i + 1}번째 항목 뒤로 이동`}
                      title="뒤로"
                      className={`inline-flex items-center justify-center ${ctrlSize} rounded-full text-primary-700 hover:text-white hover:bg-primary-600 transition-colors`}
                    >
                      <ArrowRight className={`${iconCls}`} aria-hidden />
                    </button>
                  )}
                  {!disabled && (
                    <button
                      type="button"
                      onClick={() => handleRemove(i)}
                      aria-label={`${i + 1}번째 항목 삭제`}
                      title="삭제"
                      className={`inline-flex items-center justify-center ${ctrlSize} rounded-full text-primary-700 hover:text-white hover:bg-danger-text transition-colors`}
                    >
                      <X className={`${iconCls}`} aria-hidden />
                    </button>
                  )}
                  {itemErrors.length > 0 && (
                    <span className="ml-1 text-[10px] text-danger-text">
                      {itemErrors[0]}
                    </span>
                  )}
                </div>
                {i < value.length - 1 && (
                  <ArrowRight className={`${arrowCls} text-text-muted shrink-0`} aria-hidden />
                )}
              </div>
            )
          })}
          {chipsTrailing}
        </div>
      )}

      {/* 추가 영역 — 4 인라인 pill (사무실/재택/외근/기타) */}
      <div className="flex flex-wrap items-center gap-1.5">
        {selectedKind !== 'custom' && KIND_ORDER.filter(k => k !== 'custom').map(k => (
          <button
            key={k}
            type="button"
            onClick={() => handleKindSelect(k)}
            disabled={disabled}
            className="inline-flex items-center h-7 px-2.5 rounded-full border border-dashed border-border-strong text-[12px] text-text-secondary hover:text-primary-700 hover:border-primary-500 hover:bg-primary-50 disabled:opacity-50 transition-colors"
          >
            + {WORK_LOCATION_KIND_LABELS[k]}
          </button>
        ))}
        {selectedKind !== 'custom' ? (
          <button
            type="button"
            onClick={() => handleKindSelect('custom')}
            disabled={disabled}
            className="inline-flex items-center h-7 px-2.5 rounded-full border border-dashed border-border-strong text-[12px] text-text-secondary hover:text-primary-700 hover:border-primary-500 hover:bg-primary-50 disabled:opacity-50 transition-colors"
          >
            + 기타…
          </button>
        ) : (
          <>
            <input
              type="text"
              value={pendingCustom}
              onChange={e => setPendingCustom(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  handleCustomAdd()
                } else if (e.key === 'Escape') {
                  e.preventDefault()
                  setPendingCustom(''); setSelectedKind('')
                }
              }}
              placeholder="상세 장소 (예: 카페, 거래처)"
              disabled={disabled}
              autoFocus
              className="flex-1 min-w-[140px] h-7 rounded-full border border-primary-500 bg-surface px-2.5 text-[12px] focus:outline-none focus:ring-2 focus:ring-primary-500/20 disabled:opacity-50"
            />
            <button
              type="button"
              onClick={handleCustomAdd}
              disabled={disabled || !pendingCustom.trim()}
              className="inline-flex items-center gap-1 h-7 px-2.5 rounded-full text-[12px] font-medium text-white bg-primary-600 hover:bg-primary-700 disabled:opacity-50 transition-colors"
            >
              <Plus className="h-3 w-3" aria-hidden />
              추가
            </button>
            <button
              type="button"
              onClick={() => { setPendingCustom(''); setSelectedKind('') }}
              disabled={disabled}
              className="inline-flex items-center justify-center h-7 w-7 rounded-full text-text-muted hover:text-text-primary hover:bg-surface-muted transition-colors"
              aria-label="취소"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          </>
        )}
      </div>

      {/* 빈 상태 안내 — chips 없고 leading/trailing도 없을 때 */}
      {value.length === 0 && !chipsLeading && !chipsTrailing && !compact && (
        <p className="text-[12px] text-text-muted">
          위 버튼에서 장소를 선택하면 칩으로 추가됩니다.
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
