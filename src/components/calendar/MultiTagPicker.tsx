'use client'

/**
 * MultiTagPicker — Phase 4.3 제목 빌더용 multi-select 검색 dropdown.
 *
 * 두 종류 항목을 하나의 검색 결과에 섞어 선택:
 *   - 사람 (PickerUser): display_name, email, division, team
 *   - 그룹 (PickerTag) : label, alias_patterns, division_id, team_id, member_emails
 *
 * 선택 결과:
 *   PickerToken[] — { kind: 'user'|'tag', key: string, label: string, source: ... }
 *   상위(EventEditModal)에서 title 문자열로 직렬화: "[김재민, A파트] 본문"
 *
 * 본인 단축: 최상단에 ⭐ "본인 — {myDisplayName}" 한 줄 (검색 무시하고 항상 노출)
 * 정렬: 본인 본부 우선 → 그 외
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, Search, Star, User as UserIcon, Tag as TagIcon, X } from 'lucide-react'

export interface PickerUser {
  email: string
  display_name: string | null
  division: string | null
  team: string | null
}

export interface PickerTag {
  id: string
  label: string
  alias_patterns: string[]
  member_emails: string[]
  division_id: string
  team_id: string | null
}

export type PickerToken =
  | { kind: 'user'; key: string; label: string; email: string }
  | { kind: 'tag';  key: string; label: string; tagId: string }

interface MultiTagPickerProps {
  users: PickerUser[]
  tags: PickerTag[]
  divisions: Array<{ id: string; name: string }>
  myProfile: {
    email: string | null
    displayName: string | null
    divisionId: string | null
  }
  /** 현재 선택 토큰 */
  value: PickerToken[]
  onChange: (next: PickerToken[]) => void
  /** ariaLabel */
  ariaLabel?: string
  placeholder?: string
}

const ITEM_HEIGHT = 38
const MAX_POPOVER_HEIGHT = 360
const VIEWPORT_PADDING = 8

