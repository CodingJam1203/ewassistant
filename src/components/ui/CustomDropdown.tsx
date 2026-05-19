'use client'

/**
 * CustomDropdown — native <select> 대체 커스텀 dropdown.
 *
 * 사용 동기 (2026-05-19 v1.14):
 *   native <select>의 열린 dropdown은 OS/브라우저 native control이라 스크롤 위치 제어 불가.
 *   시간 같은 양방향 enum에서 선택값이 항상 보이는 영역의 적절한 위치(위에서 3번째)에
 *   오도록 커스텀 popover로 교체.
 *
 * 디자인 일관성:
 *   - 트리거 버튼의 className은 기존 native <select>의 select-tight 패턴과 동일
 *     (border-border-strong / rounded-[10px] / h-10 / focus ring 동일)
 *   - 우측 chevron은 lucide ChevronDown 으로 명시 (native의 OS 그림 대체)
 *   - popover는 기존 card/popover 토큰 사용
 *
 * 키보드 지원: ↑/↓ 이동, Enter 선택, Esc 닫기, 외부 클릭 닫기
 *
 * 한계 (Phase 1):
 *   - 모바일에서 OS native wheel picker 못 씀 — 사용자 명시 trade-off 수용
 *   - portal 미사용 — 매우 좁은 컨테이너에선 popover overflow 가능. 필요 시 Phase 2.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'

export interface CustomDropdownOption {
  value: string
  label: string
}

interface CustomDropdownProps {
  value: string
  options: CustomDropdownOption[]
  onChange: (next: string) => void
  placeholder?: string
  disabled?: boolean
  /** 외곽 wrapper(div)에 적용. 예: 'flex-1 min-w-0' */
  className?: string
  ariaLabel?: string
}

const ITEM_HEIGHT = 36
const MAX_POPOVER_HEIGHT = 288   // ≈ 8 items
const SCROLL_OFFSET_ITEMS = 2    // 선택값을 위에서 3번째 (index 2) 위치

export default function CustomDropdown({
  value,
  options,
  onChange,
  placeholder = '',
  disabled,
  className,
  ariaLabel,
}: CustomDropdownProps) {
  const [open, setOpen] = useState(false)
  const [highlighted, setHighlighted] = useState<number>(-1)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  const selectedIdx = options.findIndex(o => o.value === value)
  const selectedLabel = selectedIdx >= 0 ? options[selectedIdx].label : ''

  // open 시 선택값을 위에서 3번째 위치로 스크롤 (사용자 결정 옵션 A)
  useLayoutEffect(() => {
    if (!open || !listRef.current) return
    const targetIdx = selectedIdx >= 0 ? selectedIdx : 0
    const scrollIdx = Math.max(0, targetIdx - SCROLL_OFFSET_ITEMS)
    listRef.current.scrollTop = scrollIdx * ITEM_HEIGHT
    setHighlighted(targetIdx)
  }, [open, selectedIdx])

  // 외부 클릭 + 키보드
  useEffect(() => {
    if (!open) return

    const onDocClick = (e: MouseEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        e.preventDefault()
      } else if (e.key === 'ArrowDown') {
        setHighlighted(prev => {
          const next = prev < 0 ? 0 : Math.min(options.length - 1, prev + 1)
          // 하이라이트 항목이 보이도록 스크롤 보정
          if (listRef.current) {
            const top = next * ITEM_HEIGHT
            const bot = top + ITEM_HEIGHT
            const viewTop = listRef.current.scrollTop
            const viewBot = viewTop + listRef.current.clientHeight
            if (bot > viewBot) listRef.current.scrollTop = bot - listRef.current.clientHeight
            else if (top < viewTop) listRef.current.scrollTop = top
          }
          return next
        })
        e.preventDefault()
      } else if (e.key === 'ArrowUp') {
        setHighlighted(prev => {
          const next = prev <= 0 ? 0 : prev - 1
          if (listRef.current) {
            const top = next * ITEM_HEIGHT
            if (top < listRef.current.scrollTop) listRef.current.scrollTop = top
          }
          return next
        })
        e.preventDefault()
      } else if (e.key === 'Enter') {
        if (highlighted >= 0 && highlighted < options.length) {
          onChange(options[highlighted].value)
          setOpen(false)
        }
        e.preventDefault()
      } else if (e.key === 'Home') {
        setHighlighted(0)
        if (listRef.current) listRef.current.scrollTop = 0
        e.preventDefault()
      } else if (e.key === 'End') {
        const last = options.length - 1
        setHighlighted(last)
        if (listRef.current) listRef.current.scrollTop = last * ITEM_HEIGHT
        e.preventDefault()
      }
    }

    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, options, highlighted, onChange])

  // 트리거 className — 기존 native <select>의 select-tight 패턴과 동일한 시각 토큰.
  // 단 `.select-tight`는 CSS background-image chevron을 자동 그리므로 lucide 아이콘과
  // 겹치지 않게 클래스명 자체는 사용 안 함. border/padding/focus는 그대로 매칭.
  const triggerCls =
    'block w-full h-10 rounded-[10px] border border-border-strong bg-surface ' +
    'text-sm tabular-nums px-3 py-2 ' +
    'focus:outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 ' +
    'disabled:bg-surface-muted disabled:text-text-disabled disabled:cursor-not-allowed ' +
    'text-left flex items-center justify-between gap-2'

  return (
    <div ref={wrapperRef} className={`relative ${className ?? ''}`}>
      <button
        type="button"
        onClick={() => { if (!disabled) setOpen(o => !o) }}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={triggerCls}
      >
        <span className={selectedLabel ? 'text-text-primary truncate' : 'text-text-muted truncate'}>
          {selectedLabel || placeholder}
        </span>
        <ChevronDown className="h-4 w-4 text-text-muted shrink-0" aria-hidden />
      </button>

      {open && (
        <ul
          ref={listRef}
          role="listbox"
          aria-label={ariaLabel}
          style={{ maxHeight: MAX_POPOVER_HEIGHT }}
          className="absolute z-50 left-0 right-0 mt-1 overflow-y-auto rounded-[10px] border border-border bg-surface shadow-[var(--shadow-popover)] py-1"
        >
          {options.map((opt, idx) => {
            const isSelected = opt.value === value
            const isHighlighted = idx === highlighted
            return (
              <li
                key={opt.value}
                role="option"
                aria-selected={isSelected}
                onMouseDown={(e) => {
                  // mousedown 사용 — onClick 보다 먼저 발생해서 외부 클릭 핸들러와 race 방지
                  e.preventDefault()
                  onChange(opt.value)
                  setOpen(false)
                }}
                onMouseEnter={() => setHighlighted(idx)}
                style={{ height: ITEM_HEIGHT }}
                className={
                  'flex items-center px-3 text-sm tabular-nums cursor-pointer ' +
                  (isSelected
                    ? 'bg-primary-600 text-white'
                    : isHighlighted
                      ? 'bg-primary-50 text-primary-700'
                      : 'text-text-primary hover:bg-primary-50 hover:text-primary-700')
                }
              >
                {opt.label}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
