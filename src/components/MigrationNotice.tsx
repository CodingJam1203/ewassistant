'use client'

/**
 * 임시 N-Click 페이지(ewassistant.vercel.app) 서비스 종료 안내 팝업.
 *
 * 이 배포(ewassistant.*)는 통째로 "임시 페이지"라 항상 노출한다.
 * 닫으면 sessionStorage에 박제 → 같은 탭(세션)에서는 다시 안 뜸. 새 접속 시 재노출.
 *
 * 정식 배포링크: https://nclick.nhr.kr/
 */

import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui'

const OFFICIAL_URL = 'https://nclick.nhr.kr/'
const DISMISS_KEY = 'nclick.migrationNotice.dismissed'

export default function MigrationNotice() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      if (sessionStorage.getItem(DISMISS_KEY) === '1') return
    } catch {
      // sessionStorage 접근 불가(시크릿 등) — 그냥 노출
    }
    // 초기 렌더 직후 비동기로 표시 (동기 setState로 인한 cascading render 방지)
    const t = setTimeout(() => setVisible(true), 0)
    return () => clearTimeout(t)
  }, [])

  const handleClose = () => {
    try {
      sessionStorage.setItem(DISMISS_KEY, '1')
    } catch {
      /* noop */
    }
    setVisible(false)
  }

  if (!visible) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="migration-notice-title"
    >
      {/* 백드롭 */}
      <div
        className="absolute inset-0 bg-black/40"
        onClick={handleClose}
        aria-hidden
      />

      {/* 카드 */}
      <div className="relative w-full max-w-md rounded-2xl border border-border bg-surface shadow-[var(--shadow-popover)] p-5 sm:p-6">
        <button
          type="button"
          onClick={handleClose}
          className="absolute right-3 top-3 inline-flex h-8 w-8 items-center justify-center rounded-[8px] text-text-muted hover:bg-surface-muted hover:text-text-primary"
          aria-label="닫기"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>

        <h3
          id="migration-notice-title"
          className="pr-8 text-base font-semibold text-text-primary"
        >
          임시 N-Click 페이지 사용 종료 안내
        </h3>

        <div className="mt-3 space-y-3 text-sm leading-relaxed text-text-secondary">
          <p>
            현재 임시 N-Click 페이지는{' '}
            <span className="font-semibold text-text-primary">6/29(월)</span>부로 사용이
            종료됩니다.{' '}
            <span className="text-text-muted">(데이터는 일시적으로 유지)</span>
          </p>
          <p>이후 출퇴근보고는 아래의 정식 배포링크에서 진행해주세요!</p>
        </div>

        <a
          href={OFFICIAL_URL}
          className="mt-4 block break-all rounded-[10px] border border-border bg-surface-muted px-3 py-2.5 text-sm font-medium text-primary-600 hover:underline"
        >
          {OFFICIAL_URL}
        </a>

        <div className="mt-5 flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={handleClose}>
            닫기
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              handleClose()
              window.location.href = OFFICIAL_URL
            }}
          >
            정식 페이지로 이동
          </Button>
        </div>
      </div>
    </div>
  )
}
