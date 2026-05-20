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
 * 2026-05-19 v1.24: popover를 React Portal로 document.body에 렌더.
 *   모달의 overflow-y-auto 컨테이너 안에서 popover가 잘려 보이던 문제 fix.
 *   - position: fixed + 트리거 getBoundingClientRect()로 절대 좌표 계산
 *   - 화면 하단 가까이면 popover를 트리거 위로 flip
 *   - 스크롤/리사이즈 시 닫기 (위치 정확도 유지)
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
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
  /**
   * loading=true 시 disabled + 선택값 숨김 + placeholder "불러오는 중…".
   * prefill API 응답 전에 default 값(09:00 등)이 잠깐 보였다가 갱신되는 flicker 방지용.
   */
  loading?: boolean
}

const ITEM_HEIGHT = 36
const MAX_POPOVER_HEIGHT = 288   // ≈ 8 items
const SCROLL_OFFSET_ITEMS = 2    // 선택값을 위에서 3번째 (index 2) 위치
const POPOVER_GAP = 4            // trigger와 popover 사이 간격(px)
const VIEWPORT_PADDING = 8       // 뷰포트 가장자리 여유

interface PopoverPosition {
  top: number
  left: number
  width: number
  maxHeight: number
  /** true면 popover가 트리거 위에 위치 (flip) */
  flipped: boolean
}

export default function CustomDropdown({
  value,
  options,
  onChange,
  placeholder = '',
  disabled,
  className,
  ariaLabel,
  loading = false,
}: CustomDropdownProps) {
  const [open, setOpen] = useState(false)
  const [highlighted, setHighlighted] = useState<number>(-1)
  const [popoverPos, setPopoverPos] = useState<PopoverPosition | null>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  // SSR 호환 — mount 후에만 portal 사용
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const selectedIdx = options.findIndex(o => o.value === value)
  // loading 중에는 선택값(예: default 09:00) 숨기고 placeholder만 노출.
  const selectedLabel = loading ? '' : (selectedIdx >= 0 ? options[selectedIdx].label : '')
  const effectiveDisabled = disabled || loading
  const effectivePlaceholder = loading ? '불러오는 중…' : placeholder

  // open 시 트리거 좌표 계산 + popover 위치/방향 결정
  const computePosition = (): PopoverPosition | null => {
    if (!triggerRef.current) return null
    const rect = triggerRef.current.getBoundingClientRect()
    const viewportHeight = window.innerHeight
    const desiredHeight = Math.min(MAX_POPOVER_HEIGHT, options.length * ITEM_HEIGHT + 8)

    const spaceBelow = viewportHeight - rect.bottom - VIEWPORT_PADDING
    const spaceAbove = rect.top - VIEWPORT_PADDING

    // 아래 공간이 부족하고 위 공간이 더 크면 flip
    const flipped = spaceBelow < desiredHeight && spaceAbove > spaceBelow

    const maxHeight = flipped
      ? Math.min(desiredHeight, spaceAbove - POPOVER_GAP)
      : Math.min(desiredHeight, spaceBelow - POPOVER_GAP)

    const top = flipped
      ? Math.max(VIEWPORT_PADDING, rect.top - maxHeight - POPOVER_GAP)
      : rect.bottom + POPOVER_GAP

    return {
      top,
      left: rect.left,
      width: rect.width,
      maxHeight,
      flipped,
    }
  }

  // open 시 위치 계산 + 선택값을 위에서 3번째 위치로 스크롤
  useLayoutEffect(() => {
    if (!open) {
      setPopoverPos(null)
      return
    }
    setPopoverPos(computePosition())
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // popover 마운트 후 스크롤 위치 보정 — 열릴 때 1회만.
  // popoverPos는 scroll/resize 시(특히 외부 capture=true) 매번 새 객체로 set되어
  // 이전엔 그때마다 scrollTop이 selectedIdx 위치로 강제 되돌아가 사용자가 안 스크롤되던 버그.
  // didInitScrollRef로 open false→true 사이클당 1회만 reset, 이후 사용자 휠은 자유.
  const didInitScrollRef = useRef(false)
  useLayoutEffect(() => {
    if (!open) { didInitScrollRef.current = false; return }
    if (!popoverPos || !listRef.current) return
    if (didInitScrollRef.current) return
    didInitScrollRef.current = true
    const targetIdx = selectedIdx >= 0 ? selectedIdx : 0
    const scrollIdx = Math.max(0, targetIdx - SCROLL_OFFSET_ITEMS)
    listRef.current.scrollTop = scrollIdx * ITEM_HEIGHT
    setHighlighted(targetIdx)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, popoverPos, selectedIdx])

  // 외부 클릭 + 키보드 + 스크롤/리사이즈
  useEffect(() => {
    if (!open) return

    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Node
      // trigger 영역 + popover list 영역 둘 다 안쪽이면 close 안 함
      if (wrapperRef.current?.contains(target)) return
      if (listRef.current?.contains(target)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        e.preventDefault()
      } else if (e.key === 'ArrowDown') {
        setHighlighted(prev => {
          const next = prev < 0 ? 0 : Math.min(options.length - 1, prev + 1)
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

    // 스크롤/리사이즈 시 위치 재계산 (position: fixed라 viewport 기준이라
    // 모달 내부 스크롤이 일어나면 trigger 위치가 viewport에서 이동 → 추적 필요)
    const onScrollOrResize = () => {
      const nextPos = computePosition()
      if (nextPos) setPopoverPos(nextPos)
    }

    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onScrollOrResize, true)  // capture — 내부 scroll 포함
    window.addEventListener('resize', onScrollOrResize)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onScrollOrResize, true)
      window.removeEventListener('resize', onScrollOrResize)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const popover = open && popoverPos ? (
    <ul
      ref={listRef}
      role="listbox"
      aria-label={ariaLabel}
      style={{
        position: 'fixed',
        top: popoverPos.top,
        left: popoverPos.left,
        width: popoverPos.width,
        maxHeight: popoverPos.maxHeight,
      }}
      className="z-[200] overflow-y-auto rounded-[10px] border border-border bg-surface shadow-[var(--shadow-popover)] py-1"
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
  ) : null

  return (
    <div ref={wrapperRef} className={`relative ${className ?? ''}`}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => { if (!effectiveDisabled) setOpen(o => !o) }}
        disabled={effectiveDisabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-busy={loading || undefined}
        className={triggerCls}
      >
        <span className={selectedLabel ? 'text-text-primary truncate' : 'text-text-muted truncate'}>
          {selectedLabel || effectivePlaceholder}
        </span>
        <ChevronDown className="h-4 w-4 text-text-muted shrink-0" aria-hidden />
      </button>

      {mounted && popover && createPortal(popover, document.body)}
    </div>
  )
}
