'use client'

/**
 * EditableLocationChips — 보기/편집 모드 분리 + optimistic 저장 + 부모 refetch debounce.
 *
 * 레이아웃 (A1 + A3):
 *   [예정] 재택 → 사무실
 *   [실제] [1 재택 ★] → [2 사무실] → [3 재택]  [✏️ 수정]
 *
 *   편집 모드 클릭 시 [실제] 라인의 칩에 컨트롤(★ ← → ✕)이 등장하고,
 *   추가 pill 줄이 아래에 펼쳐지고, 수정 버튼이 [완료] 버튼으로 바뀜.
 */

import { memo, useEffect, useRef, useState } from 'react'
import { Pencil, Check } from 'lucide-react'
import WorkLocationChipsView from '@/components/WorkLocationChipsView'
import WorkLocationChipsInput from '@/components/WorkLocationChipsInput'
import type { WorkLocations } from '@/types/work-locations-v2'

interface EditableLocationChipsProps {
  value: WorkLocations
  currentLabel: string | null
  currentIndex: number | null
  date: string
  onChange: () => void
  /** 보기 모드 상단 작은 안내 ("재택 → 사무실") — optional */
  plannedHint?: string | null
  /** 빈 상태일 때 안내문 (보기 모드) */
  emptyText?: string
  /** [예정]/[실제] 라벨 pill 표시 여부 (default true). 부모가 외부에 자체 라벨이 있을 때 false. */
  showLabels?: boolean
  /** 칩 크기. sm은 좁은 셀(리스트뷰)용. */
  chipSize?: 'sm' | 'md'
}

/** 작은 라벨 pill — 예정/실제 구분용 */
function LabelPill({ text, tone }: { text: string; tone: 'planned' | 'actual' }) {
  const cls =
    tone === 'planned'
      ? 'bg-surface-muted text-text-secondary'
      : 'bg-primary-50 text-primary-700'
  return (
    <span className={`inline-flex items-center h-6 px-2 rounded-full text-[11px] font-semibold shrink-0 ${cls}`}>
      {text}
    </span>
  )
}

function EditableLocationChipsImpl({
  value, currentLabel, currentIndex, date, onChange,
  plannedHint, emptyText,
  showLabels = true,
  chipSize = 'md',
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

  // 저장 실패 시 사용자에게 알림 + 로컬 optimistic 상태 보존 (부모 refetch 트리거 안 함).
  // refetch가 돌면 옛 서버 데이터로 useEffect가 chips를 덮어버려 "튕기는" UX가 발생함.
  const showSaveError = (msg: string) => {
    if (typeof window !== 'undefined') {
      // eslint-disable-next-line no-alert
      window.alert(`근무장소 저장 실패\n${msg}\n\n관리자에게 문의해주세요.`)
    }
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
    }).then(async res => {
      if (!res.ok) {
        let detail = `HTTP ${res.status}`
        try {
          const body = await res.json()
          if (body?.error) detail = body.error
        } catch { /* ignore */ }
        showSaveError(detail)
        return false
      }
      return true
    }).then(ok => {
      if (ok) scheduleParentRefresh()
    }).catch(err => {
      showSaveError(err instanceof Error ? err.message : String(err))
    }).finally(() => {
      pendingRef.current--
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
    }).then(async res => {
      if (!res.ok) {
        let detail = `HTTP ${res.status}`
        try {
          const body = await res.json()
          if (body?.error) detail = body.error
        } catch { /* ignore */ }
        showSaveError(detail)
        return false
      }
      return true
    }).then(ok => {
      if (ok) scheduleParentRefresh()
    }).catch(err => {
      showSaveError(err instanceof Error ? err.message : String(err))
    }).finally(() => {
      pendingRef.current--
    })
  }

  const effectiveIndex = localIndex ?? currentIndex

  const editButton = (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className="inline-flex items-center gap-1 h-7 px-2.5 rounded-full border border-dashed border-border-strong text-[11px] text-text-secondary hover:text-primary-700 hover:border-primary-500 hover:bg-primary-50 transition-colors"
    >
      <Pencil className="h-3 w-3" aria-hidden />
      수정
    </button>
  )

  const doneButton = (
    <button
      type="button"
      onClick={() => setEditing(false)}
      className="inline-flex items-center gap-1 h-7 px-2.5 rounded-full bg-primary-600 text-white text-[11px] font-semibold hover:bg-primary-700 transition-colors"
    >
      <Check className="h-3 w-3" aria-hidden />
      완료
    </button>
  )

  return (
    <div className="space-y-1.5">
      {/* 예정 라인 — showLabels=false면 부모가 외부에 라벨을 그리므로 본 컴포넌트는 칩화 생략 */}
      {plannedHint && showLabels && (
        <div className="flex items-center gap-2 flex-wrap">
          <LabelPill text="예정" tone="planned" />
          <span className="text-[12px] text-text-secondary">{plannedHint}</span>
        </div>
      )}

      {/* 실제 라인 */}
      {!editing ? (
        <WorkLocationChipsView
          value={chips}
          currentLabel={currentLabel}
          currentIndex={effectiveIndex}
          chipsLeading={showLabels ? <LabelPill text="실제" tone="actual" /> : null}
          chipsTrailing={editButton}
          emptyText={emptyText ?? '근무장소가 없습니다. 수정 클릭 → 추가'}
          chipSize={chipSize}
        />
      ) : (
        <div className="space-y-2">
          <WorkLocationChipsInput
            value={chips}
            onChange={handleChipsChange}
            currentLabel={currentLabel}
            currentIndex={effectiveIndex}
            onSetCurrent={handleSetCurrent}
            chipsLeading={showLabels ? <LabelPill text="실제" tone="actual" /> : null}
            chipsTrailing={doneButton}
            chipSize={chipSize}
            compact
          />
          <p className="text-[11px] text-text-muted">
            현재 위치의 별(★)을 클릭해주세요
          </p>
        </div>
      )}
    </div>
  )
}

export default memo(EditableLocationChipsImpl)
