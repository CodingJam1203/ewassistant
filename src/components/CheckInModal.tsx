'use client'
import { dowKo } from '@/lib/utils/date'

import { useEffect, useState } from 'react'
import { X, Loader2, Calendar } from 'lucide-react'
import WorkLocationChipsInput from '@/components/WorkLocationChipsInput'
import LeaveTimelineInput from '@/components/LeaveTimelineInput'
import HalfHourTimeSelect from '@/components/HalfHourTimeSelect'
import {
  defaultWorkLocations,
  type WorkLocations,
} from '@/types/work-locations-v2'
import {
  validateWorkLocations,
  legacyTimelineToLocations,
  normalizeWorkLocations,
} from '@/lib/work-locations-v2'
import { buildLeaveItem, isFullDayLeave, validateLeaveTimeline } from '@/lib/leave-timeline'
import type { WorkLocationTimeline } from '@/types/work-location-timeline'
import type { LeaveTimeline } from '@/types/leave-timeline'
import type { UserCalendarLookup, CalendarEventChunk } from '@/types/leave-calendar'

/**
 * CheckInModal — 출근보고 작성/수정/출근완료 통합.
 *
 * 모드 (props.mode):
 *   - 'create'   : 신규 출근보고 (D-day row 없음)
 *   - 'edit'     : 출근보고 수정 (B/C/D/E 상태)
 *   - 'complete' : 출근 완료 (B 상태에서 실제 출근 확정)
 *
 * 모드별 차이:
 *   - 헤더 제목
 *   - actualCheckInTime prefill: complete 시 현재 시각 floor
 *
 * 폼 필드 (모든 모드 공통, 모두 활성):
 *   - 출근예정시간 / 퇴근예정시간 / 근무지예정 / 휴가
 *   - 실제 출근시간 (비어있을 수도 있음 — 비우면 출근 안 한 상태로 되돌림)
 */

interface CheckInModalProps {
  date: string
  userName: string | null
  initialStartTime?: string
  /** 모드 — 호출자가 명시 */
  mode?: 'create' | 'edit' | 'complete'
  onClose: () => void
  onSuccess: () => void
}

function formatEventLine(ev: CalendarEventChunk): string {
  if (ev.startTime && ev.endTime) return `${ev.startTime}~${ev.endTime} ${ev.title}`
  if (ev.startTime) return `${ev.startTime}~ ${ev.title}`
  return `(종일) ${ev.title}`
}

function normalizeStartTimeTo30(input: string | undefined, fallback: string): string {
  if (!input) return fallback
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(input)
  if (!m) return fallback
  const hh = m[1]
  const mm = parseInt(m[2], 10)
  const flooredMm = mm < 30 ? '00' : '30'
  return `${hh}:${flooredMm}`
}

/** 현재 KST 시각을 30분 단위 floor로 'HH:mm' 반환 */
function nowKstHHmmFloor(): string {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul',
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  })
  const parts = fmt.formatToParts(new Date())
  const h = parseInt(parts.find(p => p.type === 'hour')?.value ?? '0', 10) % 24
  const m = parseInt(parts.find(p => p.type === 'minute')?.value ?? '0', 10)
  const flooredM = m < 30 ? 0 : 30
  return `${String(h).padStart(2, '0')}:${String(flooredM).padStart(2, '0')}`
}

