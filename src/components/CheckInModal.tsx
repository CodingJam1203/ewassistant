'use client'
import { dowKo } from '@/lib/utils/date'

import { useEffect, useState } from 'react'
import { X, Loader2, Calendar } from 'lucide-react'
import WorkLocationChipsInput from '@/components/WorkLocationChipsInput'
import LeaveTimelineInput from '@/components/LeaveTimelineInput'
import TimeSelect from '@/components/TimeSelect'
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

interface CheckInModalProps {
  /** 초기 날짜 (사용자가 모달 안에서 자유롭게 변경 가능) */
  date: string
  userName: string | null
  /** 출근 버튼에서 시각이 결정된 경우 출근시간 prefill */
  initialStartTime?: string
  onClose: () => void
  onSuccess: () => void
}

/** 일정 1줄 포매터 */
function formatEventLine(ev: CalendarEventChunk): string {
  if (ev.startTime && ev.endTime) {
    return `${ev.startTime}~${ev.endTime} ${ev.title}`
  }
  if (ev.startTime) {
    return `${ev.startTime}~ ${ev.title}`
  }
  return `(종일) ${ev.title}`
}

/** 'HH:mm' 분이 30분 단위인지 확인 후 그렇지 않으면 30분 단위로 보정해서 반환 */
function normalizeStartTimeTo30(input: string | undefined, fallback: string): string {
  if (!input) return fallback
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(input)
  if (!m) return fallback
  const hh = m[1]
  const mm = parseInt(m[2], 10)
  const flooredMm = mm < 30 ? '00' : '30'
  return `${hh}:${flooredMm}`
}

export default function CheckInModal({
  date: initialDate, userName, initialStartTime, onClose, onSuccess,
}: CheckInModalProps) {
  const [date, setDate] = useState<string>(initialDate)
  const [name, setName] = useState<string>(userName ?? '')
  // 시간 입력 — 출근시간 / 퇴근예정시간 (기본: 09:00 / 18:00, 30분 단위)
  const [startTime, setStartTime] = useState<string>(() =>
    normalizeStartTimeTo30(initialStartTime, '09:00')
  )
  const [endTime, setEndTime] = useState<string>('18:00')
  // 근무장소 chips (시간과 분리). 기본: [사무실]
  const [locations, setLocations] = useState<WorkLocations>(() => defaultWorkLocations())
  const [workContent, setWorkContent] = useState<string>('')
  const [leaveTimeline, setLeaveTimeline] = useState<LeaveTimeline>([])
  const [loadingPrefill, setLoadingPrefill] = useState(true)
  const [calendarLookup, setCalendarLookup] = useState<UserCalendarLookup | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState<string | null>(null)

  /** 어제 퇴근보고에서 작성한 다음 출근 예정 정보를 prefill */
  useEffect(() => {
    let cancelled = false
    const fetchPrefill = async () => {
      try {
        const res = await fetch(`/api/team-status/expected-timeline?date=${encodeURIComponent(date)}`)
        if (!res.ok) return
        const data = await res.json() as {
          // v2 우선
          plannedLocations?: WorkLocations | null
          expectedStartTime?: string | null
          expectedEndTime?: string | null
          // legacy fallback
          timeline?: WorkLocationTimeline | null
          leaveTimeline?: LeaveTimeline | null
        }
        if (cancelled) return

        // 1) v2 plannedLocations 우선
        const v2Locs = normalizeWorkLocations(data.plannedLocations)
        if (v2Locs && v2Locs.length > 0) {
          setLocations(v2Locs)
        } else if (data.timeline && data.timeline.length > 0) {
          // 2) legacy timeline → chips 변환
          const fromTimeline = legacyTimelineToLocations(data.timeline)
          if (fromTimeline && fromTimeline.length > 0) {
            setLocations(fromTimeline)
          }
        }

        // 시간 prefill — initialStartTime이 명시되면 그것 우선 (출근 버튼 시각),
        // 없으면 prefill의 expectedStartTime 또는 timeline 첫 항목 시각 사용
        if (!initialStartTime) {
          if (data.expectedStartTime) {
            setStartTime(data.expectedStartTime)
          } else if (data.timeline && data.timeline.length > 0) {
            const first = data.timeline.find(e => e.kind === 'work_location')
            if (first?.startTime) setStartTime(first.startTime)
          }
        }
        if (data.expectedEndTime) {
          setEndTime(data.expectedEndTime)
        } else if (data.timeline && data.timeline.length > 0) {
          const last = data.timeline[data.timeline.length - 1]
          if ((last?.kind === 'expected_checkout' || last?.kind === 'checkout') && last.startTime) {
            setEndTime(last.startTime)
          }
        }

        if (Array.isArray(data.leaveTimeline) && data.leaveTimeline.length > 0) {
          setLeaveTimeline(data.leaveTimeline)
        }
      } catch {
        // prefill 실패는 무시 (기본값 유지)
      } finally {
        if (!cancelled) setLoadingPrefill(false)
      }
    }
    fetchPrefill()
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date])

  /** 외부 캘린더 일정 조회 */
  useEffect(() => {
    let cancelled = false
    const fetchCalendar = async () => {
      try {
        const res = await fetch(`/api/team-status/calendar-events?date=${encodeURIComponent(date)}`)
        if (!res.ok) return
        const data = await res.json() as UserCalendarLookup
        if (cancelled) return
        setCalendarLookup(data)
        if (
          data.leaveType
          && (!leaveTimeline || leaveTimeline.length === 0)
        ) {
          setLeaveTimeline([
            buildLeaveItem(data.leaveType, data.leaveLabel ?? undefined, 'calendar'),
          ])
        }
      } catch {
        // 무시
      }
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
          // v2: chips + 시간 분리
          plannedWorkLocations: isAllDayLeave ? [] : locations,
          start_time: isAllDayLeave ? null : startTime,
          end_time:   isAllDayLeave ? null : endTime,
          leaveTimeline,
          break_time: '00:00',
          work_content: workContent.trim() || null,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? '출근보고 처리에 실패했습니다.')
      } else {
        onSuccess()
      }
    } catch {
      setError('네트워크 오류가 발생했습니다.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 overflow-y-auto py-6 px-4"
    >
      <div className="bg-surface rounded-[20px] shadow-[var(--shadow-popover)] w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div>
            <h3 className="text-base font-semibold text-text-primary">출근보고 작성하기</h3>
            <p className="text-[12px] text-text-secondary mt-0.5">{date} — 시간과 근무장소를 입력해주세요</p>
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
            <p className="mt-1 text-[12px] text-text-muted">기본값은 오늘이며, 다른 날짜로도 작성할 수 있습니다.</p>
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
                <p className="text-[12px] text-warning-text">캘린더 데이터를 불러오지 못했습니다 (이전 캐시도 없음).</p>
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
                  <label className="block text-[12px] font-semibold text-text-secondary mb-1.5">출근시간 *</label>
                  <HalfHourTimeSelect
                    value={startTime}
                    onChange={setStartTime}
                    ariaLabel="출근시간"
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
                <label className="block text-[12px] font-semibold text-text-secondary mb-1.5">근무장소 *</label>
                <p className="text-[12px] text-text-muted mb-2">
                  하루 중 들를 장소를 순서대로 추가하세요. 시간과는 무관합니다.
                </p>
                {loadingPrefill && (
                  <p className="text-[12px] text-text-muted mb-2">어제 퇴근보고의 다음 출근 예정 정보를 불러오는 중...</p>
                )}
                <WorkLocationChipsInput
                  value={locations}
                  onChange={setLocations}
                  errors={locErrors}
                />
              </div>
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
              저장
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
