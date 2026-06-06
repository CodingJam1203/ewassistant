'use client'

/**
 * 휴가 시간 입력 컴포넌트 (v1.83 — 시작/끝/점심토글 모델)
 *
 * UI 구성:
 *   ☐ 휴가 등록 (체크박스)
 *     ↓ 체크 시 펼쳐짐
 *   시작 [09:00 ▼]   종료 [18:00 ▼]
 *   ☑ 점심휴게 1H 포함
 *   → 휴가 시간: 8H 00:00
 *
 * 시간 옵션:
 *   - 시작: 00:00 ~ 23:30 (30분 step, 48개)
 *   - 종료: 00:30 ~ 24:00 (30분 step, 48개) — 24:00은 자정 표현
 *
 * 동작:
 *   - 시작 변경 시 끝 ≤ 시작이면 끝 = 시작 + 30분 (auto-sync, EventEditModal 패턴)
 *   - 점심 토글 자동 비활성: 시작 ≤ 12:00 AND 종료 ≥ 13:00 아닐 때 disabled + OFF
 *   - 기본값: 09:00~18:00 + 점심 ON = 8H
 *
 * leaveType 자동 분류 (classifyLeaveTypeByRange):
 *   - 실휴가 ≥ 480 (8H) → full_day
 *   - 시작 ≥ 13:00       → afternoon_half
 *   - else              → morning_half
 */

import { Plane, AlertCircle, Info } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { LeaveTimeline } from '@/types/leave-timeline'
import {
  buildLeaveItem,
  computeLeaveMinutes,
  classifyLeaveTypeByRange,
  hasSubFullDayLeave,
  SUB_FULL_DAY_LEAVE_NOTICE,
  LEAVE_NPM_NOTICE,
  LEAVE_START_HHMM_OPTIONS,
  LEAVE_END_HHMM_OPTIONS,
} from '@/lib/leave-timeline'
import CustomDropdown from '@/components/ui/CustomDropdown'

interface LeaveTimelineInputProps {
  value: LeaveTimeline
  onChange: (next: LeaveTimeline) => void
  disabled?: boolean
  /**
   * v1.83 — true면 '휴가 등록' 체크박스 숨김 + 항상 펼친 상태로 노출.
   * VacationRegisterModal 같이 휴가 입력이 필수인 폼에서 사용.
   * default false (출퇴근보고 모달은 체크박스 패턴 유지).
   */
  alwaysEnabled?: boolean
}

// Phase B — 사용자 mode가 sheet_only일 때 시트 동기화 안내. 모든 mount에서 1회 fetch.
function useUserCalendarMode(): string | null {
  const [mode, setMode] = useState<string | null>(null)
  useEffect(() => {
    let canceled = false
    fetch('/api/my/calendar-mode')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (!canceled && d) setMode(d.mode) })
      .catch(() => { /* silent */ })
    return () => { canceled = true }
  }, [])
  return mode
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0)
}

