'use client'

/**
 * EditableLocationChips — 보기/편집 모드 분리 + optimistic 저장 + 부모 refetch debounce.
 *
 * 보기 모드: WorkLocationChipsView (칩 + 화살표 + ★) + 우상단 "수정" 버튼
 * 편집 모드: WorkLocationChipsInput (4 pill add UI + 칩 컨트롤) + 우상단 "완료" 버튼
 *
 * 호출자(home/team)는 actualChips + currentLabel/currentIndex만 넘기면 됨.
 * API 호출/optimistic 갱신/parent debounce는 모두 내부에서 처리.
 *
 * 사용:
 *   <EditableLocationChips
 *     value={chips}
 *     currentIndex={card.current_location_index}
 *     currentLabel={card.current_location}
 *     date={today}
 *     onChange={() => fetchCards()}    // 부모 refetch (debounced)
 *     plannedHint="재택 → 사무실"        // optional, 보기 모드에 작은 안내문
 *   />
 */

import { useEffect, useRef, useState } from 'react'
import WorkLocationChipsView from '@/components/WorkLocationChipsView'
import WorkLocationChipsInput from '@/components/WorkLocationChipsInput'
import type { WorkLocations } from '@/types/work-locations-v2'

interface EditableLocationChipsProps {
  value: WorkLocations
  currentLabel: string | null
  currentIndex: number | null
  date: string
  onChange: () => void
  /** 보기 모드 상단 작은 안내 ("예정: 재택 → 사무실") — optional */
  plannedHint?: string | null
  /** 빈 상태일 때 안내문 (보기 모드) */
  emptyText?: string
}

export default function EditableLocationChips({
  value, currentLabel, currentIndex, date, onChange,
  plannedHint, emptyText,
}: EditableLocationChipsProps) {
  const [editing, setEditing] = useState(false)

  // 로컬 optimistic state — 즉시 반영
  const [chips, setChips] = useState<WorkLocations>(value)
  const [localIndex, setLocalIndex] = useState<number | null>(null)

  // 서버 응답 race condition 방지 + 부모 refetch debounce
  const pendingRef = useRef(0)
  const onChangeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // pending 중에는 외부 prop 동기화 차단 (낙관 업데이트 보존)
  useEffect(() => {
    if (pendingRef.current === 0) setChips(value)
  }, [JSON.stringify(value)]) // eslint-disable-line react-hooks/exhaustive-deps

  // 부모 currentIndex가 로컬과 일치하면 오버라이드 해제
  useEffect(() => {
    if (localIndex !== null && currentIndex === localIndex) setLocalIndex(null)
  }, [currentIndex, localIndex])

  // 컴포넌트 unmount 시 타이머 정리
  useEffect(() => () => {
    if (onChangeTimerRef.current) clearTimeout(onChangeTimerRef.current)
  }, [])

  const scheduleParentRefresh = () => {
    if (onChangeTimerRef.current) clearTimeout(onChangeTimerRef.current)
    onChangeTimerRef.current = setTimeout(() => {
      if (pendingRef.current === 0) onChange()
    }, 700)
  }

  // chips 변경 시 marked chip의 새 index 추론 (reference + kind/label 매칭)
  const recomputeIndexAfterChange = (
    prev: WorkLocations,
    next: WorkLocations,
    prevIdx: number | null,
  ): number | null => {
    if (next.length === 0) return null
    if (prevIdx === null || prevIdx < 0 || prevIdx >= prev.length) {
      return next.length > 0 ? 0 : null
    }
    const target = prev[prevIdx]
    const refIdx = next.indexOf(target)
    if (refIdx >= 0) return refIdx
    const match = next.findIndex(c =>
      c.kind === target.kind &&
      (c.kind !== 'custom' || c.customLabel === target.customLabel),
    )
    return match >= 0 ? match : 0
  }

  const handleChipsChange = (next: WorkLocations) => {
    const effIdx = localIndex ?? currentIndex
    const newIndex = recomputeIndexAfterChange(chips, next, effIdx)
    setChips(next)
    setLocalIndex(newIndex)
    pendingRef.current++
    fetch('/api/team-status/location', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        date, target: 'actual_replace',
        locations: next, location: '',
        currentIndex: newIndex,
      }),
    }).finally(() => {
      pendingRef.current--
      scheduleParentRefresh()
    })
  }

  const handleSetCurrent = (label: string, index: number) => {
    setLocalIndex(index)
    pendingRef.current++
    fetch('/api/team-status/location', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        date, target: 'current',
        location: label, currentIndex: index,
      }),
    }).finally(() => {
      pendingRef.current--
      scheduleParentRefresh()
    })
  }

  const effectiveIndex = localIndex ?? currentIndex

  if (!editing) {
    // ─── 보기 모드 ─────────────────────────────────────────────────
    return (
      <div className="space-y-1">
        {plannedHint && (
          <p className="text-[11px] text-text-muted">
            <span className="font-semibold mr-1">예정</span>{plannedHint}
          </p>
        )}
        <WorkLocationChipsView
          value={chips}
          currentLabel={currentLabel}
          currentIndex={effectiveIndex}
          onEdit={() => setEditing(true)}
          emptyText={emptyText ?? '근무장소가 없습니다. 수정 클릭 → 추가'}
        />
      </div>
    )
  }

  // ─── 편집 모드 ─────────────────────────────────────────────────
  return (
    <div className="space-y-2 rounded-[10px] border border-primary-500 bg-primary-50/30 p-2.5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold text-primary-700">근무장소 편집</span>
        <button
          type="button"
          onClick={() => setEditing(false)}
          className="inline-flex items-center h-6 px-2 rounded-md text-[11px] text-primary-700 hover:bg-primary-100 transition-colors"
        >
          완료
        </button>
      </div>
      {plannedHint && (
        <p className="text-[11px] text-text-muted">
          <span className="font-semibold mr-1">예정</span>{plannedHint}
        </p>
      )}
      <WorkLocationChipsInput
        value={chips}
        onChange={handleChipsChange}
        currentLabel={currentLabel}
        currentIndex={effectiveIndex}
        onSetCurrent={handleSetCurrent}
        compact
      />
      <p className="text-[11px] text-text-muted">
        현재 위치의 별(★)을 클릭해주세요
      </p>
    </div>
  )
}
