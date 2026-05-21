'use client'
import { DateInputWithDow } from '@/components/ui'
import { dowKo } from '@/lib/utils/date'

import { useEffect, useState, useRef } from 'react'
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
import { useRegisterModalOpen } from '@/contexts/ModalOpenContext'

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
  /**
   * 사용자 팀의 출근완료 단계 사용 여부 (org_teams.use_check_in_complete).
   * 미보고 첫출근(caseMode='none') 모달에서 출근예정 영역 숨김 판단에 사용 (v1.36).
   * 미지정 시 true(출근완료 사용)로 간주.
   */
  useCheckInComplete?: boolean
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

/**
 * 현재 KST 시각을 HH:mm으로, 30분 단위 올림(ceil).
 * 예: 09:11 → 09:30, 09:00 → 09:00, 09:31 → 10:00. (정책서 §12 D1 / v1.35)
 * 신규 출근보고 실제출근 prefill 전용 — 출근 직후 보고 시 "이미 지난 시각"이 아니라
 * "다가오는 정각/반"으로 채워지도록 floor → ceil 변경.
 */
function nowKstHHmmCeil(): string {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul',
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  })
  const parts = fmt.formatToParts(new Date())
  const h = parseInt(parts.find(p => p.type === 'hour')?.value ?? '0', 10) % 24
  const m = parseInt(parts.find(p => p.type === 'minute')?.value ?? '0', 10)
  const ceiledTotal = Math.ceil((h * 60 + m) / 30) * 30
  const hh = Math.floor(ceiledTotal / 60) % 24
  const mm = ceiledTotal % 60
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}

