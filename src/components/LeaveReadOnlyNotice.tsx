'use client'

/**
 * 휴가 read-only 안내 박스 (v1.60, 2026-05-30)
 *
 * 정책 — 출퇴근보고/출근완료 모달에서 LeaveTimelineInput을 제거하고 이 컴포넌트로 대체.
 * 사용자가 직접 휴가를 등록/수정하지 않고, 캘린더 sheet 또는 별도 휴가 등록 흐름에서만
 * 처리하도록 단일화. 모달 안에서는 "이 날 어떤 휴가가 있는지" 정보만 안내.
 *
 * v1.60.1 (2026-05-30) — onRemove 액션 추가:
 *   - full_day: "이 휴가 취소" 버튼 — 종일휴가를 출퇴근보고 모달 안에서 즉시 취소 가능
 *   - 8H 미만: "[일정 삭제]" 텍스트 링크 — 일정 개념이라 안내 박스 안에서 직접 제거
 *
 * 표시 규칙
 *   - full_day(8H 종일): 🌴 라벨 — "이 날 종일 휴가 등록됨 (시간 자동 처리)" + [이 휴가 취소] 버튼
 *   - 8H 미만(반차/시간단위): 🗓 라벨 — "이 날 캘린더에 ${label}(${H}H) 등록됨. 휴게로 직접 입력해 주셔야 반영됩니다." + [일정 삭제] 링크
 *   - 둘 다 없으면 렌더 X
 *
 * 시각 톤
 *   - full_day: warning bg/text (기존 휴가 chip 톤과 통일)
 *   - 8H 미만: info bg/text (v1.59 inline notice 톤 계승)
 *
 * 삭제 정책 — onRemove는 부모 폼의 leaveTimeline state에서 해당 항목을 인덱스로 제거.
 * Google Sheets 캘린더 원본은 안 건드림(외부) → 다음 prefill 시 또 들어올 수 있음.
 * 그땐 사용자가 다시 [일정 삭제] 누르면 되니까 워크플로우는 단순.
 */

import { Plane, Calendar, ExternalLink } from 'lucide-react'
import { useEffect, useState } from 'react'
import { buildSubFullDayLeaveNotice } from '@/lib/leave-timeline'
import type { LeaveTimeline } from '@/types/leave-timeline'

// v1.61 — 사용자 본부의 spreadsheet URL 1회 fetch.
// 안내 박스에서 calendar source 일정에 [캘린더 시트 열기] deep link 노출.
function useSheetSourceUrl(): string | null {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    fetch('/api/my/sheet-source-url')
      .then(r => (r.ok ? r.json() : null))
      .then((d: { url?: string | null } | null) => {
        if (!cancelled && d?.url) setUrl(d.url)
      })
      .catch(() => { /* silent */ })
    return () => { cancelled = true }
  }, [])
  return url
}

interface LeaveReadOnlyNoticeProps {
  value: LeaveTimeline
  /** 라벨 prefix — default "이 날". D+1 사전등록은 "다음 출근일" override */
  labelPrefix?: string
  /**
   * 항목 제거 콜백 — 부모가 leaveTimeline state에서 해당 인덱스를 빼는 형태로 처리.
   * 미지정 시 액션 버튼/링크 숨김 (순수 read-only 모드).
   */
  onRemove?: (index: number) => void
}

export default function LeaveReadOnlyNotice({ value, labelPrefix, onRemove }: LeaveReadOnlyNoticeProps) {
  // 전체 항목을 원본 인덱스 정보와 함께 분리
  const entries = (Array.isArray(value) ? value : []).map((item, originalIndex) => ({ item, originalIndex }))
  const fullDays = entries.filter(e => e.item?.leaveType === 'full_day')
  const subFullDays = entries.filter(e => e.item?.leaveType !== 'full_day' && (e.item?.roundedMinutes ?? 0) > 0)
  // v1.61 — 본부 시트 URL fetch (calendar source 항목 있을 때만 의미)
  const sheetUrl = useSheetSourceUrl()
  if (fullDays.length === 0 && subFullDays.length === 0) return null

  const prefix = labelPrefix ?? '이 날'

  return (
    <div className="space-y-1.5">
      {fullDays.map(({ item, originalIndex }) => (
        <div
          key={`full-${originalIndex}`}
          className="flex items-start gap-2 text-[12px] text-warning-text bg-warning-bg border border-warning-border rounded-md px-2 py-1.5 leading-snug"
        >
          <Plane className="h-3.5 w-3.5 shrink-0 mt-0.5" aria-hidden />
          <span className="flex-1">
            <strong className="font-semibold">{prefix} 종일 휴가 등록됨</strong>
            <span className="ml-1 text-text-muted">— 근무 시간 자동 처리</span>
          </span>
          {onRemove && (
            <button
              type="button"
              onClick={() => onRemove(originalIndex)}
              className="shrink-0 text-[11px] font-medium text-warning-text underline underline-offset-2 hover:text-warning-text/80"
            >
              이 휴가 취소
            </button>
          )}
        </div>
      ))}
      {subFullDays.map(({ item, originalIndex }) => {
        // v1.60.7 — Spreadsheet source 일정은 단방향 한계 안내 추가.
        // 사용자가 [일정 삭제] 누르면 work_logs에서 빠지지만 시트 원본은 그대로.
        // dismissed 마커로 다음 prefill은 차단되지만 시트에 적힌 상태는 그대로라 사용자가 직접 정정해야 함.
        const isCalendarSource = item.source === 'calendar'
        return (
          <div
            key={`sub-${originalIndex}`}
            className="flex items-start gap-2 text-[12px] text-info-text bg-info-bg border border-info-border rounded-md px-2 py-1.5 leading-snug"
          >
            <Calendar className="h-3.5 w-3.5 shrink-0 mt-0.5" aria-hidden />
            <span className="flex-1">
              {buildSubFullDayLeaveNotice(item.label, item.roundedMinutes ?? 0)}
              {onRemove && (
                <>
                  {' '}
                  <button
                    type="button"
                    onClick={() => onRemove(originalIndex)}
                    className="text-[11px] font-medium text-info-text underline underline-offset-2 hover:text-info-text/80"
                  >
                    {isCalendarSource ? '[이 일자에서 가리기]' : '[일정 삭제]'}
                  </button>
                </>
              )}
              {isCalendarSource && (
                <span className="block mt-0.5 text-[11px] text-text-muted">
                  ※ 시트 원본은 자동으로 빠지지 않습니다. 영구 삭제는 캘린더 시트에서 직접 수정해주세요.
                  {sheetUrl && (
                    <>
                      {' '}
                      <a
                        href={sheetUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-0.5 font-medium text-info-text underline underline-offset-2 hover:text-info-text/80"
                      >
                        캘린더 시트 열기
                        <ExternalLink className="h-3 w-3" aria-hidden />
                      </a>
                    </>
                  )}
                </span>
              )}
            </span>
          </div>
        )
      })}
    </div>
  )
}