function addMinutesToHhmm(hhmm: string, addMin: number): string {
  const total = toMinutes(hhmm) + addMin
  const h = Math.floor(total / 60)
  const m = total % 60
  // 24:00 자정 종료까지 허용. 그 이상은 자정으로 clamp.
  if (h >= 24) return '24:00'
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/** 시작·끝이 점심 12~13시 구간을 완전히 거치는지 */
function spansLunch(start: string, end: string): boolean {
  return toMinutes(start) <= 12 * 60 && toMinutes(end) >= 13 * 60
}

/** 분 → 'NH MM분' 표시 (예: 480 → '8H', 510 → '8H 30분', 300 → '5H') */
function formatHoursAndMinutes(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return '0H'
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (m === 0) return `${h}H`
  return `${h}H ${m}분`
}

const DEFAULT_START = '09:00'
const DEFAULT_END   = '18:00'

export default function LeaveTimelineInput({ value, onChange, disabled, alwaysEnabled = false }: LeaveTimelineInputProps) {
  const userMode = useUserCalendarMode()
  // v1.59 — 8H 미만 휴가 안내 (캘린더 자동 prefill 케이스 포함)
  const showSubFullDayNotice = hasSubFullDayLeave(value)

  // 기존 row prefill: value의 첫 항목에서 startTime/endTime 복원
  const first = value?.[0]
  const enabled = alwaysEnabled || !!first
  const start = first?.startTime ?? DEFAULT_START
  const end   = first?.endTime   ?? DEFAULT_END

  // 점심 포함 여부 — actualMinutes가 (끝-시작) - 60이면 lunchIncluded=true로 역추론.
  // 그렇지 않으면 false. (저장 모델에는 lunchIncluded 필드 없음 — 표시만)
  const widthMin = Math.max(0, toMinutes(end) - toMinutes(start))
  const lunchInferred = enabled
    ? (spansLunch(start, end) && first!.actualMinutes === widthMin - 60)
    : true   // 기본값 ON
  const [lunchIncluded, setLunchIncluded] = useState<boolean>(lunchInferred)
  // value prop이 외부에서 바뀌면 lunchIncluded도 재추론
  useEffect(() => {
    setLunchIncluded(lunchInferred)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [first?.startTime, first?.endTime, first?.actualMinutes])

  const lunchAvailable = spansLunch(start, end)
  const effectiveLunch = lunchAvailable && lunchIncluded
  const minutes = computeLeaveMinutes(start, end, effectiveLunch)
  const leaveType = classifyLeaveTypeByRange(start, minutes)

  function pushItem(newStart: string, newEnd: string, newLunchIncluded: boolean) {
    const effLunch = spansLunch(newStart, newEnd) && newLunchIncluded
    const mins = computeLeaveMinutes(newStart, newEnd, effLunch)
    const type = classifyLeaveTypeByRange(newStart, mins)
    if (!type || mins <= 0) {
      onChange([])
      return
    }
    onChange([buildLeaveItem(type, '휴가', 'manual', mins, newStart, newEnd)])
  }

  function handleToggleEnabled() {
    if (disabled) return
    if (enabled) {
      onChange([])
    } else {
      pushItem(DEFAULT_START, DEFAULT_END, true)
    }
  }

  function handleStartChange(v: string) {
    let newEnd = end
    // auto-sync: 끝 ≤ 시작이면 끝 = 시작 + 30min (휴가 30분 단위 정책)
    if (toMinutes(newEnd) <= toMinutes(v)) {
      newEnd = addMinutesToHhmm(v, 30)
    }
    pushItem(v, newEnd, lunchIncluded)
  }

  function handleEndChange(v: string) {
    pushItem(start, v, lunchIncluded)
  }

  function handleLunchToggle(next: boolean) {
    setLunchIncluded(next)
    pushItem(start, end, next)
  }

  return (
    <div className="space-y-1.5">
      {/* Phase B — sheet_only mode 사용자에게 시트 동기화 안내 */}
      {userMode === 'sheet_only' && (
        <div className="flex items-start gap-1.5 text-[11px] text-warning-text bg-warning-bg border border-warning-border rounded-md px-2 py-1.5 leading-snug">
          <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <span>
            이 팀은 시트로 운영됩니다. 휴가는 N-Click에 저장되지만 시트와 자동 동기화되지 않습니다.
            <strong className="font-semibold"> 시트에도 직접 휴가를 등록해주세요.</strong>
          </span>
        </div>
      )}

      {/* 휴가 등록 토글 — alwaysEnabled 모드에서는 hide */}
      {!alwaysEnabled && (
        <label className="inline-flex items-center gap-2 text-[12px] text-text-primary cursor-pointer select-none">
          <input
            type="checkbox"
            checked={enabled}
            onChange={handleToggleEnabled}
            disabled={disabled}
            className="h-3.5 w-3.5"
            aria-label="휴가 등록"
          />
          <Plane className="h-3.5 w-3.5 text-warning-text shrink-0" aria-hidden />
          <span>휴가 등록</span>
        </label>
      )}

      {/* 휴가 입력 영역 — enabled일 때만 펼침 */}
      {enabled && (
        <div className={alwaysEnabled ? 'space-y-1.5' : 'pl-5 space-y-1.5'}>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[12px] text-text-muted">시작</span>
            <CustomDropdown
              value={start}
              onChange={handleStartChange}
              disabled={disabled}
              ariaLabel="휴가 시작 시간"
              className="w-24"
              options={LEAVE_START_HHMM_OPTIONS}
            />
            <span className="text-[12px] text-text-muted">종료</span>
            <CustomDropdown
              value={end}
              onChange={handleEndChange}
              disabled={disabled}
              ariaLabel="휴가 종료 시간"
              className="w-24"
              options={LEAVE_END_HHMM_OPTIONS}
            />
          </div>

          {/* 점심 토글 — 시작≤12 AND 종료≥13 일 때만 활성 */}
          <label className="inline-flex items-center gap-2 text-[12px] text-text-secondary cursor-pointer select-none">
            <input
              type="checkbox"
              checked={effectiveLunch}
              onChange={(e) => handleLunchToggle(e.target.checked)}
              disabled={disabled || !lunchAvailable}
              className="h-3.5 w-3.5"
              aria-label="점심휴게 1시간 포함"
            />
            <span className={lunchAvailable ? '' : 'text-text-muted'}>
              점심휴게 1H 포함
              {!lunchAvailable && (
                <span className="text-[11px] text-text-muted ml-1">(12~13시 구간 포함 시 활성)</span>
              )}
            </span>
          </label>

          {/* 계산 결과 — 8H 초과 시 빨간색으로 강조 */}
          <div className="text-[12px] text-text-primary font-medium">
            → 휴가 시간: <span className={
              minutes > 480 ? 'text-danger-text font-semibold'
              : leaveType === 'full_day' ? 'text-info-text'
              : ''
            }>{formatHoursAndMinutes(minutes)}</span>
          </div>

          {/* v1.83 — 8H 초과 알럿. 부모 폼은 validateLeaveTimeline 통해 submit 차단. */}
          {minutes > 480 && (
            <div className="flex items-start gap-1.5 text-[11px] text-danger-text bg-danger-bg border border-danger-border rounded-md px-2 py-1.5 leading-snug">
              <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <span><strong className="font-semibold">휴가 시간을 8H 이하로 설정해주세요.</strong> 하루 휴가는 최대 8시간까지 등록할 수 있습니다.</span>
            </div>
          )}

          {/* v1.83 — NPM 상신 별도 안내. 휴가 등록 펼침과 동시에 노출.
              명시 NPM 링크는 우하단 '휴가 등록' 버튼 클릭 흐름이 대신 처리 (VacationRegisterModal). */}
          <div className="flex items-start gap-1.5 text-[11px] text-warning-text bg-warning-bg border border-warning-border rounded-md px-2 py-1.5 leading-snug">
            <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span>{LEAVE_NPM_NOTICE}</span>
          </div>
        </div>
      )}

      {/* v1.59 — 8H 미만 휴가 안내 */}
      {showSubFullDayNotice && (
        <div className="flex items-start gap-1.5 text-[11px] text-info-text bg-info-bg border border-info-border rounded-md px-2 py-1.5 leading-snug">
          <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <span>{SUB_FULL_DAY_LEAVE_NOTICE}</span>
        </div>
      )}
    </div>
  )
}