export default function CheckInModal({
  date: initialDate, userName, initialStartTime, useCheckInComplete = true, onClose, onSuccess,
}: CheckInModalProps) {
  // Stage 4: 글로벌 모달 카운터에 등록 — 열려있는 동안 autoRefetch polling 일시 정지
  useRegisterModalOpen()
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
  // Phase 1.5d (CheckInModal 확장 — 2026-05-21):
  //   종일 휴가 prefill + 근무 의도 신호 동시 입력 시 confirm 모달.
  //   확인 시 leaveTimeline=[]로 비우고 isAllDayLeave=false로 재제출
  //   (서버는 Phase 1.5b sync로 Google 휴가 자동 삭제).
  const [stripLeaveConfirmOpen, setStripLeaveConfirmOpen] = useState(false)
  const userConfirmedStripLeaveRef = useRef(false)
  // Phase 1.5d (2026-05-21 fix): 사용자가 LeaveTimelineInput을 직접 건드렸는지 추적.
  // true = 사용자가 휴가 추가/수정/삭제 명시 액션 → 휴가 의도 분명하므로 confirm 가드 skip.
  // false = prefill 상태 그대로 (Google 매핑 포함) → confirm 발동 의미 있음.
  // (QA 4/14 보고: 휴가 없던 빈 날에 사용자가 8h 휴가 신규 등록할 때 confirm 뜨던 false positive fix)
  const leaveTimelineUserTouchedRef = useRef(false)
  // 추가 안전망 (2026-05-21 fix #2): baseline = prefill 응답 시점의 leaveTimeline.
  // baseline에 full_day가 없으면 → 빈 날에 사용자가 휴가 신규 등록하는 케이스 → 가드 절대 발동 X.
  // useState로 시작하므로 prefill effect 끝에서 set (사용자 액션은 user-touched ref가 별도 추적).
  const baselineLeaveTimelineRef = useRef<LeaveTimeline>([])

  // 케이스 분기
  const [caseMode, setCaseMode] = useState<CaseMode>('none')
  // 케이스 A: 출근예정시간 "미보고" 잠금 상태 (true=미보고, false=수정 모드)
  // submit 시 true면 planned_start_time = NULL로 저장 (미보고 유지)
  const [plannedStartUnreported, setPlannedStartUnreported] = useState(true)

  // 첫 fetch flag — initialStartTime prop 보호용 (날짜 변경 시 prefill 재적용에서 첫 진입과 구분)
  const isFirstFetchRef = useRef(true)

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
          workContent?: string | null
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

        // ── 날짜 변경 시 form prefill 재적용 정책 (2026-05-19 v1.8) ──
        // 응답에 데이터 있으면 그 값, 없으면 default로 reset.
        // 이전 날짜의 form 값이 새 날짜로 끌려가지 않도록 항상 setX 호출.
        // 단 첫 진입 시 initialStartTime prop이 있으면 그 값 우선 (useRef 가드).
        const isFirstRun = isFirstFetchRef.current

        // chips — 응답 우선, 없으면 default reset
        const v2Locs = normalizeWorkLocations(data.plannedLocations)
        if (v2Locs && v2Locs.length > 0) {
          setLocations(v2Locs)
        } else if (data.timeline && data.timeline.length > 0) {
          const fromTl = legacyTimelineToLocations(data.timeline)
          setLocations(fromTl && fromTl.length > 0 ? fromTl : defaultWorkLocations())
        } else {
          setLocations(defaultWorkLocations())
        }

        // 시간 prefill — 첫 진입 시 initialStartTime 보호, 그 외엔 항상 응답 or default
        if (!isFirstRun || !initialStartTime) {
          if (data.expectedStartTime) {
            setStartTime(data.expectedStartTime)
          } else if (data.timeline && data.timeline.length > 0) {
            const first = data.timeline.find(e => e.kind === 'work_location')
            setStartTime(first?.startTime ?? '09:00')
          } else {
            setStartTime('09:00')
          }
        }
        if (data.expectedEndTime) {
          setEndTime(data.expectedEndTime)
        } else if (data.timeline && data.timeline.length > 0) {
          const last = data.timeline[data.timeline.length - 1]
          if ((last?.kind === 'expected_checkout' || last?.kind === 'checkout') && last.startTime) {
            setEndTime(last.startTime)
          } else {
            setEndTime('18:00')
          }
        } else {
          setEndTime('18:00')
        }

        // actualCheckInTime — 케이스별 prefill
        if (mode === 'today') {
          // today 모드 — 기존 daily.checked_in_at 값. 없으면 현재 시각 floor로 prefill
          // (출근완료 안 한 상태에서 수정 모달 진입 → 그대로 제출 시 출근완료 처리).
          setActualCheckInTime(data.checkedInAt || nowKstHHmmCeil())
        } else if (mode === 'future') {
          // future 모드 — 실제 출근시간 입력 안 받음. 빈 값으로 둠.
          setActualCheckInTime('')
        } else {
          // none/prior — 자동 prefill: 현재 시각 floor (사용자가 그대로 제출 = 출근 완료)
          setActualCheckInTime(nowKstHHmmCeil())
        }

        // 휴가 — 응답 우선, 없으면 reset (이전 날짜의 휴가가 끌려가지 않게).
        // calendar-events effect가 별개로 Google 자동 매핑 시도하므로 여기선 reset만 담당.
        // Phase 1.5d fix #2 — prefill 응답 시점의 leaveTimeline을 baseline으로 박제.
        // baseline에 full_day 없으면 confirm 가드 절대 발동 X (휴가 신규 등록 false positive 차단).
        if (Array.isArray(data.leaveTimeline) && data.leaveTimeline.length > 0) {
          setLeaveTimeline(data.leaveTimeline)
          baselineLeaveTimelineRef.current = data.leaveTimeline
        } else {
          setLeaveTimeline([])
          baselineLeaveTimelineRef.current = []
        }

        // 메모 — 응답 우선, 없으면 reset
        if (typeof data.workContent === 'string' && data.workContent.length > 0) {
          setWorkContent(data.workContent)
        } else {
          setWorkContent('')
        }
      } catch {
        // 무시
      } finally {
        isFirstFetchRef.current = false
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
    // case A + plannedStartUnreported=true: startTime은 받지 않으니 검증도 skip
    // case A + plannedStartUnreported=false: 사용자가 토글 풀고 입력 → 검증 함
    const requireStartTime = caseMode !== 'none' || !plannedStartUnreported
    if (requireStartTime) {
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

    // Phase 1.5d (CheckInModal 확장, 2026-05-21 fix): 종일 휴가 + 근무 의도 신호 동시 입력 시 명시 확인.
    // 근무 의도 신호 = 실제 출근시간 직접 입력 OR 근무내용 입력.
    // user-touched ref 추가 — 사용자가 LeaveTimelineInput을 직접 건드림 = 명시적 휴가 의도면 가드 skip.
    // (4/14 QA 보고: 휴가 없던 빈 날에 휴가 8h 신규 등록 + 메모 입력 시 confirm 뜨던 false positive fix)
    const hasUserIntentWork = !!(
      actualCheckInTime ||
      (workContent && workContent.trim().length > 0)
    )
    // 1차 안전망 (Phase 1.5d fix #2): baseline(prefill 시점)에 full_day가 있었던 경우만 가드 발동.
    //   - 빈 날 + 사용자가 휴가 신규 등록 → baseline에 휴가 X → 가드 절대 발동 X (4/14, 4/16 fix).
    const baselineHadFullDay = baselineLeaveTimelineRef.current.some(it => it.leaveType === 'full_day')
    // 2차 안전망 — 사용자가 LeaveTimelineInput을 직접 건드림 = 명시 휴가 의도 → 가드 skip.
    const userExplicitLeaveIntent = leaveTimelineUserTouchedRef.current
    if (baselineHadFullDay && hasUserIntentWork && !userExplicitLeaveIntent && !userConfirmedStripLeaveRef.current) {
      setStripLeaveConfirmOpen(true)
      return
    }

    setSaving(true)
    try {
      // Phase 1.5d — 사용자가 confirm "휴가 삭제하고 진행" 누른 경우 종일 휴가 항목 필터링.
      // 반차(morning/afternoon_half)는 유지. isAllDayLeave도 effective 기준으로 재계산.
      const effectiveLeave: LeaveTimeline = userConfirmedStripLeaveRef.current
        ? leaveTimeline.filter(it => it.leaveType !== 'full_day')
        : leaveTimeline
      const effectiveIsAllDay = isFullDayLeave(effectiveLeave)

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
            (caseMode === 'none' && isTodaySubmission && !effectiveIsAllDay
              ? nowKstHHmmCeil() : '')

      // case A 분기:
      //   - plannedStartUnreported=true (미보고 유지): start_time은 legacy NOT NULL 만족용으로
      //     실제출근 시각 fallback. 서버에서 planned_start_time = NULL로 처리.
      //   - plannedStartUnreported=false (토글 풀고 직접 입력): start_time = 사용자 입력값.
      const planned_start_time_unreported = caseMode === 'none' && plannedStartUnreported
      const submitStartTime = caseMode === 'none'
        ? (plannedStartUnreported
            ? (safeActualCheckIn || '09:00')
            : startTime)
        : (effectiveIsAllDay ? null : startTime)

      // C2 정책: 사용자가 N-Click에서 시간을 명시 입력했으면 Google 캘린더 자동 매핑된
      // leave_timeline(source='calendar')을 제거 — N-Click 입력이 우선.
      // 사용자가 LeaveTimelineInput에서 직접 추가한 항목(source !== 'calendar')은 유지.
      const hasUserTimeInput = !!(startTime || endTime || safeActualCheckIn)
      const finalLeaveTimeline = hasUserTimeInput
        ? effectiveLeave.filter(item => item?.source !== 'calendar')
        : effectiveLeave

      const res = await fetch('/api/team-status/check-in', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date,
          name: name.trim(),
          plannedWorkLocations: effectiveIsAllDay ? [] : locations,
          start_time: submitStartTime,
          end_time:   effectiveIsAllDay ? null : endTime,
          actualCheckInTime: safeActualCheckIn || null,
          // Stage 2: true면 서버가 planned_start_time = NULL로 저장 (미보고 SoT)
          plannedStartTimeUnreported: planned_start_time_unreported,
          leaveTimeline: finalLeaveTimeline,
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
      // Phase 1.5d — 한 submit 사이클 끝나면 confirm flag 리셋
      userConfirmedStripLeaveRef.current = false
    }
  }

  // Phase 1.5d — confirm 핸들러: 휴가 삭제하고 진행 → handleSubmit 재호출 (synthetic event)
  const handleConfirmStripLeave = () => {
    setStripLeaveConfirmOpen(false)
    userConfirmedStripLeaveRef.current = true
    handleSubmit({ preventDefault: () => {} } as unknown as React.FormEvent)
  }
  const handleCancelStripLeave = () => {
    setStripLeaveConfirmOpen(false)
    userConfirmedStripLeaveRef.current = false
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

  // v1.36 — 출근예정시간 영역 숨김.
  //   - 출근완료(prior): 항상 숨김 (실출근 | 퇴근예정만). startTime은 prefill값 그대로 submit.
  //   - 미보고 첫출근(none): 출근완료 사용 팀만 숨김. plannedStartUnreported=true 유지 → NULL 저장.
  //   - today(수정)·future(사전)는 노출 유지.
  const hideExpectedStart = caseMode === 'prior' || (caseMode === 'none' && useCheckInComplete)

  return (
    <>
    {/* Phase 1.5d — 종일 휴가 prefill + 근무 의도 동시 입력 시 명시 확인 */}
    {stripLeaveConfirmOpen && (
      <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 px-4">
        <div className="bg-surface rounded-2xl shadow-2xl w-full max-w-sm p-6">
          <h3 className="text-lg font-semibold text-text-primary mb-2">휴가가 등록되어 있습니다</h3>
          <p className="text-sm text-text-secondary mb-5">
            해당 일자에 종일 휴가가 등록되어 있습니다. 이대로 진행하면 <strong className="text-text-primary">휴가가 자동 삭제</strong>되고 근무로 저장됩니다. 정말 진행하시겠습니까?
          </p>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={handleCancelStripLeave}
              className="px-4 py-2 rounded-[10px] border border-border text-text-primary hover:bg-surface-muted text-sm"
            >
              취소
            </button>
            <button
              type="button"
              onClick={handleConfirmStripLeave}
              className="px-4 py-2 rounded-[10px] bg-primary-600 text-white hover:bg-primary-700 text-sm font-medium"
            >
              휴가 삭제하고 진행
            </button>
          </div>
        </div>
      </div>
    )}

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

          {/* prefill fetch 중에는 case UI 안 보임 — caseMode default('none') 깜빡임 방지 */}
          {loadingPrefill && (
            <div className="space-y-2">
              <div className="h-10 rounded-[10px] bg-surface-muted animate-pulse" />
              <div className="h-10 rounded-[10px] bg-surface-muted animate-pulse" />
              <div className="h-10 rounded-[10px] bg-surface-muted animate-pulse" />
            </div>
          )}

          {/* ─── 케이스별 분기 ─── */}
          {/* 휴가(full_day) row여도 시각/장소 필드는 그대로 노출해 사용자가
              필요 시 override할 수 있게 한다. 검증은 isAllDayLeave 시 skip되므로
              빈 채로 제출해도 통과. */}
          {!loadingPrefill && (
            <>
              {/* 케이스 B (prior) + 케이스 today: 동일 UI로 통합 — 4개 필드 editable.
                  순서: 실제출근 → 출근예정/퇴근예정 → 근무장소. 사용자 입력 위계상
                  "지금 실제로 출근한 시각"을 먼저 받고, 예정값은 보조로 둠. */}
              {(caseMode === 'prior' || caseMode === 'today') && (
                <>
                  <div>
                    <label className="block text-[12px] font-semibold text-text-secondary mb-1.5">
                      실제 출근시간{caseMode === 'today' && (
                        <span className="ml-1 text-[11px] font-normal text-text-muted">(비우면 출근 안 한 상태)</span>
                      )}
                      {caseMode === 'prior' && ' *'}
                    </label>
                    <div className="flex items-center gap-2">
                      <div className="flex-1">
                        <HalfHourTimeSelect
                          value={actualCheckInTime}
                          onChange={setActualCheckInTime}
                          allowNextDay
                          ariaLabel="실제 출근시간"
                          placeholder={caseMode === 'today' ? '출근 안 함' : undefined}
                        />
                      </div>
                      {caseMode === 'today' && actualCheckInTime && (
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

                  <div className={hideExpectedStart ? '' : 'grid grid-cols-2 gap-3'}>
                    {!hideExpectedStart && (
                      <div>
                        <label className="block text-[12px] font-semibold text-text-secondary mb-1.5">출근예정시간 *</label>
                        <HalfHourTimeSelect
                          value={startTime}
                          onChange={setStartTime}
                          ariaLabel="출근예정시간"
                        />
                      </div>
                    )}
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
                </>
              )}

              {/* 케이스 A (none): 출근예정시간 = 미보고 표시 + 수정하기 토글. 실제출근 + 퇴근예정 + 근무지.
                  순서: 실제출근 → 출근예정(미보고 토글)/퇴근예정 → 근무장소. */}
              {caseMode === 'none' && (
                <>
                  <div>
                    <label className="block text-[12px] font-semibold text-text-secondary mb-1.5">실제 출근시간 *</label>
                    <HalfHourTimeSelect
                      value={actualCheckInTime}
                      onChange={setActualCheckInTime}
                      allowNextDay
                      ariaLabel="실제 출근시간"
                    />
                  </div>

                  <div className={hideExpectedStart ? '' : 'grid grid-cols-2 gap-3'}>
                    {!hideExpectedStart && (
                    <div>
                      <label className="block text-[12px] font-semibold text-text-secondary mb-1.5">
                        출근예정시간{!plannedStartUnreported && ' *'}
                      </label>
                      {plannedStartUnreported ? (
                        <div className="h-10 rounded-[10px] border border-border bg-surface-muted px-3 flex items-center justify-between gap-2">
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-text-secondary/15 text-text-secondary text-[11px] font-semibold">
                            미보고
                          </span>
                          <button
                            type="button"
                            onClick={() => { setPlannedStartUnreported(false); setStartTime('09:00') }}
                            className="text-[11px] font-medium text-primary-600 hover:text-primary-700 transition-colors"
                          >
                            수정하기
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <div className="flex-1">
                            <HalfHourTimeSelect
                              value={startTime}
                              onChange={setStartTime}
                              ariaLabel="출근예정시간"
                            />
                          </div>
                          <button
                            type="button"
                            onClick={() => setPlannedStartUnreported(true)}
                            className="shrink-0 text-[11px] text-text-muted hover:text-text-primary transition-colors px-1.5"
                            title="미보고 상태로 되돌리기"
                          >
                            미보고로
                          </button>
                        </div>
                      )}
                    </div>
                    )}
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
                  {!hideExpectedStart && !plannedStartUnreported && (
                    <p className="text-[11px] text-info-text -mt-2">
                      출근예정시간을 입력하시면 미보고 상태가 해제되어 일반 출근보고로 등록됩니다.
                    </p>
                  )}

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
            <LeaveTimelineInput value={leaveTimeline} onChange={next => {
              // Phase 1.5d — 사용자가 직접 leaveTimeline 건드림 신호 (휴가 추가/수정/삭제)
              leaveTimelineUserTouchedRef.current = true
              setLeaveTimeline(next)
            }} />
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
    </>
  )
}
