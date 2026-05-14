'use client'
import { DateInputWithDow } from '@/components/ui'
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
  formatChipsArrow,
} from '@/lib/work-locations-v2'
import { buildLeaveItem, isFullDayLeave, validateLeaveTimeline } from '@/lib/leave-timeline'
import type { WorkLocationTimeline } from '@/types/work-location-timeline'
import type { LeaveTimeline } from '@/types/leave-timeline'
import type { UserCalendarLookup, CalendarEventChunk } from '@/types/leave-calendar'

/**
 * CheckInModal — 3가지 케이스 자동 분기:
 *
 *   A. 'none'  : 미제출 미보고 (D-day row 없음 + 사전 보고 없음)
 *      → 출근예정시간 = "미보고" 표시, 받지 않음
 *      → 실제 출근시간 + 퇴근예정시간 + 근무지만 입력
 *
 *   B. 'prior' : 사전 보고만 있음 (전일 퇴근보고에서 다음날 출근예정 작성)
 *      → 사전 등록된 출근예정/퇴근예정/근무지를 안내 (readonly 카드)
 *      → 실제 출근시간만 입력
 *      → "퇴근예정 수정" 토글 → 체크 시 퇴근예정 input 활성
 *
 *   C. 'today' : D-day 본문 row 있음 (이미 출근보고 작성됨)
 *      → 모든 필드 prefill + 활성 (수정 모드)
 */

interface CheckInModalProps {
  date: string
  userName: string | null
  initialStartTime?: string
  /** props.mode는 호환용. 케이스는 서버 응답으로 자동 판별. */
  mode?: 'create' | 'edit' | 'complete'
  onClose: () => void
  onSuccess: () => void
}

