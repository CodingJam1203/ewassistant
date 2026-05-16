'use client'

/**
 * 정책서 7 — 클라이언트 자동 새로고침 (Stage 4).
 *
 * - 기본 60초 간격으로 onTick 호출
 * - 본인 출근예정 시각(plannedStartHHmm) ±10분 범위면 30초로 단축
 * - document.hidden(탭 비활성) 동안은 polling 일시 정지 → visible 시 즉시 1회 호출 + 재개
 * - 글로벌 모달 열림(useModalOpenCount > 0) 동안 일시 정지 (사용자 입력 보호)
 *
 * 사용 예:
 *   useAutoRefetch({
 *     enabled: !error,
 *     plannedStartHHmm: myCard?.start_time?.slice(0, 5) ?? null,
 *     onTick: () => fetchMyCard(),
 *   })
 */

import { useEffect, useRef } from 'react'
import { useModalOpenCount } from '@/contexts/ModalOpenContext'

const DEFAULT_INTERVAL_MS = 60_000
const FAST_INTERVAL_MS    = 30_000
const FAST_WINDOW_MIN     = 10  // ± 10분

export interface UseAutoRefetchOptions {
  /** false면 polling 등록 자체 안 함 (component unmount와 동치). */
  enabled?: boolean
  /** 'HH:mm' — null이면 항상 기본 60초. */
  plannedStartHHmm?: string | null
  onTick: () => void
}

function nowKstHHmm(d: Date = new Date()): string {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Seoul', hour12: false, hour: '2-digit', minute: '2-digit',
  })
  return fmt.format(d)
}

function hhmmDiffMinAbs(a: string, b: string): number {
  const [ah, am] = a.split(':').map(Number)
  const [bh, bm] = b.split(':').map(Number)
  if (![ah, am, bh, bm].every(Number.isFinite)) return Number.POSITIVE_INFINITY
  const aMin = ah * 60 + am
  const bMin = bh * 60 + bm
  return Math.abs(aMin - bMin)
}

export function useAutoRefetch({
  enabled = true,
  plannedStartHHmm,
  onTick,
}: UseAutoRefetchOptions): void {
  const onTickRef = useRef(onTick)
  onTickRef.current = onTick  // 항상 최신 reference (deps 안정성)

  const plannedRef = useRef<string | null | undefined>(plannedStartHHmm)
  plannedRef.current = plannedStartHHmm

  const modalOpenCount = useModalOpenCount()

  useEffect(() => {
    if (!enabled) return

    let timer: ReturnType<typeof setTimeout> | null = null

    const computeIntervalMs = (): number => {
      const planned = plannedRef.current
      if (!planned) return DEFAULT_INTERVAL_MS
      const diff = hhmmDiffMinAbs(nowKstHHmm(), planned.slice(0, 5))
      return diff <= FAST_WINDOW_MIN ? FAST_INTERVAL_MS : DEFAULT_INTERVAL_MS
    }

    const schedule = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(tick, computeIntervalMs())
    }

    const tick = () => {
      // 일시 정지 조건들
      if (typeof document !== 'undefined' && document.hidden) {
        // visibility change에서 재개됨 — 여기서는 다음 timer 등록 안 함
        return
      }
      if (modalOpenCount > 0) {
        // 모달 닫히면 modalOpenCount 변화 effect가 재등록함
        return
      }
      onTickRef.current()
      schedule()
    }

    const onVisibilityChange = () => {
      if (!document.hidden) {
        // 탭 다시 활성 — 즉시 1회 fetch + 일정 재개
        if (modalOpenCount === 0) {
          onTickRef.current()
        }
        schedule()
      } else if (timer) {
        clearTimeout(timer)
        timer = null
      }
    }

    schedule()
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      if (timer) clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [enabled, modalOpenCount])
}