export default function MultiTagPicker({
  users, tags, divisions, myProfile, value, onChange,
  ariaLabel, placeholder = '태그 선택 (이름·그룹·팀)',
}: MultiTagPickerProps) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [popoverPos, setPopoverPos] = useState<{ top: number; left: number; width: number; maxHeight: number } | null>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLDivElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const divisionNameById = useMemo(() => {
    const m = new Map<string, string>()
    for (const d of divisions) m.set(d.id, d.name)
    return m
  }, [divisions])

  // 본인 본부 안 사용자/그룹 우선 정렬을 위해 본부 이름 필요
  const myDivisionName = myProfile.divisionId ? (divisionNameById.get(myProfile.divisionId) ?? null) : null

  // 검색·정렬된 사용자 리스트 — display_name null인 active 사용자도 안전하게 처리
  const filteredUsers = useMemo(() => {
    const query = q.trim().toLowerCase()
    // display_name 없는 row는 picker에서 제외 — 사람으로 식별 불가
    let arr = users.filter(u => (u.display_name ?? '').trim().length > 0)
    if (query) {
      arr = arr.filter(u =>
        (u.display_name ?? '').toLowerCase().includes(query) ||
        (u.email ?? '').toLowerCase().includes(query) ||
        (u.team ?? '').toLowerCase().includes(query) ||
        (u.division ?? '').toLowerCase().includes(query),
      )
    }
    arr.sort((a, b) => {
      const aIn = a.division === myDivisionName ? 0 : 1
      const bIn = b.division === myDivisionName ? 0 : 1
      if (aIn !== bIn) return aIn - bIn
      return (a.display_name ?? '').localeCompare(b.display_name ?? '', 'ko')
    })
    return arr
  }, [users, q, myDivisionName])

  // 검색·정렬된 그룹 리스트
  const filteredTags = useMemo(() => {
    const query = q.trim().toLowerCase()
    let arr = tags.slice()
    if (query) {
      arr = arr.filter(t =>
        t.label.toLowerCase().includes(query) ||
        t.alias_patterns.some(a => a.toLowerCase().includes(query)),
      )
    }
    arr.sort((a, b) => {
      const aIn = a.division_id === myProfile.divisionId ? 0 : 1
      const bIn = b.division_id === myProfile.divisionId ? 0 : 1
      if (aIn !== bIn) return aIn - bIn
      return a.label.localeCompare(b.label, 'ko')
    })
    return arr
  }, [tags, q, myProfile.divisionId])

  const selectedKeys = useMemo(() => new Set(value.map(v => v.key)), [value])
  const isMyselfSelected = useMemo(() => {
    return value.some(v => v.kind === 'user' && v.email.toLowerCase() === (myProfile.email ?? '').toLowerCase())
  }, [value, myProfile.email])

  // popover 위치 계산
  useEffect(() => {
    if (!open) { setPopoverPos(null); return }
    const computeAndSet = () => {
      if (!triggerRef.current) return
      const rect = triggerRef.current.getBoundingClientRect()
      const vh = window.innerHeight
      const spaceBelow = vh - rect.bottom - VIEWPORT_PADDING
      const desired = Math.min(MAX_POPOVER_HEIGHT, Math.max(220, spaceBelow))
      setPopoverPos({
        top: rect.bottom + 4,
        left: rect.left,
        width: rect.width,
        maxHeight: desired,
      })
    }
    computeAndSet()
    const onScrollOrResize = () => computeAndSet()
    window.addEventListener('scroll', onScrollOrResize, true)
    window.addEventListener('resize', onScrollOrResize)
    // input focus
    setTimeout(() => inputRef.current?.focus(), 0)
    return () => {
      window.removeEventListener('scroll', onScrollOrResize, true)
      window.removeEventListener('resize', onScrollOrResize)
    }
  }, [open])

  // 외부 클릭 닫기
  useEffect(() => {
    if (!open) return
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Node
      if (wrapperRef.current?.contains(target)) return
      if (popoverRef.current?.contains(target)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const addToken = (token: PickerToken) => {
    if (selectedKeys.has(token.key)) {
      // 이미 있음 — 제거 (toggle)
      onChange(value.filter(v => v.key !== token.key))
    } else {
      onChange([...value, token])
    }
  }

  const addMyself = () => {
    if (!myProfile.email || !myProfile.displayName) return
    addToken({
      kind: 'user',
      key: `user:${myProfile.email.toLowerCase()}`,
      label: myProfile.displayName,
      email: myProfile.email,
    })
  }

  const removeToken = (key: string) => {
    onChange(value.filter(v => v.key !== key))
  }

  // 같은 label tag가 본부마다 있을 때 구분 표기 — "(팀명)" 또는 "(본부 공용)"
  const tagSecondary = (t: PickerTag): string => {
    return divisionNameById.get(t.division_id) ?? ''
  }

  const popover = open && popoverPos ? (
    <div
      ref={popoverRef}
      style={{
        position: 'fixed',
        top: popoverPos.top,
        left: popoverPos.left,
        width: popoverPos.width,
        maxHeight: popoverPos.maxHeight,
      }}
      className="z-[200] rounded-[10px] border border-border bg-surface shadow-[var(--shadow-popover)] flex flex-col overflow-hidden"
    >
      {/* 검색 */}
      <div className="p-2 border-b border-border flex items-center gap-2">
        <Search className="h-4 w-4 text-text-muted shrink-0" />
        <input
          ref={inputRef}
          type="text"
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="이름·그룹·팀 검색"
          className="flex-1 bg-transparent text-sm outline-none placeholder:text-text-muted"
        />
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* 본인 단축 — 항상 최상단 */}
        {myProfile.email && myProfile.displayName && (
          <button
            type="button"
            onClick={addMyself}
            className={`w-full px-3 py-2 text-left text-sm border-b border-border flex items-center gap-2 ${isMyselfSelected ? 'bg-primary-50 text-primary-700' : 'bg-surface hover:bg-primary-50 hover:text-primary-700'}`}
            style={{ minHeight: ITEM_HEIGHT }}
          >
            <Star className="h-3.5 w-3.5 shrink-0" />
            <span className="font-medium">본인</span>
            <span className="text-text-muted text-xs">— {myProfile.displayName}</span>
            {isMyselfSelected && <span className="ml-auto text-[10px] text-primary-600">선택됨</span>}
          </button>
        )}

        {/* 사람 섹션 */}
        <div className="px-3 py-1 text-[10px] font-semibold text-text-muted bg-surface-muted/50 sticky top-0 flex items-center gap-1">
          <UserIcon className="h-3 w-3" /> 사람 ({filteredUsers.length})
        </div>
        {filteredUsers.length === 0 && (
          <div className="px-3 py-2 text-xs text-text-muted">매칭 없음</div>
        )}
        {filteredUsers.slice(0, 50).map(u => {
          const key = `user:${u.email.toLowerCase()}`
          const selected = selectedKeys.has(key)
          const displayName = u.display_name ?? u.email
          return (
            <button
              key={key}
              type="button"
              onClick={() => addToken({ kind: 'user', key, label: displayName, email: u.email })}
              className={`w-full px-3 py-1.5 text-left text-sm flex items-center gap-2 border-b border-border/60 ${selected ? 'bg-primary-50 text-primary-700' : 'bg-surface hover:bg-primary-50 hover:text-primary-700'}`}
              style={{ minHeight: ITEM_HEIGHT }}
            >
              <span className="font-medium">{displayName}</span>
              {u.team && <span className="text-xs text-text-muted">({u.team})</span>}
              {selected && <span className="ml-auto text-[10px] text-primary-600">선택됨</span>}
            </button>
          )
        })}
        {filteredUsers.length > 50 && (
          <div className="px-3 py-1 text-[10px] text-text-muted">+{filteredUsers.length - 50}명 — 검색으로 좁히세요</div>
        )}

        {/* 그룹 섹션 */}
        <div className="px-3 py-1 text-[10px] font-semibold text-text-muted bg-surface-muted/50 sticky top-0 flex items-center gap-1">
          <TagIcon className="h-3 w-3" /> 그룹·파트 ({filteredTags.length})
        </div>
        {filteredTags.length === 0 && (
          <div className="px-3 py-2 text-xs text-text-muted">매칭 없음</div>
        )}
        {filteredTags.slice(0, 50).map(t => {
          const key = `tag:${t.id}`
          const selected = selectedKeys.has(key)
          return (
            <button
              key={key}
              type="button"
              onClick={() => addToken({ kind: 'tag', key, label: t.label, tagId: t.id })}
              className={`w-full px-3 py-1.5 text-left text-sm flex items-center gap-2 border-b border-border/60 ${selected ? 'bg-primary-50 text-primary-700' : 'bg-surface hover:bg-primary-50 hover:text-primary-700'}`}
              style={{ minHeight: ITEM_HEIGHT }}
            >
              <span className="font-medium">{t.label}</span>
              <span className="text-xs text-text-muted">({tagSecondary(t)})</span>
              {t.alias_patterns.length > 0 && (
                <span className="text-[10px] text-text-muted ml-1 truncate max-w-[8rem]">
                  {t.alias_patterns.slice(0, 3).join(', ')}{t.alias_patterns.length > 3 ? '…' : ''}
                </span>
              )}
              {selected && <span className="ml-auto text-[10px] text-primary-600">선택됨</span>}
            </button>
          )
        })}
        {filteredTags.length > 50 && (
          <div className="px-3 py-1 text-[10px] text-text-muted">+{filteredTags.length - 50}건 — 검색으로 좁히세요</div>
        )}
      </div>
    </div>
  ) : null

  return (
    <div ref={wrapperRef} className="relative">
      <div
        ref={triggerRef}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen(o => !o)}
        className="min-h-[40px] w-full px-2 py-1.5 rounded-[10px] border border-border-strong bg-surface cursor-text flex flex-wrap items-center gap-1 focus-within:border-primary-500 focus-within:ring-2 focus-within:ring-primary-500/20"
      >
        {value.length === 0 ? (
          <span className="text-text-muted text-sm pl-1">{placeholder}</span>
        ) : (
          value.map(t => (
            <span
              key={t.key}
              className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded border ${t.kind === 'user' ? 'bg-primary-50 text-primary-700 border-primary-200' : 'bg-amber-50 text-amber-800 border-amber-200'}`}
            >
              {t.kind === 'user' ? <UserIcon className="h-3 w-3" /> : <TagIcon className="h-3 w-3" />}
              {t.label}
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); removeToken(t.key) }}
                className="hover:opacity-80"
                aria-label="제거"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))
        )}
        <span className="ml-auto inline-flex items-center text-text-muted shrink-0 pr-1">
          <ChevronDown className="h-4 w-4" />
        </span>
      </div>

      {mounted && popover && createPortal(popover, document.body)}
    </div>
  )
}