type CaseMode = 'none' | 'prior' | 'today' | 'future'

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
  date: initialDate, userName, initialStartTime, onClose, onSuccess,
}: CheckInModalProps) {
  const [date, setDate] = useState<string>(initialDate)
  const [name, setName] = useState<string>(userName ?? '')
  const [startTime, setStartTime] = useState<string>(() =>
    normalizeStartTimeTo30(initialStartTime, '09:00')
  )
  const [endTime, setEndTime] = useState<string>('18:00')
  const [actualCheckInTime, setActualCheckInTime] = useState<string>('')
  const [locations, setLocations] = useState<WorkLocations>(() => defaultWorkLocations())
  const [workContent, setWorkContent] = useState<string>('')
  const [leaveTimeline, setLeaveTimeline] = useState<LeaveTimeline>([])
  const [loadingPrefill, setLoadingPrefill] = useState(true)
  const [calendarLookup, setCalendarLookup] = useState<UserCalendarLookup | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState<string | null>(null)

  // 케이스 분기
  const [caseMode, setCaseMode] = useState<CaseMode>('none')
  // 케이스 B에서 "퇴근예정 수정" 토글
  const [editEndTimeInPrior, setEditEndTimeInPrior] = useState(false)

  /** prefill — 케이스 자동 판별 */
  useEffect(() => {
    let cancelled = false
    const fetchPrefill = async () => {
      try {
        const res = await fetch(`/api/team-status/expected-timeline?date=${encodeURIComponent(date)}`,
          { cache: 'no-store' })
        if (!res.ok) return
        const data = await res.json() as {
          plannedLocations?: WorkLocations | null
          expectedStartTime?: string | null
          expectedEndTime?: string | null
          timeline?: WorkLocationTimeline | null
          leaveTimeline?: LeaveTimeline | null
          hasExisting?: boolean
          checkedInAt?: string | null
        }
        if (cancelled) return

        // 케이스 판별
        // todayKst 비교용 — KST yyyy-mm-dd
        const todayKstStr = (() => {
          const fmt = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
          })
          return fmt.format(new Date())
        })()
        const isFutureDate = date > todayKstStr

        let mode: CaseMode = 'none'
        if (data.hasExisting) {
          mode = 'today'
        } else if (
          (Array.isArray(data.plannedLocations) && data.plannedLocations.length > 0)
          || data.expectedStartTime
          || (Array.isArray(data.timeline) && data.timeline.length > 0)
        ) {
          mode = 'prior'
        }
        // 미래 일자는 무조건 'future' 모드로 — 실제 출근시간 입력 무의미.
        // 사전 prefill이 있어도 모든 planned 필드 editable로 보여줌.
        if (isFutureDate) {
          mode = 'future'
        }
        setCaseMode(mode)

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

        // actualCheckInTime — 케이스별 prefill
        if (mode === 'today') {
          // today 모드 — 기존 daily.checked_in_at 값
          if (data.checkedInAt) setActualCheckInTime(data.checkedInAt)
        } else if (mode === 'future') {
          // future 모드 — 실제 출근시간 입력 안 받음. 빈 값으로 둠.
          setActualCheckInTime('')
        } else {
          // none/prior — 자동 prefill: 현재 시각 floor (사용자가 그대로 제출 = 출근 완료)
          setActualCheckInTime(nowKstHHmmFloor())
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
        // functional update — work_logs prefill effect와 race 안전.
        // 이미 leaveTimeline이 set 되어 있으면(work_logs 또는 사용자 입력) 유지.
        if (data.leaveType) {
          setLeaveTimeline(prev => {
            if (Array.isArray(prev) && prev.length > 0) return prev
            return [buildLeaveItem(data.leaveType!, data.leaveLabel ?? undefined, 'calendar')]
          })
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

  const isHalfHour = (t: string) => /^(\d{1,2}):(00|30)$/.test(t)
  const timeErrors: string[] = []
  if (!isAllDayLeave) {
    // case A: startTime은 받지 않으니 검증도 안 함
    if (caseMode !== 'none') {
      if (!startTime || !isHalfHour(startTime)) timeErrors.push('출근예정시간을 30분 단위로 선택해주세요.')
    }
    if (!endTime || !isHalfHour(endTime)) timeErrors.push('퇴근예정시간을 30분 단위로 선택해주세요.')
    if (caseMode !== 'future' && (!actualCheckInTime || !isHalfHour(actualCheckInTime))) {
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
      // 안전망 — caseMode='none' (미보고 첫 작성) + 당일 날짜라면, prefill 누락/race로
      // actualCheckInTime이 비어있어도 NOW로 채워 보냄. 그래야 서버가 checked_in_at을
      // 세팅하고 상태가 A → C로 바로 진행 (B 상태 노출 방지).
      const todayKstStr = (() => {
        const fmt = new Intl.DateTimeFormat('en-CA', {
          timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
        })
        return fmt.format(new Date())
      })()
      const isTodaySubmission = date === todayKstStr
      const safeActualCheckIn =
        caseMode === 'future'
          ? ''  // 미래 일자 — 실제 출근시간 안 보냄, 서버가 팀 설정에 따라 처리
          : actualCheckInTime ||
            (caseMode === 'none' && isTodaySubmission && !isAllDayLeave
              ? nowKstHHmmFloor() : '')

      // case A: start_time = actualCheckInTime으로 자동 채움 (출근예정=실제출근 같은 의미)
      const submitStartTime = caseMode === 'none'
        ? (safeActualCheckIn || '09:00')
        : (isAllDayLeave ? null : startTime)

      const res = await fetch('/api/team-status/check-in', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date,
          name: name.trim(),
          plannedWorkLocations: isAllDayLeave ? [] : locations,
          start_time: submitStartTime,
          end_time:   isAllDayLeave ? null : endTime,
          actualCheckInTime: safeActualCheckIn || null,
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

  // 헤더 제목 — 케이스별
  const headerTitle =
    caseMode === 'today'  ? '출근보고 수정'
    : caseMode === 'prior' ? '출근 완료'
    : caseMode === 'future' ? '사전 출근보고'
    : '출근보고 작성'
  const dateWithDow = (() => {
    const dow = dowKo(date)
    return dow ? `${date} (${dow})` : date
  })()
  const headerSubtitle =
    caseMode === 'today'  ? `${dateWithDow} — 모든 항목 자유롭게 수정`
    : caseMode === 'prior' ? `${dateWithDow} — 사전 등록된 정보 + 실제 출근시간 입력`
    : caseMode === 'future' ? `${dateWithDow} — 이 날의 출근 예정 정보를 미리 등록합니다`
    : `${dateWithDow} — 시간과 근무장소를 입력해주세요`

  const submitLabel =
    caseMode === 'today'  ? '수정 저장'
    : caseMode === 'prior' ? '출근 완료'
    : caseMode === 'future' ? '사전 출근보고 등록'
    : '출근보고 작성'

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
            <label className="block text-[12px] font-semibold text-text-secondary mb-1.5">
              {caseMode === 'future' ? '출근 예정 날짜' : '날짜'} *
            </label>
            <DateInputWithDow
              value={date}
              onChange={v => setDate(v || initialDate)}
              className="w-full sm:w-1/2"
            />
          </div>

          {/* 이름은 userName prop으로 자동 세팅 — UI 노출 X (수정 불가) */}

          {/* 캘린더 안내 */}
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
                      <span className="ml-1 text-text-muted">— 아래 휴가에 자동 반영됨</span>
                    </li>
                  )}
                  {calendarLookup.events.map((ev, i) => (
                    <li key={i}>{formatEventLine(ev)}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* ─── 케이스별 분기 ─── */}
          {!isAllDayLeave && (
            <>
              {/* 케이스 B (prior): 사전 등록 정보 안내 카드 + 실제 출근만 + 퇴근예정 수정 토글 */}
              {caseMode === 'prior' && (
                <>
                  <div className="rounded-[10px] border border-info-border bg-info-bg px-3 py-2.5 space-y-1">
                    <p className="text-[11px] font-semibold text-info-text mb-1">사전 등록된 출근보고</p>
                    <div className="grid grid-cols-2 gap-x-2 text-[12px] text-text-primary">
                      <div>
                        <span className="text-text-muted">출근예정 </span>
                        <span className="font-semibold tabular-nums">{startTime}</span>
                      </div>
                      <div>
                        <span className="text-text-muted">퇴근예정 </span>
                        <span className="font-semibold tabular-nums">{endTime}</span>
                      </div>
                      <div className="col-span-2">
                        <span className="text-text-muted">근무지 </span>
                        <span className="font-semibold">{formatChipsArrow(locations)}</span>
                      </div>
                    </div>
                    <p className="text-[11px] text-text-muted pt-1">
                      ※ 출근예정/근무지 변경은 <span className="font-semibold">제출 내역</span>에서 수정해주세요.
                    </p>
                  </div>

                  <div>
                    <label className="block text-[12px] font-semibold text-text-secondary mb-1.5">실제 출근시간 *</label>
                    <HalfHourTimeSelect
                      value={actualCheckInTime}
                      onChange={setActualCheckInTime}
                      allowNextDay
                      ariaLabel="실제 출근시간"
                    />
                  </div>

                  {/* 퇴근예정 수정 토글 */}
                  <div className="rounded-[10px] border border-border bg-surface-muted px-3 py-2">
                    <label className="inline-flex items-center gap-2 cursor-pointer text-[12px]">
                      <input
                        type="checkbox"
                        checked={editEndTimeInPrior}
                        onChange={e => setEditEndTimeInPrior(e.target.checked)}
                        className="h-4 w-4 rounded border-border-strong text-primary-600 focus:ring-primary-500"
                      />
                      <span className="text-text-primary font-medium">퇴근예정시간을 변경할까요?</span>
                    </label>
                    {editEndTimeInPrior && (
                      <div className="mt-2">
                        <HalfHourTimeSelect
                          value={endTime}
                          onChange={setEndTime}
                          allowNextDay
                          ariaLabel="퇴근예정시간"
                        />
                      </div>
                    )}
                  </div>
                </>
              )}

              {/* 케이스 A (none): 출근예정시간 = 미보고 표시. 실제출근 + 퇴근예정 + 근무지 */}
              {caseMode === 'none' && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[12px] font-semibold text-text-secondary mb-1.5">출근예정시간</label>
                      <div className="h-10 rounded-[10px] border border-border bg-surface-muted px-3 flex items-center text-sm text-text-muted">
                        미보고
                      </div>
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
                    <label className="block text-[12px] font-semibold text-text-secondary mb-1.5">실제 출근시간 *</label>
                    <HalfHourTimeSelect
                      value={actualCheckInTime}
                      onChange={setActualCheckInTime}
                      allowNextDay
                      ariaLabel="실제 출근시간"
                    />
                  </div>

                  <div>
                    <label className="block text-[12px] font-semibold text-text-secondary mb-1.5">근무장소 (예정) *</label>
                    <p className="text-[12px] text-text-muted mb-2">
                      하루 중 들를 장소를 순서대로 추가하세요.
                    </p>
                    <WorkLocationChipsInput
                      value={locations}
                      onChange={setLocations}
                      errors={locErrors}
                    />
                  </div>
                </>
              )}

              {/* 케이스 today: 모든 필드 활성 (수정 모드) */}
              {caseMode === 'today' && (
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
                    <WorkLocationChipsInput
                      value={locations}
                      onChange={setLocations}
                      errors={locErrors}
                    />
                  </div>

                  <div>
                    <label className="block text-[12px] font-semibold text-text-secondary mb-1.5">
                      실제 출근시간
                      <span className="ml-1 text-[11px] font-normal text-text-muted">(비우면 출근 안 한 상태)</span>
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
                </>
              )}

              {/* 케이스 future: 미래 일자 — 모든 planned 필드 editable, 실제출근 없음 */}
              {caseMode === 'future' && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[12px] font-semibold text-text-secondary mb-1.5">출근예정시간 *</label>
                      <HalfHourTimeSelect
                        value={startTime}
                        onChange={setStartTime}
                        allowNextDay
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
                      하루 중 들를 장소를 순서대로 추가하세요.
                    </p>
                    <WorkLocationChipsInput
                      value={locations}
                      onChange={setLocations}
                      errors={locErrors}
                    />
                  </div>
                </>
              )}
            </>
          )}

          {/* 휴가 — 메모 직전 위치 (위계 정리: 시간/장소 영역 뒤) */}
          <div>
            <label className="block text-[12px] font-semibold text-text-secondary mb-1.5">
              {caseMode === 'future' ? '다음 출근일 휴가여부' : '휴가'}
            </label>
            <LeaveTimelineInput value={leaveTimeline} onChange={setLeaveTimeline} />
          </div>

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
              disabled={saving || (loadingPrefill && false) || validationErrors.length > 0}
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