export default function CheckInModal({
  date: initialDate, userName, initialStartTime, mode, onClose, onSuccess,
}: CheckInModalProps) {
  const [date, setDate] = useState<string>(initialDate)
  const [name, setName] = useState<string>(userName ?? '')
  // 시간 입력
  const [startTime, setStartTime] = useState<string>(() =>
    normalizeStartTimeTo30(initialStartTime, '09:00')
  )
  const [endTime, setEndTime] = useState<string>('18:00')
  // 실제 출근시간 — 비어있을 수 있음 (비우면 출근 안 함)
  const [actualCheckInTime, setActualCheckInTime] = useState<string>('')
  const [locations, setLocations] = useState<WorkLocations>(() => defaultWorkLocations())
  const [workContent, setWorkContent] = useState<string>('')
  const [leaveTimeline, setLeaveTimeline] = useState<LeaveTimeline>([])
  const [loadingPrefill, setLoadingPrefill] = useState(true)
  const [calendarLookup, setCalendarLookup] = useState<UserCalendarLookup | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState<string | null>(null)
  // 서버에서 받은 hasExisting (모드 자동 판별 fallback)
  const [hasExisting, setHasExisting] = useState(false)

  // 효과적 모드 — props.mode 우선, 없으면 hasExisting으로 자동 판별
  const effectiveMode: 'create' | 'edit' | 'complete' =
    mode ?? (hasExisting ? 'edit' : 'create')

  /** prefill */
  useEffect(() => {
    let cancelled = false
    const fetchPrefill = async () => {
      try {
        const res = await fetch(`/api/team-status/expected-timeline?date=${encodeURIComponent(date)}`)
        if (!res.ok) return
        const data = await res.json() as {
          plannedLocations?: WorkLocations | null
          expectedStartTime?: string | null
          expectedEndTime?: string | null
          timeline?: WorkLocationTimeline | null
          leaveTimeline?: LeaveTimeline | null
          hasExisting?: boolean
          checkedInAt?: string | null  // 서버에서 'HH:mm' 또는 null
        }
        if (cancelled) return
        if (data.hasExisting) setHasExisting(true)

        // chips
        const v2Locs = normalizeWorkLocations(data.plannedLocations)
        if (v2Locs && v2Locs.length > 0) setLocations(v2Locs)
        else if (data.timeline && data.timeline.length > 0) {
          const fromTl = legacyTimelineToLocations(data.timeline)
          if (fromTl && fromTl.length > 0) setLocations(fromTl)
        }

        // 시간 prefill
        if (!initialStartTime) {
          if (data.expectedStartTime) setStartTime(data.expectedStartTime)
          else if (data.timeline && data.timeline.length > 0) {
            const first = data.timeline.find(e => e.kind === 'work_location')
            if (first?.startTime) setStartTime(first.startTime)
          }
        }
        if (data.expectedEndTime) setEndTime(data.expectedEndTime)
        else if (data.timeline && data.timeline.length > 0) {
          const last = data.timeline[data.timeline.length - 1]
          if ((last?.kind === 'expected_checkout' || last?.kind === 'checkout') && last.startTime) {
            setEndTime(last.startTime)
          }
        }

        // actualCheckInTime prefill — 모드별 분기
        const explicitMode = mode
        if (explicitMode === 'complete' || explicitMode === 'create') {
          // 출근 완료 모드 또는 신규 작성 모드 — 현재 시각 floor 자동 prefill
          // (사용자가 [출근보고 작성]만 눌러도 출근 완료까지 한 번에 처리되도록)
          setActualCheckInTime(nowKstHHmmFloor())
        } else {
          // edit — 서버에서 받은 daily.checked_in_at 값
          if (data.checkedInAt) setActualCheckInTime(data.checkedInAt)
        }

        // 휴가
        if (Array.isArray(data.leaveTimeline) && data.leaveTimeline.length > 0) {
          setLeaveTimeline(data.leaveTimeline)
        }
      } catch {
        // 무시
      } finally {
        if (!cancelled) setLoadingPrefill(false)
      }
    }
    fetchPrefill()
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date])

  /** 외부 캘린더 일정 */
  useEffect(() => {
    let cancelled = false
    const fetchCalendar = async () => {
      try {
        const res = await fetch(`/api/team-status/calendar-events?date=${encodeURIComponent(date)}`)
        if (!res.ok) return
        const data = await res.json() as UserCalendarLookup
        if (cancelled) return
        setCalendarLookup(data)
        if (data.leaveType && (!leaveTimeline || leaveTimeline.length === 0)) {
          setLeaveTimeline([
            buildLeaveItem(data.leaveType, data.leaveLabel ?? undefined, 'calendar'),
          ])
        }
      } catch { /* 무시 */ }
    }
    fetchCalendar()
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date])

  const isAllDayLeave = isFullDayLeave(leaveTimeline)
  const locErrors = isAllDayLeave ? [] : validateWorkLocations(locations)
  const leaveErrors = validateLeaveTimeline(leaveTimeline)

  const isHalfHour = (t: string) => /^([01]\d|2[0-3]):(00|30)$/.test(t)
  const timeErrors: string[] = []
  if (!isAllDayLeave) {
    if (!startTime || !isHalfHour(startTime)) timeErrors.push('출근시간을 30분 단위로 선택해주세요.')
    if (!endTime || !/^(\d{1,2}):(00|30)$/.test(endTime)) timeErrors.push('퇴근예정시간을 30분 단위로 선택해주세요.')
    // actualCheckInTime은 비어있을 수 있음 (출근 안 한 상태). 채워져 있으면 30분 단위 검증
    if (actualCheckInTime && !isHalfHour(actualCheckInTime)) {
      timeErrors.push('실제 출근시간을 30분 단위로 선택해주세요.')
    }
  }
  const validationErrors = [...locErrors.map(e => e.message), ...leaveErrors.map(e => e.message), ...timeErrors]

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!name.trim()) return setError('이름을 입력해주세요.')
    if (validationErrors.length > 0) {
      return setError(validationErrors[0])
    }

    setSaving(true)
    try {
      const res = await fetch('/api/team-status/check-in', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date,
          name: name.trim(),
          plannedWorkLocations: isAllDayLeave ? [] : locations,
          start_time: isAllDayLeave ? null : startTime,
          end_time:   isAllDayLeave ? null : endTime,
          // 실제 출근시간 — 비어있으면 NULL (출근 안 함 또는 취소)
          actualCheckInTime: actualCheckInTime || null,
          leaveTimeline,
          break_time: '00:00',
          work_content: workContent.trim() || null,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? '처리에 실패했습니다.')
      } else {
        onSuccess()
      }
    } catch {
      setError('네트워크 오류가 발생했습니다.')
    } finally {
      setSaving(false)
    }
  }

  // 헤더 제목 — 모드별
  const headerTitle =
    effectiveMode === 'create'   ? '출근보고 작성하기'
    : effectiveMode === 'complete' ? '출근 완료'
    : '출근보고 수정하기'
  const headerSubtitle =
    effectiveMode === 'create'   ? `${date} — 시간과 근무장소를 입력해주세요`
    : effectiveMode === 'complete' ? `${date} — 실제 출근 시각/장소를 확정해주세요`
    : `${date} — 모든 항목 자유롭게 수정 가능`

  // 제출 버튼 라벨
  const submitLabel =
    effectiveMode === 'create'   ? '출근보고 작성'
    : effectiveMode === 'complete' ? '출근 완료'
    : '수정 저장'

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 overflow-y-auto py-6 px-4">
      <div className="bg-surface rounded-[20px] shadow-[var(--shadow-popover)] w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div>
            <h3 className="text-base font-semibold text-text-primary">{headerTitle}</h3>
            <p className="text-[12px] text-text-secondary mt-0.5">{headerSubtitle}</p>
          </div>
          <button
            onClick={onClose}
            className="inline-flex items-center justify-center h-9 w-9 rounded-[10px] text-text-muted hover:text-text-primary hover:bg-surface-muted transition-colors"
            aria-label="닫기"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          {/* 날짜 */}
          <div>
            <label className="block text-[12px] font-semibold text-text-secondary mb-1.5">날짜 *</label>
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={date}
                onChange={e => setDate(e.target.value || initialDate)}
                className="w-full sm:w-1/2 h-10 rounded-[10px] border border-border-strong bg-surface text-sm px-3 focus:outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20"
              />
              {date && (
                <span className="text-sm text-text-muted whitespace-nowrap">({dowKo(date)})</span>
              )}
            </div>
          </div>

          {/* 이름 */}
          <div>
            <label className="block text-[12px] font-semibold text-text-secondary mb-1.5">이름 *</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full h-10 rounded-[10px] border border-border-strong bg-surface text-sm px-3 focus:outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20"
            />
          </div>

          {/* 외부 캘린더 안내 */}
          {calendarLookup?.enabled && (calendarLookup.leaveType || calendarLookup.events.length > 0 || calendarLookup.fetchFailed) && (
            <div className="rounded-[10px] border border-info-border bg-info-bg px-3 py-2">
              <div className="flex items-center gap-1.5 mb-1">
                <Calendar className="h-3.5 w-3.5 text-info-text" aria-hidden />
                <span className="text-[12px] font-semibold text-info-text">캘린더 일정 ({date})</span>
              </div>
              {calendarLookup.fetchFailed ? (
                <p className="text-[12px] text-warning-text">캘린더 데이터를 불러오지 못했습니다.</p>
              ) : (
                <ul className="text-[12px] text-text-primary space-y-0.5">
                  {calendarLookup.leaveType && (
                    <li>
                      <span className="font-semibold text-warning-text">{calendarLookup.leaveLabel}</span>
                      <span className="ml-1 text-text-muted">— 아래 휴가/반차에 자동 반영됨</span>
                    </li>
                  )}
                  {calendarLookup.events.map((ev, i) => (
                    <li key={i}>{formatEventLine(ev)}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* 휴가/반차 */}
          <div>
            <label className="block text-[12px] font-semibold text-text-secondary mb-1.5">휴가/반차</label>
            <LeaveTimelineInput value={leaveTimeline} onChange={setLeaveTimeline} />
          </div>

          {/* 시간 + 근무장소 — 종일 휴가 아닐 때만 */}
          {!isAllDayLeave && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[12px] font-semibold text-text-secondary mb-1.5">출근예정시간 *</label>
                  <HalfHourTimeSelect
                    value={startTime}
                    onChange={setStartTime}
                    ariaLabel="출근예정시간"
                  />
                </div>
                <div>
                  <label className="block text-[12px] font-semibold text-text-secondary mb-1.5">퇴근예정시간 *</label>
                  <HalfHourTimeSelect
                    value={endTime}
                    onChange={setEndTime}
                    allowNextDay
                    ariaLabel="퇴근예정시간"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[12px] font-semibold text-text-secondary mb-1.5">근무장소 (예정) *</label>
                <p className="text-[12px] text-text-muted mb-2">
                  하루 중 들를 장소를 순서대로 추가하세요. 시간과는 무관합니다.
                </p>
                {loadingPrefill && (
                  <p className="text-[12px] text-text-muted mb-2">정보를 불러오는 중...</p>
                )}
                <WorkLocationChipsInput
                  value={locations}
                  onChange={setLocations}
                  errors={locErrors}
                />
              </div>

              {/* 실제 출근시간 — 모든 모드에서 노출 (create는 자동 prefill, 비우면 출근보고만 작성) */}
              {(effectiveMode === 'create' || effectiveMode === 'edit' || effectiveMode === 'complete') && (
                <div>
                  <label className="block text-[12px] font-semibold text-text-secondary mb-1.5">
                    실제 출근시간
                    <span className="ml-1 text-[11px] font-normal text-text-muted">
                      (비우면 출근 안 한 상태로 되돌림)
                    </span>
                  </label>
                  <div className="flex items-center gap-2">
                    <div className="flex-1">
                      <HalfHourTimeSelect
                        value={actualCheckInTime}
                        onChange={setActualCheckInTime}
                        allowNextDay
                        ariaLabel="실제 출근시간"
                        placeholder="출근 안 함"
                      />
                    </div>
                    {actualCheckInTime && (
                      <button
                        type="button"
                        onClick={() => setActualCheckInTime('')}
                        className="shrink-0 inline-flex items-center justify-center h-10 w-10 rounded-[10px] border border-border-strong bg-surface text-text-muted hover:text-danger-text hover:bg-danger-bg transition-colors"
                        aria-label="실제 출근시간 비우기"
                        title="출근 안 함으로 되돌리기"
                      >
                        <X className="h-4 w-4" aria-hidden />
                      </button>
                    )}
                  </div>
                </div>
              )}
            </>
          )}

          {/* 메모 */}
          <div>
            <label className="block text-[12px] font-semibold text-text-secondary mb-1.5">메모</label>
            <textarea
              value={workContent}
              onChange={e => setWorkContent(e.target.value)}
              rows={2}
              placeholder="비고"
              className="w-full rounded-[10px] border border-border-strong bg-surface text-sm px-3 py-2 focus:outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 resize-none"
            />
          </div>

          {error && (
            <p className="text-sm text-danger-text bg-danger-bg border border-danger-border rounded-[10px] px-3 py-2">{error}</p>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center justify-center h-10 px-4 rounded-[10px] text-sm font-medium text-text-primary bg-surface border border-border-strong hover:bg-surface-muted transition-colors"
            >
              취소
            </button>
            <button
              type="submit"
              disabled={saving || validationErrors.length > 0}
              className="inline-flex items-center gap-1.5 h-10 px-4 rounded-[10px] text-sm font-semibold text-white bg-primary-600 hover:bg-primary-700 disabled:opacity-50 transition-colors"
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              {submitLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
