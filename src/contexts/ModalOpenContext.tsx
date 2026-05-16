'use client'

/**
 * 글로벌 "어떤 모달이 열려있는가" 카운터 (Stage 4).
 *
 * 사용자 입력 중인 모달이 열려있을 때 polling/refetch를 일시 중지하기 위한 신호.
 * 모달 컴포넌트가 mount/unmount마다 inc/dec를 호출. useAutoRefetch hook이
 * 이 카운터를 읽어 0보다 크면 polling을 건너뜀.
 *
 * 의도적으로 "어느 모달인가"는 추적하지 않음 — 카운터만 관리해 가벼움.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

interface ModalOpenContextValue {
  openCount: number
  inc: () => void
  dec: () => void
}

const ModalOpenContext = createContext<ModalOpenContextValue | null>(null)

export function ModalOpenProvider({ children }: { children: React.ReactNode }) {
  const [openCount, setOpenCount] = useState(0)

  const inc = useCallback(() => setOpenCount(n => n + 1), [])
  const dec = useCallback(() => setOpenCount(n => Math.max(0, n - 1)), [])

  const value = useMemo(() => ({ openCount, inc, dec }), [openCount, inc, dec])
  return <ModalOpenContext.Provider value={value}>{children}</ModalOpenContext.Provider>
}

/** Provider 밖에서 호출되면 카운터 0 + no-op inc/dec — 깨지지 않게 fallback. */
const fallback: ModalOpenContextValue = {
  openCount: 0,
  inc: () => {},
  dec: () => {},
}

export function useModalOpenCount(): number {
  return (useContext(ModalOpenContext) ?? fallback).openCount
}

/**
 * 모달 컴포넌트가 mount 시 카운터 +1, unmount 시 -1.
 * `enabled=false`면 등록 안 함 (조건부 모달일 때 사용).
 */
export function useRegisterModalOpen(enabled: boolean = true): void {
  const ctx = useContext(ModalOpenContext) ?? fallback
  useEffect(() => {
    if (!enabled) return
    ctx.inc()
    return () => ctx.dec()
  }, [enabled, ctx])
}
