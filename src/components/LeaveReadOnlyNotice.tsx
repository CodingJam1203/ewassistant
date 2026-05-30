'use client'

/**
 * 휴가 read-only 안내 박스 (v1.60, 2026-05-30)
 *
 * 정책 — 출퇴근보고/출근완료 모달에서 LeaveTimelineInput을 제거하고 이 컴포넌트로 대체.
 * 사용자가 직접 휴가를 등록/수정/삭제하지 않고, 캘린더 sheet 또는 별도 휴가 등록 흐름에서만
 * 처리하도록 단일화. 모달 안에서는 "이 날 어떤 휴가가 있는지" 정보만 안내.
 *
 * 표시 규칙
 *   - full_day(8H 종일): 🌴 라벨 — "이 날 종일 휴가 등록됨 (시간 자동 처리)"
 *   - 8H 미만(반차/시간단위): 🗓 라벨 — "이 날 캘린더에 ${label}(${H}H) 등록됨. 휴게로 직접 입력해 주셔야 반영됩니다."
 *   - 둘 다 없으면 렌더 X (null 반환)
 *
 * 시각 톤
 *   - full_day: warning bg/text (기존 휴가 chip 톤과 통일)
 *   - 8H 미만: info bg/text (v1.59 inline notice 톤 계승)
 *
 * 사용자 액션 — 안내만, 클릭 액션 없음. 휴가 수정/삭제는 캘린더 sheet 또는 별도 모달 경로로.
 */

import { Plane, Calendar } from 'lucide-react'
import {
  buildSubFullDayLeaveNotice,
  subFullDayLeaveItems,
  fullDayLeaveItems,
} from '@/lib/leave-timeline'
import type { LeaveTimeline } from '@/types/leave-timeline'

interface LeaveReadOnlyNoticeProps {
  value: LeaveTimeline
  /** 라벨 텍스트 — default "휴가". D+1 사전등록 영역은 "다음 출근일 휴가" 같이 override 가능 */
  labelPrefix?: string
}

export default function LeaveReadOnlyNotice({ value, labelPrefix }: LeaveReadOnlyNoticeProps) {
  const fullDays = fullDayLeaveItems(value)
  const subFullDays = subFullDayLeaveItems(value)
  if (fullDays.length === 0 && subFullDays.length === 0) return null

  return (
    <div className="space-y-1.5">
      {fullDays.length > 0 && (
        <div className="flex items-start gap-1.5 text-[12px] text-warning-text bg-warning-bg border border-warning-border rounded-md px-2 py-1.5 leading-snug">
          <Plane className="h-3.5 w-3.5 shrink-0 mt-0.5" aria-hidden />
          <span>
            <strong className="font-semibold">{labelPrefix ?? '이 날'} 종일 휴가 등록됨</strong>
            <span className="ml-1 text-text-muted">— 근무 시간 자동 처리</span>
          </span>
        </div>
      )}
      {subFullDays.map((it, i) => (
        <div
          key={`${it.leaveType}-${i}`}
          className="flex items-start gap-1.5 text-[12px] text-info-text bg-info-bg border border-info-border rounded-md px-2 py-1.5 leading-snug"
        >
          <Calendar className="h-3.5 w-3.5 shrink-0 mt-0.5" aria-hidden />
          <span>{buildSubFullDayLeaveNotice(it.label, it.roundedMinutes ?? 0)}</span>
        </div>
      ))}
    </div>
  )
}
