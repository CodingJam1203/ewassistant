'use client'

/**
 * WorkLogForm — v2 (근무장소-시간 분리)
 *
 * 변경:
 * - 근무장소: 시간과 무관한 칩 배열 (planned_work_locations / actual_work_locations).
 *   퇴근보고 본문에서는 actual chips(planned로 prefill, 변경 없으면 NULL 저장).
 *   "다음 출근 예정" 영역에서는 planned chips.
 * - 시간: 출근시간 / 실제퇴근시간 / 출근예정시간 / 퇴근예정시간 — 별도 TimeSelect input으로 분리.
 * - EW 계산은 startTime/endTime/breakTime/leaveMinutes/workLocationLabel(표시용) 기반으로 유지.
 *
 * Legacy 호환:
 * - initialTimeline (work_location_timeline) — 첫 항목 시각=출근, 마지막 시각=퇴근, work_location 라벨들=actual chips
 * - editingLog의 work_location_timeline / expected_work_location_timeline — 위와 동일하게 변환해 prefill
 * - 제출 시 신규 컬럼만 보냄 (legacy 단일 컬럼은 서버에서 첫 chip 라벨로 mirror)
 */

import { useEffect, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import * as z from 'zod'
import { calculateEw, EwCalculationResult } from '@/lib/ew-calculator'
import { Copy, Loader2 } from 'lucide-react'
import { addDays } from 'date-fns'
import { getKstTodayDateString, toKstDateString } from '@/lib/utils/date'
import { categorizeDate, getKoreanHolidayName, type DateCategory } from '@/lib/kr-holidays'
import { DateInputWithDow } from '@/components/ui'
import WorkLocationChipsInput from '@/components/WorkLocationChipsInput'
import LeaveTimelineInput from '@/components/LeaveTimelineInput'
import type { UserCalendarLookup } from '@/types/leave-calendar'
import TimeSelect from '@/components/TimeSelect'
import HalfHourTimeSelect from '@/components/HalfHourTimeSelect'
import {
  defaultWorkLocations,
  type WorkLocations,
  type WorkLocationChip,
} from '@/types/work-locations-v2'
import {
  validateWorkLocations,
  legacyTimelineToLocations,
  legacySingleToLocations,
  formatChipsArrow,
  firstChipLabel,
  locationsEqual,
  normalizeWorkLocations,
} from '@/lib/work-locations-v2'
import {
  validateLeaveTimeline,
  totalLeaveRoundedMinutes,
  isFullDayLeave,
  buildLeaveItem,
  ceilTo30Min,
  minutesToDisplay,
} from '@/lib/leave-timeline'
import type { LeaveTimeline } from '@/types/leave-timeline'
import type { WorkLog } from '@/types/work-log'
import type { WorkLocationTimeline } from '@/types/work-location-timeline'

// ─── zod ─────────────────────────────────────────────────────────────────────

const chipZ = z.object({
  kind: z.enum(['office', 'remote', 'field', 'custom']),
  customLabel: z.string().nullable().optional(),
})

const leaveItemZ = z.object({
  kind: z.literal('leave'),
  leaveType: z.enum(['full_day', 'morning_half', 'afternoon_half']),
  label: z.string(),
  startTime: z.string(),
  endTime: z.string(),
  actualMinutes: z.number(),
  roundedMinutes: z.number(),
  source: z.enum(['manual', 'calendar', 'expected']).optional(),
})

const formSchema = z.object({
  name: z.string().min(1, '이름을 입력해주세요'),
  workTypeLabel: z.enum([
    // 신규 5종
    '(평일) 기본 근무',
    '(평일) 간주 근무',
    '토요일 근무',
    '일요일·공휴일 근무 (선택)',
    '일요일·공휴일 근무 (필수)',
    // 레거시 — 기존 데이터 호환 (편집 모드 prefill에만 사용)
    '기본근무 등록',
    '간주근로 등록',
    '공휴일근로 등록',
    '',  // 일요일/공휴일 + 미선택 잠금 상태
  ]),
  leaveDate: z.string().min(1, '퇴근일자를 입력해주세요'),

  // 본문 시간 (퇴근보고)
  startTime: z.string().optional(),
  endTime: z.string().optional(),

  // 본문 근무장소 — actual chips (planned로 prefill, 변경 없으면 null로 저장됨)
  actualWorkLocations: z.array(chipZ).optional(),
  /** 사용자가 actual을 명시적으로 수정했는지 (변경 없으면 NULL 저장) */
  actualWorkLocationsTouched: z.boolean().optional(),

  // 본문 휴가/반차
  leaveTimeline: z.array(leaveItemZ).optional(),

  /** 휴게시간 (= 점심 외 추가 휴게). 점심 1h는 워크타입에 따라 자동 차감.
      base는 optional — 출근보고 수정 모드(_editScope='check_in')에서는 본문 영역이
      UI에 없어 빈 채로 들어옴. 본문 케이스 검증은 superRefine에서 분기. */
  breakTime: z.string().optional(),
  breakReason: z.string().optional(),
  workContent: z.string().optional(),

  lateOrAttendanceStatus: z.enum(['아니오', '예']),
  previousReportTime: z.string().optional(),
  currentReportTime: z.string().optional(),
  lateReason: z.string().optional(),

  // 다음 출근 예정 (출근보고 진행)
  attendanceRecordType: z.enum(['출근보고 진행 (주말출근, 휴가 포함)', '스킵(누락퇴근보고, 퇴근보고 수정)']),
  expectedStartDate: z.string().optional(),
  expectedStartTime: z.string().optional(),
  expectedEndTime: z.string().optional(),
  plannedWorkLocations: z.array(chipZ).optional(),
  expectedLeaveTimeline: z.array(leaveItemZ).optional(),

  thanksMacaron: z.string().optional(),
  sendTeams: z.boolean().optional(),

  /** 메타 — 편집 모드 + scope. UI는 showCheckIn/Out으로 분기되는데, schema도
      같은 분기를 알아야 본문 영역이 노출 안 된 케이스(check_in 수정)에서 빈 본문을
      validation으로 막지 않음. 형식상 form field지만 input은 없고 default로 주입. */
  _editScope: z.enum(['check_in', 'check_out']).optional(),
}).superRefine((data, ctx) => {
  const leaveTl = (data.leaveTimeline ?? []) as LeaveTimeline
  const isAllDay = isFullDayLeave(leaveTl)
  const isCheckInOnly = data._editScope === 'check_in'

  // 휴가 자체 검증 — 항상
  const leaveErrors = validateLeaveTimeline(leaveTl)
  leaveErrors.forEach(err => {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: err.message,
      path: typeof err.index === 'number'
        ? ['leaveTimeline', err.index]
        : ['leaveTimeline'],
    })
  })

  // 본문(퇴근보고 영역) 검증 — 출근보고 수정 모드면 UI에 없으므로 skip
  if (!isCheckInOnly) {
    if (!data.breakTime || data.breakTime.length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: '휴게시간을 선택해주세요', path: ['breakTime'] })
    }
    if (!data.workContent || data.workContent.trim().length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: '근무내용을 입력해주세요', path: ['workContent'] })
    }
    if (!isAllDay) {
      if (!data.startTime || !/^(\d{1,2}):(00|30)$/.test(data.startTime)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: '출근시간을 30분 단위로 선택해주세요.', path: ['startTime'] })
      }
      if (!data.endTime || !/^(\d{1,2}):(00|30)$/.test(data.endTime)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: '퇴근시간을 30분 단위로 선택해주세요.', path: ['endTime'] })
      }

      const actual = (data.actualWorkLocations ?? []) as WorkLocations
      const locErrors = validateWorkLocations(actual)
      locErrors.forEach(err => {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: err.message,
          path: typeof err.index === 'number'
            ? ['actualWorkLocations', err.index]
            : ['actualWorkLocations'],
        })
      })
    }
  }

  if (data.lateOrAttendanceStatus === '예') {
    if (!data.previousReportTime) ctx.addIssue({ code: z.ZodIssueCode.custom, message: '필수 입력', path: ['previousReportTime'] })
    if (!data.currentReportTime) ctx.addIssue({ code: z.ZodIssueCode.custom, message: '필수 입력', path: ['currentReportTime'] })
    if (!data.lateReason) ctx.addIssue({ code: z.ZodIssueCode.custom, message: '필수 입력', path: ['lateReason'] })
  }

  if (data.attendanceRecordType === '출근보고 진행 (주말출근, 휴가 포함)') {
    if (!data.expectedStartDate) ctx.addIssue({ code: z.ZodIssueCode.custom, message: '필수 입력', path: ['expectedStartDate'] })
    if (!data.expectedStartTime || !/^(\d{1,2}):(00|30)$/.test(data.expectedStartTime)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: '출근예정시간을 30분 단위로 선택해주세요.', path: ['expectedStartTime'] })
    }
    if (!data.expectedEndTime || !/^(\d{1,2}):(00|30)$/.test(data.expectedEndTime)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: '퇴근예정시간을 30분 단위로 선택해주세요.', path: ['expectedEndTime'] })
    }
    const planned = (data.plannedWorkLocations ?? []) as WorkLocations
    const plErrors = validateWorkLocations(planned)
    plErrors.forEach(err => {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: err.message,
        path: typeof err.index === 'number'
          ? ['plannedWorkLocations', err.index]
          : ['plannedWorkLocations'],
      })
    })
  }
})

export type WorkLogFormData = z.infer<typeof formSchema>
type WorkTypeLabelValue = WorkLogFormData['workTypeLabel']

interface WorkLogFormProps {
  userName: string | null
  /**
   * Legacy: 오늘의 work_location_timeline (퇴근보고 모달 prefill용).
   * 제공되면 첫 항목 시각=출근, 마지막 시각=퇴근으로 추출하고,
   * work_location 라벨들은 actual chips로 변환해 prefill.
   */
  initialTimeline?: WorkLocationTimeline | null
  /** 신규: 오늘의 actual chips. (있으면 initialTimeline보다 우선) */
  initialActualLocations?: WorkLocations | null
  /** 신규: 오늘의 planned chips (없으면 actual로 대체 노출). */
  initialPlannedLocations?: WorkLocations | null
  /** 오늘의 leave_timeline */
  initialLeaveTimeline?: LeaveTimeline | null
  initialBreakAutoActualMinutes?: number | null
  /** Legacy fallback: timeline 없을 때 사용할 출근시각 ('HH:mm') */
  initialStartTime?: string
  /** Legacy fallback: timeline 없을 때 사용할 퇴근시각 ('HH:mm') */
  initialEndTime?: string
  resubmitLogId?: string | null
  /** 수정 모드 */
  editingLog?: WorkLog | null
  editScope?: 'check_in' | 'check_out'
  onCalculate: (result: EwCalculationResult | null, error: string | null) => void
  onSubmitSuccess: () => void
  onSubmitStateChange?: (state: { isSubmitting: boolean; submitError: string | null }) => void
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function trimToHHmm(t: string | undefined | null): string {
  if (!t) return ''
  return t.slice(0, 5)
}

/** initialTimeline (legacy)에서 첫 work_location 시각 추출 */
function timelineFirstStartTime(tl: WorkLocationTimeline | null | undefined): string | null {
  if (!Array.isArray(tl)) return null
  for (const e of tl) {
    if (e.kind === 'work_location') return e.startTime
  }
  return null
}
/** initialTimeline에서 마지막 종료 항목(checkout/expected_checkout) 시각 추출 */
function timelineEndTime(tl: WorkLocationTimeline | null | undefined): string | null {
  if (!Array.isArray(tl) || tl.length === 0) return null
  const last = tl[tl.length - 1]
  if (last.kind === 'expected_checkout' || last.kind === 'checkout') {
    return last.startTime
  }
  return null
}

/**
 * 초기 actualWorkLocations 결정.
 * 우선순위: initialActualLocations → initialTimeline에서 변환 → initialPlannedLocations → 기본([사무실])
 */
function buildInitialActualLocations(
  initialActualLocations: WorkLocations | null | undefined,
  initialTimeline: WorkLocationTimeline | null | undefined,
  initialPlannedLocations: WorkLocations | null | undefined,
): WorkLocations {
  const v2 = normalizeWorkLocations(initialActualLocations)
  if (v2 && v2.length > 0) return v2
  const fromLegacy = legacyTimelineToLocations(initialTimeline ?? null)
  if (fromLegacy && fromLegacy.length > 0) return fromLegacy
  const planned = normalizeWorkLocations(initialPlannedLocations)
  if (planned && planned.length > 0) return planned
  return defaultWorkLocations()
}

/** 수정 모드의 editingLog → actual chips */
function buildEditActualLocations(log: WorkLog): WorkLocations {
  const v2 = normalizeWorkLocations(log.actual_work_locations)
  if (v2 && v2.length > 0) return v2
  const fromTl = legacyTimelineToLocations(log.work_location_timeline ?? null)
  if (fromTl && fromTl.length > 0) return fromTl
  const planned = normalizeWorkLocations(log.planned_work_locations)
  if (planned && planned.length > 0) return planned
  const fromSingle = legacySingleToLocations(log.work_location ?? null)
  if (fromSingle && fromSingle.length > 0) return fromSingle
  return defaultWorkLocations()
}

/** 수정 모드의 editingLog → planned chips */
function buildEditPlannedLocations(log: WorkLog): WorkLocations {
  const v2 = normalizeWorkLocations(log.planned_work_locations)
  if (v2 && v2.length > 0) return v2
  const fromTl = legacyTimelineToLocations(log.expected_work_location_timeline ?? null)
  if (fromTl && fromTl.length > 0) return fromTl
  const fromSingle = legacySingleToLocations(log.expected_work_location ?? null)
  if (fromSingle && fromSingle.length > 0) return fromSingle
  return defaultWorkLocations()
}

// ─── component ───────────────────────────────────────────────────────────────

export default function WorkLogForm({
  userName,
  initialTimeline,
  initialActualLocations,
  initialPlannedLocations,
  initialLeaveTimeline,
  initialBreakAutoActualMinutes,
  initialStartTime,
  initialEndTime,
  resubmitLogId,
  editingLog,
  editScope,
  onCalculate,
  onSubmitSuccess,
  onSubmitStateChange,
}: WorkLogFormProps) {
  const isEditing = !!editingLog
  const showCheckOutSections = editScope === undefined || editScope === 'check_out'
  const showCheckInSections  = editScope === undefined || editScope === 'check_in'

  // 휴게 자동값
  const breakAutoActualMinutes = isEditing
    ? (editingLog?.break_auto_actual_minutes ?? 0)
    : (initialBreakAutoActualMinutes ?? 0)
  const breakAutoRoundedMinutes = ceilTo30Min(breakAutoActualMinutes)
  const breakAutoHHmm = (() => {
    const m = breakAutoRoundedMinutes
    const h = Math.floor(m / 60)
    const mm = m % 60
    return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
  })()
  const defaultBreakHHmm = (() => {
    if (breakAutoRoundedMinutes > 0) return breakAutoHHmm
    return '00:00'
  })()

  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [showEwPopup, setShowEwPopup] = useState(false)
  const [lastSubmitResult, setLastSubmitResult] = useState<EwCalculationResult | null>(null)

  useEffect(() => {
    onSubmitStateChange?.({ isSubmitting, submitError })
  }, [isSubmitting, submitError, onSubmitStateChange])

  const nameDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const nameInitialized = useRef(false)

  // 시간 default 계산
  const defaultStartTime = (() => {
    if (isEditing && editingLog) {
      return trimToHHmm(editingLog.start_time)
        || timelineFirstStartTime(editingLog.work_location_timeline ?? null)
        || '09:00'
    }
    return trimToHHmm(initialStartTime)
      || timelineFirstStartTime(initialTimeline ?? null)
      || '09:00'
  })()
  const defaultEndTime = (() => {
    if (isEditing && editingLog) {
      return trimToHHmm(editingLog.end_time)
        || timelineEndTime(editingLog.work_location_timeline ?? null)
        || '18:00'
    }
    return trimToHHmm(initialEndTime)
      || timelineEndTime(initialTimeline ?? null)
      || '18:00'
  })()
  const defaultExpectedStartTime = (() => {
    if (isEditing && editingLog) {
      return trimToHHmm(editingLog.expected_work_time)
        || timelineFirstStartTime(editingLog.expected_work_location_timeline ?? null)
        || '09:00'
    }
    return '09:00'
  })()
  const defaultExpectedEndTime = (() => {
    if (isEditing && editingLog) {
      return timelineEndTime(editingLog.expected_work_location_timeline ?? null) || '18:00'
    }
    return '18:00'
  })()

  // chips defaults
  const defaultActualLocations: WorkLocations = isEditing && editingLog
    ? buildEditActualLocations(editingLog)
    : buildInitialActualLocations(
        initialActualLocations ?? null,
        initialTimeline ?? null,
        initialPlannedLocations ?? null,
      )
  const defaultPlannedLocations: WorkLocations = isEditing && editingLog
    ? buildEditPlannedLocations(editingLog)
    : defaultWorkLocations()
  // actual의 baseline (사용자가 변경했는지 비교용)
  const baselineActualRef = useRef<WorkLocations>(defaultActualLocations)

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<WorkLogFormData>({
    resolver: zodResolver(formSchema),
    defaultValues: isEditing && editingLog
      ? {
          name: editingLog.name,
          workTypeLabel: ((): WorkTypeLabelValue => {
            const stored = editingLog.work_type_label ?? ''
            // 레거시 라벨은 신규 5종으로 자동 매핑 — 사용자에게 "(구버전)" 표시 노출 X.
            // 매핑 후 submit 시 새 라벨로 재저장돼 데이터가 자연스럽게 마이그레이션됨.
            // (workTypeCode는 동일하므로 EW 계산 영향 없음.)
            if (stored === '기본근무 등록') return '(평일) 기본 근무'
            if (stored === '간주근로 등록') return '(평일) 간주 근무'
            if (stored === '공휴일근로 등록') return '일요일·공휴일 근무 (선택)'
            const validNewLabels = [
              '(평일) 기본 근무', '(평일) 간주 근무', '토요일 근무',
              '일요일·공휴일 근무 (선택)', '일요일·공휴일 근무 (필수)',
            ] as const
            if ((validNewLabels as readonly string[]).includes(stored)) {
              return stored as WorkTypeLabelValue
            }
            return '(평일) 기본 근무'
          })(),
          leaveDate: editingLog.leave_date,
          startTime: defaultStartTime,
          endTime: defaultEndTime,
          actualWorkLocations: defaultActualLocations,
          // 수정 모드에서 actual_work_locations가 NULL이었으면 (planned로 노출돼있던 상태)
          // baseline = planned, touched = false. 사용자가 변경하면 touched=true가 됨.
          actualWorkLocationsTouched: editingLog.actual_work_locations != null,
          leaveTimeline: (editingLog.leave_timeline ?? []) as LeaveTimeline,
          breakTime: trimToHHmm(editingLog.break_time) || '00:00',
          breakReason: editingLog.break_reason ?? '',
          workContent: editingLog.work_content ?? '',
          lateOrAttendanceStatus: (editingLog.late_or_attendance_status === '예' ? '예' : '아니오') as '예' | '아니오',
          previousReportTime: editingLog.previous_report_time ?? '',
          currentReportTime: editingLog.current_report_time ?? '',
          lateReason: editingLog.late_reason ?? '',
          attendanceRecordType:
            (editingLog.attendance_record_type === '스킵(누락퇴근보고, 퇴근보고 수정)'
              ? '스킵(누락퇴근보고, 퇴근보고 수정)'
              : '출근보고 진행 (주말출근, 휴가 포함)'),
          expectedStartDate: editingLog.expected_start_date ?? toKstDateString(addDays(new Date(editingLog.leave_date), 1)),
          expectedStartTime: defaultExpectedStartTime,
          expectedEndTime: defaultExpectedEndTime,
          plannedWorkLocations: defaultPlannedLocations,
          expectedLeaveTimeline: (editingLog.expected_leave_timeline ?? []) as LeaveTimeline,
          thanksMacaron: (editingLog.thanks_macaron as string | null) ?? '',
          sendTeams: true,
          _editScope: editScope,
        }
      : {
          name: userName || '',
          workTypeLabel: ((): WorkTypeLabelValue => {
            const today = getKstTodayDateString()
            const cat = categorizeDate(today)
            if (cat === 'saturday') return '토요일 근무'
            if (cat === 'sunday_or_holiday') return ''  // 잠금 상태 — 사용자가 선택
            return '(평일) 기본 근무'
          })(),
          leaveDate: getKstTodayDateString(),
          startTime: defaultStartTime,
          endTime: defaultEndTime,
          actualWorkLocations: defaultActualLocations,
          actualWorkLocationsTouched: false,
          leaveTimeline: (initialLeaveTimeline ?? []) as LeaveTimeline,
          breakTime: defaultBreakHHmm,
          workContent: '',
          lateOrAttendanceStatus: '아니오',
          attendanceRecordType: '출근보고 진행 (주말출근, 휴가 포함)',
          expectedStartDate: toKstDateString(addDays(new Date(), 1)),
          expectedStartTime: '09:00',
          expectedEndTime: '18:00',
          plannedWorkLocations: defaultPlannedLocations,
          expectedLeaveTimeline: [] as LeaveTimeline,
          sendTeams: true,
          _editScope: editScope,
        },
  })

  const formValues = watch()

  // 날짜에 따른 근무유형 카테고리 + 한국 공휴일명 (잠금/안내 UI에 사용)
  const dateCategory: DateCategory = categorizeDate(formValues.leaveDate ?? getKstTodayDateString())
  const koreanHolidayName = getKoreanHolidayName(formValues.leaveDate ?? '')
  /** 일요일/공휴일 + 근무유형 미선택 → 폼 잠금 (시간/장소/내용 모두 disabled) */
  const isFormLocked = dateCategory === 'sunday_or_holiday' && !formValues.workTypeLabel

  // workSubType — 라벨에서 추출
  const workSubType: 'saturday' | 'sun_optional' | 'sun_required' | null = (() => {
    const wt = formValues.workTypeLabel
    if (wt === '토요일 근무') return 'saturday'
    if (wt === '일요일·공휴일 근무 (선택)') return 'sun_optional'
    if (wt === '일요일·공휴일 근무 (필수)') return 'sun_required'
    return null
  })()
  // 일요일·공휴일 근무 안내문 (EW 미리보기 영역에 빨갛게 표시)
  const subTypeNotice: string | null = (() => {
    if (workSubType === 'sun_optional')
      return '일요일/공휴일이지만 본인의 선택으로 근로한 건입니다. 근무시간을 토요일로 상신해주세요.'
    if (workSubType === 'sun_required')
      return '일요일/공휴일이지만 행사, 고객사 요청으로 주말 근무하는 건입니다. 근무시간을 일요일로 상신해주세요.'
    return null
  })()

  // 도출값
  const actualLocs = (formValues.actualWorkLocations ?? []) as WorkLocations
  const plannedLocs = (formValues.plannedWorkLocations ?? []) as WorkLocations
  const startTime = formValues.startTime ?? ''
  const endTime = formValues.endTime ?? ''
  const derivedLocationLabel = formatChipsArrow(actualLocs)

  // 휴가 도출값
  const leaveTl = (formValues.leaveTimeline ?? []) as LeaveTimeline
  const leaveMinutesTotal = totalLeaveRoundedMinutes(leaveTl)
  const isAllDay = isFullDayLeave(leaveTl)
  const hasReducedLeave = leaveTl.some(it =>
    it.leaveType === 'morning_half' || it.leaveType === 'afternoon_half'
  )
  const forceStandardSpan = isAllDay || hasReducedLeave

  const showBreakReason = formValues.breakTime && formValues.breakTime !== '00:00'
  const breakUserChanged = (formValues.breakTime ?? '00:00') !== breakAutoHHmm && breakAutoRoundedMinutes > 0

  // userName prop 자동완성
  useEffect(() => {
    if (isEditing) {
      nameInitialized.current = true
      return
    }
    if (userName && !nameInitialized.current) {
      setValue('name', userName)
      nameInitialized.current = true
    }
  }, [userName, setValue, isEditing])

  // ─── Google 캘린더 휴가 자동 prefill ─────────────────────────────────────
  // leaveDate가 처음 set된 후 1회만 시도. 사용자가 명시적으로 비워둔 경우엔 prefill 안 함
  // (시도 후 ref로 재시도 막음). N-Click leaveTimeline이 이미 있거나 사용자 입력이 있으면
  // skip — Google 휴가는 보조 prefill 역할일 뿐.
  const calendarPrefillTriedRef = useRef(false)
  useEffect(() => {
    if (calendarPrefillTriedRef.current) return
    const date = formValues.leaveDate
    if (!date) return
    const currentLeave = (formValues.leaveTimeline ?? []) as LeaveTimeline
    if (currentLeave.length > 0) return  // 이미 휴가 있으면 X (편집 모드 prefill 또는 사용자 입력)
    calendarPrefillTriedRef.current = true

    let cancelled = false
    fetch(`/api/team-status/calendar-events?date=${encodeURIComponent(date)}`)
      .then(r => (r.ok ? r.json() : null))
      .then((data: UserCalendarLookup | null) => {
        if (cancelled || !data?.leaveType) return
        // 다시 한 번 체크 — fetch 사이 사용자가 입력했을 수도 있음
        const stillEmpty = ((formValues.leaveTimeline ?? []) as LeaveTimeline).length === 0
        if (!stillEmpty) return
        setValue(
          'leaveTimeline',
          [buildLeaveItem(data.leaveType, data.leaveLabel ?? undefined, 'calendar')],
          { shouldDirty: false, shouldValidate: false },
        )
      })
      .catch(() => { /* 무시 */ })
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formValues.leaveDate])

  // 워크타입 변경 시 휴게값 정책:
  //   - 신규 작성: 첫 mount 1회만 breakAuto 기반으로 prefill, 이후엔 사용자 입력 보존
  //   - 편집: 항상 사용자 입력 보존
  //   사용자가 수동으로 30분 설정해놓고 근무유형을 바꿔도 그대로 30분 유지됨.
  const prevWorkTypeRef = useRef<string | undefined>(undefined)
  useEffect(() => {
    const wt = formValues.workTypeLabel
    if (prevWorkTypeRef.current === undefined) {
      // 첫 mount — prev 기록만 하고 종료. 신규/편집 둘 다 breakTime 초기값 보존.
      prevWorkTypeRef.current = wt
      return
    }
    // 이후 workType 변경 시 — breakTime 손대지 않음. 사용자가 명시적으로 수정.
    prevWorkTypeRef.current = wt
  // breakAutoRoundedMinutes / breakAutoHHmm / setValue / isEditing은 더 이상 안 씀
  }, [formValues.workTypeLabel])

  // display_name 자동 업데이트 (debounce)
  useEffect(() => {
    if (isEditing) return
    const currentName = formValues.name
    if (!currentName || !nameInitialized.current) return
    if (nameDebounceRef.current) clearTimeout(nameDebounceRef.current)
    nameDebounceRef.current = setTimeout(async () => {
      try {
        await fetch('/api/auth/profile', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ display_name: currentName }),
        })
      } catch {
        // ignore
      }
    }, 800)
    return () => {
      if (nameDebounceRef.current) clearTimeout(nameDebounceRef.current)
    }
  }, [formValues.name, isEditing]) // eslint-disable-line react-hooks/exhaustive-deps

  // EW 계산
  useEffect(() => {
    try {
      const timeRegex = /^([01]\d|2\d|3[0-6]):([0-5]\d)$/
      const calcStart = forceStandardSpan ? '09:00' : startTime
      const calcEnd   = forceStandardSpan ? '18:00' : endTime
      const calcLocation = isAllDay ? '휴가' : (derivedLocationLabel || '사무실')

      if (
        formValues.name &&
        formValues.workTypeLabel &&
        formValues.leaveDate &&
        calcStart && calcEnd &&
        timeRegex.test(calcStart) && timeRegex.test(calcEnd)
      ) {
        const result = calculateEw({
          name: formValues.name,
          workTypeLabel: formValues.workTypeLabel,
          leaveDate: formValues.leaveDate,
          startTime: calcStart,
          endTime: calcEnd,
          breakTime: formValues.breakTime || '00:00',
          workLocation: calcLocation,
          workContent: formValues.workContent,
          breakReason: showBreakReason ? formValues.breakReason : undefined,
          leaveMinutes: leaveMinutesTotal,
          isFullDayLeave: isAllDay,
        })
        onCalculate(result, null)
      } else {
        onCalculate(null, null)
      }
    } catch (err: any) {
      onCalculate(null, err.message)
    }
  }, [
    formValues.name, formValues.workTypeLabel, formValues.leaveDate,
    startTime, endTime, derivedLocationLabel,
    formValues.breakTime, formValues.workContent, formValues.breakReason,
    leaveMinutesTotal, isAllDay, forceStandardSpan,
    onCalculate, showBreakReason
  ])

  const onSubmit = async (data: WorkLogFormData) => {
    // 일요일/공휴일 + 근무유형 미선택 차단
    if (dateCategory === 'sunday_or_holiday' && !data.workTypeLabel) {
      setSubmitError(
        koreanHolidayName
          ? `오늘은 ${koreanHolidayName}입니다. 근무유형을 먼저 선택해주세요.`
          : '일요일입니다. 근무유형을 먼저 선택해주세요.',
      )
      return
    }
    setIsSubmitting(true)
    setSubmitError(null)

    try {
      const rawSubmittedLeave = (data.leaveTimeline ?? []) as LeaveTimeline
      const submittedActual = (data.actualWorkLocations ?? []) as WorkLocations
      const submittedPlanned = (data.plannedWorkLocations ?? []) as WorkLocations
      const actualWasTouched = !!data.actualWorkLocationsTouched
        || !locationsEqual(submittedActual, baselineActualRef.current)

      // ─── 자동 정리: 일반 출퇴근 신호가 있는데 종일 휴가가 prefill로 살아있으면 해제 ──
      // 휴가 등록 후 같은 날 출퇴근 보고 작성/수정 시 모달 prefill로 leaveTimeline=full_day가
      // 들어오는데, 사용자가 안 건드리면 그대로 다시 저장되어 모순(휴가 + 사무실 출퇴근) 발생.
      // 사용자가 명백히 "일반 근무" 의도(actual 위치 직접 변경 / 근무내용 입력)면 종일 휴가
      // 항목만 자동 제거. 반차(morning_half 등)는 유지.
      const isRegularWorkSubmit = !!(
        actualWasTouched ||
        (data.workContent && data.workContent.trim().length > 0)
      )
      const submittedLeave: LeaveTimeline = isRegularWorkSubmit
        ? rawSubmittedLeave.filter(it => it.leaveType !== 'full_day')
        : rawSubmittedLeave

      const submittedIsAllDay = isFullDayLeave(submittedLeave)
      const submittedHasReducedLeave = submittedLeave.some(it =>
        it.leaveType === 'morning_half' || it.leaveType === 'afternoon_half'
      )
      const submittedForceStandardSpan = submittedIsAllDay || submittedHasReducedLeave
      const submittedLeaveMinutes = totalLeaveRoundedMinutes(submittedLeave)

      const submittedStartTime = submittedForceStandardSpan ? '09:00' : (data.startTime || '09:00')
      const submittedEndTime   = submittedForceStandardSpan ? '18:00' : (data.endTime   || '18:00')
      const submittedWorkLocation = submittedIsAllDay
        ? '휴가'
        : (firstChipLabel(submittedActual) || '사무실')
      const submittedLocationSummary = submittedIsAllDay
        ? '휴가'
        : (formatChipsArrow(submittedActual) || submittedWorkLocation)

      // 휴게
      const breakManualHHmm = data.breakTime || '00:00'
      const [bH, bM] = breakManualHHmm.split(':').map(Number)
      const breakManualMinutes = (Number.isFinite(bH) ? bH : 0) * 60 + (Number.isFinite(bM) ? bM : 0)
      const breakIsManual = breakManualMinutes !== breakAutoRoundedMinutes
      const breakFinalRoundedMinutes = breakManualMinutes

      // EW 계산 + 클립보드
      const result = calculateEw({
        name: data.name,
        workTypeLabel: data.workTypeLabel,
        leaveDate: data.leaveDate,
        startTime: submittedStartTime,
        endTime: submittedEndTime,
        breakTime: breakManualHHmm,
        workLocation: submittedLocationSummary,
        workContent: data.workContent,
        breakReason: showBreakReason ? data.breakReason : undefined,
        leaveMinutes: submittedLeaveMinutes,
        isFullDayLeave: submittedIsAllDay,
      })
      try {
        await navigator.clipboard.writeText(result.copyText)
      } catch (err) {
        console.warn('Clipboard write failed:', err)
      }

      const url = isEditing && editingLog
        ? `/api/work-logs/${editingLog.id}`
        : '/api/work-logs'
      const method = isEditing ? 'PATCH' : 'POST'

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...data,
          // 공휴일 근무 sub-type (라벨에서 추출)
          workSubType,
          // 신규 v2 필드
          actualWorkLocations: actualWasTouched ? submittedActual : null,
          plannedWorkLocations: data.attendanceRecordType === '출근보고 진행 (주말출근, 휴가 포함)'
            ? submittedPlanned
            : null,
          // 시간 (HH:mm)
          startTime: submittedStartTime,
          endTime: submittedEndTime,
          expectedStartTime: data.expectedStartTime,
          expectedEndTime: data.expectedEndTime,
          // legacy 단일 mirror (서버 호환)
          finalWorkLocation: submittedWorkLocation,
          workLocation: submittedWorkLocation,
          leaveTimeline: submittedLeave,
          breakAutoActualMinutes: breakAutoActualMinutes,
          breakAutoRoundedMinutes: breakAutoRoundedMinutes,
          breakManualRoundedMinutes: breakIsManual ? breakManualMinutes : null,
          breakFinalRoundedMinutes: breakFinalRoundedMinutes,
          resubmitLogId: isEditing ? null : resubmitLogId,
        }),
      })

      const resData = await res.json()
      if (!res.ok) {
        throw new Error(resData.error || '제출에 실패했습니다.')
      }

      setLastSubmitResult(result)
      setShowEwPopup(true)
    } catch (err: any) {
      setSubmitError(err.message)
    } finally {
      setIsSubmitting(false)
    }
  }

  // chips 변경 핸들러
  const onActualLocsChange = (next: WorkLocations) => {
    setValue('actualWorkLocations', next, { shouldValidate: false, shouldDirty: true })
    if (!locationsEqual(next, baselineActualRef.current)) {
      setValue('actualWorkLocationsTouched', true, { shouldValidate: false, shouldDirty: true })
    }
  }

  return (
    <>
      {showEwPopup && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 px-4">
          <div className="bg-surface rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <h3 className="text-lg font-semibold text-text-primary mb-2">상신할 내용이 복사되었습니다!</h3>
            <p className="text-sm text-text-secondary mb-3">
              복사한 내용을 EW(Enjoy Working) 또는 NPM(휴가 상신)에 붙여 넣어 등록할 수 있습니다.
            </p>
            {lastSubmitResult && (lastSubmitResult.actualWorkMinutes <= 4 * 60 || lastSubmitResult.workTypeCode === 3) && (
              <div className="mb-5 rounded-[10px] border border-warning-border bg-warning-bg px-3 py-2 text-[12px] text-warning-text">
                * 점심시간 진행 여부에 따라 근무시간을 별도 계산하여 EW에 상신해주세요.
              </div>
            )}
            <div className="flex flex-col gap-2">
              <a
                href="https://working.univ.me/Home"
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => { setShowEwPopup(false); onSubmitSuccess() }}
                className="w-full px-4 py-2.5 text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 rounded-lg transition-colors text-center"
              >
                EW 상신하기 (EW)
              </a>
              <a
                href="https://intra.univ.me/Approval/AprCreateDoc"
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => { setShowEwPopup(false); onSubmitSuccess() }}
                className="w-full px-4 py-2.5 text-sm font-medium text-white bg-warning-text hover:bg-warning-text/90 rounded-lg transition-colors text-center"
              >
                휴가 상신하기 (NPM)
              </a>
              <button
                onClick={() => { setShowEwPopup(false); onSubmitSuccess() }}
                className="w-full px-4 py-2.5 text-sm font-medium text-text-primary bg-surface-muted hover:bg-border rounded-lg transition-colors"
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}
      <form id="work-log-form" onSubmit={handleSubmit(onSubmit)} className="space-y-8 bg-surface p-6 sm:p-8 rounded-lg border border-border shadow-sm">

      {/* 1. 기본 정보 */}
      <div>
        <h3 className="text-lg leading-6 font-medium text-text-primary mb-4 border-b pb-2">기본 정보</h3>
        <div className="grid grid-cols-1 gap-y-6 gap-x-4 sm:grid-cols-2">
          {/* 이름은 userName prop으로 자동 세팅 — UI 노출 X.
              type="hidden" 대신 readOnly + sr-only로 RHF 동기화 안전 보장. */}
          <input
            type="text"
            {...register('name')}
            readOnly
            tabIndex={-1}
            aria-hidden
            className="sr-only"
          />

          <div>
            <label className="block text-sm font-medium text-text-primary">근무유형 *</label>
            <select
              {...register('workTypeLabel')}
              className="select-tight mt-1 block w-full rounded-md border-border-strong shadow-sm focus:border-primary-500 focus:ring-primary-500 sm:text-sm px-3 py-2 border bg-surface"
            >
              {dateCategory === 'sunday_or_holiday' && !formValues.workTypeLabel && (
                <option value="">— 근무유형을 선택해주세요 —</option>
              )}
              <option value="(평일) 기본 근무">(평일) 기본 근무</option>
              <option value="(평일) 간주 근무">(평일) 간주 근무</option>
              <option value="토요일 근무">토요일 근무</option>
              <option value="일요일·공휴일 근무 (선택)">일요일·공휴일 근무 (선택)</option>
              <option value="일요일·공휴일 근무 (필수)">일요일·공휴일 근무 (필수)</option>
              {/* 레거시 라벨은 defaultValues에서 자동 매핑되므로 select에는 노출 X.
                  혹시 매핑이 누락된 케이스에 대비한 안전장치로만 hidden 표시. */}
              {(formValues.workTypeLabel === '기본근무 등록' ||
                formValues.workTypeLabel === '간주근로 등록' ||
                formValues.workTypeLabel === '공휴일근로 등록') && (
                <option value={formValues.workTypeLabel}>
                  {formValues.workTypeLabel}
                </option>
              )}
            </select>
            {/* 일요일/공휴일 안내 — workType 미선택 시 잠금 알림 */}
            {dateCategory === 'sunday_or_holiday' && (
              <p className="mt-1 text-[12px] text-warning-text font-medium">
                {koreanHolidayName ? `오늘은 ${koreanHolidayName}입니다. ` : '오늘은 일요일입니다. '}
                근무유형을 먼저 선택해주세요.
              </p>
            )}
          </div>

          <div className="sm:col-span-2">
            <label className="block text-sm font-medium text-text-primary">퇴근일자 *</label>
            <div className="mt-1">
              <DateInputWithDow
                value={formValues.leaveDate}
                inputProps={register('leaveDate')}
                className="w-full sm:w-1/2"
              />
            </div>
            {errors.leaveDate && <p className="mt-1 text-sm text-danger-text">{errors.leaveDate.message as string}</p>}
          </div>
        </div>
      </div>

      {/* 2. 출퇴근 시간 + 근무장소 (퇴근보고 영역) — 종일 휴가 아닐 때만 */}
      {showCheckOutSections && !isAllDay && (
        <div>
          <h3 className="text-lg leading-6 font-medium text-text-primary mb-4 border-b pb-2">출퇴근 시간 / 근무장소</h3>
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div>
              <label className="block text-sm font-medium text-text-primary mb-1">출근시간 *</label>
              <HalfHourTimeSelect
                value={formValues.startTime ?? ''}
                onChange={(v) => setValue('startTime', v, { shouldValidate: true, shouldDirty: true })}
                ariaLabel="출근시간"
              />
              {(errors as { startTime?: { message?: string } }).startTime?.message && (
                <p className="mt-1 text-xs text-danger-text">
                  {(errors as { startTime?: { message?: string } }).startTime?.message}
                </p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-text-primary mb-1">실제 퇴근시간 *</label>
              <HalfHourTimeSelect
                value={formValues.endTime ?? ''}
                onChange={(v) => setValue('endTime', v, { shouldValidate: true, shouldDirty: true })}
                allowNextDay
                ariaLabel="실제 퇴근시간"
              />
              {(errors as { endTime?: { message?: string } }).endTime?.message && (
                <p className="mt-1 text-xs text-danger-text">
                  {(errors as { endTime?: { message?: string } }).endTime?.message}
                </p>
              )}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-text-primary mb-1">근무장소 *</label>
            <p className="text-xs text-text-secondary mb-2">
              하루 중 들른 장소를 순서대로 추가하세요. 시간과 무관합니다.
              {!isEditing && ' (출근보고에서 입력한 예정 장소가 미리 채워집니다.)'}
            </p>
            <WorkLocationChipsInput
              value={(formValues.actualWorkLocations ?? []) as WorkLocations}
              onChange={onActualLocsChange}
              errors={validateWorkLocations((formValues.actualWorkLocations ?? []) as WorkLocations)}
            />
            {!formValues.actualWorkLocationsTouched && (
              <p className="mt-1 text-[12px] text-text-muted">
                ※ 그대로 제출하면 출근 예정 장소와 동일하게 저장됩니다.
              </p>
            )}
          </div>
        </div>
      )}

      {/* 3. 휴게 및 근무내용 (퇴근보고 영역) — 휴게/휴가/근무내용 통합 */}
      {showCheckOutSections && (
      <div>
        <h3 className="text-lg leading-6 font-medium text-text-primary mb-4 border-b pb-2">휴게 및 근무내용</h3>
        <div className="grid grid-cols-1 gap-y-6 gap-x-4 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-text-primary">
              휴게시간 *
              <span className="ml-1 text-xs font-normal text-text-secondary">(점심 외 추가 휴게)</span>
            </label>
            <p className="mt-1 text-xs text-warning-text bg-warning-bg border border-warning-border rounded px-2 py-1.5">
              ☕ 점심 1시간은 근무유형에 따라 <strong>자동 처리</strong>됩니다 (기본/간주근로 = 1h, 공휴일근로 = 0). 여기에는 <strong>점심 외에 추가로 쉰 시간만</strong> 입력하세요. 없으면 0:00.
            </p>
            {breakAutoRoundedMinutes > 0 && (
              <p className="mt-1 mb-1 text-xs text-text-secondary">
                자동 계산 (휴게 시작/종료 로그): 실제 {breakAutoActualMinutes}분 / 30분 올림 {minutesToDisplay(breakAutoRoundedMinutes)}
                {breakUserChanged && <span className="ml-1 text-warning-text font-medium">— 수정됨</span>}
              </p>
            )}
            <select
              {...register('breakTime')}
              className="select-tight mt-1 block w-full rounded-md border-border-strong shadow-sm focus:border-primary-500 focus:ring-primary-500 sm:text-sm px-3 py-2 border bg-surface"
            >
              {/* 0:00 ~ 12:00 30분 단위 (총 25개) */}
              {Array.from({ length: 25 }).map((_, i) => {
                const totalMin = i * 30
                const h = Math.floor(totalMin / 60)
                const m = totalMin % 60
                const value = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
                let label: string
                if (totalMin === 0) label = '00:00 (추가 휴게 없음)'
                else if (h === 0) label = `${value} (${m}분)`
                else if (m === 0) label = `${value} (${h}시간)`
                else label = `${value} (${h}시간 ${m}분)`
                return <option key={value} value={value}>{label}</option>
              })}
            </select>
            {errors.breakTime && <p className="mt-1 text-sm text-danger-text">{errors.breakTime.message as string}</p>}
          </div>

          {showBreakReason && (
            <div>
              <label className="block text-sm font-medium text-text-primary">휴게사유</label>
              <input
                type="text"
                placeholder="예) 점심식사, 휴식"
                {...register('breakReason')}
                className="mt-1 block w-full rounded-md border-border-strong shadow-sm focus:border-primary-500 focus:ring-primary-500 sm:text-sm px-3 py-2 border"
              />
            </div>
          )}

          {/* 휴가/반차 — 위계 정리: 기존 별도 섹션에서 휴게/근무내용 섹션 안으로 이동 */}
          <div className="sm:col-span-2">
            <label className="block text-sm font-medium text-text-primary">휴가/반차</label>
            <p className="mt-1 mb-2 text-xs text-text-secondary">
              ※ 휴게와 동일한 차감 정책이 적용됩니다.
            </p>
            <LeaveTimelineInput
              value={(formValues.leaveTimeline ?? []) as LeaveTimeline}
              onChange={next => setValue('leaveTimeline', next, { shouldValidate: false, shouldDirty: true })}
            />
          </div>

          <div className="sm:col-span-2">
            <label className="block text-sm font-medium text-text-primary">근무내용 *</label>
            <textarea
              rows={2}
              placeholder="오늘 수행한 업무 내용을 입력해주세요"
              {...register('workContent')}
              className="mt-1 block w-full rounded-md border-border-strong shadow-sm focus:border-primary-500 focus:ring-primary-500 sm:text-sm px-3 py-2 border"
            />
            {errors.workContent && <p className="mt-1 text-sm text-danger-text">{errors.workContent.message as string}</p>}
          </div>
        </div>
      </div>
      )}

      {/* ─── 부가 영역 wrapper — 4(출근보고)/5(기타)를 묶어서 본문(1~3)과 시각 분리 ─── */}
      <div className="mt-8 pt-6 border-t-[3px] border-border-strong rounded-xl bg-background p-4 sm:p-6 -mx-1 sm:-mx-2 space-y-8">

      {/* 4. 출근보고 — showCheckInSections일 때만 표시 (퇴근보고 수정에서는 hidden 유지) */}
      {showCheckInSections && (
      <div>
        <h3 className="text-lg leading-6 font-medium text-text-primary mb-4 border-b pb-2">출근보고</h3>

        <div className="p-4 bg-surface-muted rounded-lg border border-border">
          <label className="block text-sm font-medium text-text-primary mb-1">출근보고 진행 여부</label>
          <p className="mb-2 text-xs text-warning-text">
            ※ 휴가자는 아래 출근보고에 <span className="font-medium">휴가 복귀날</span>을 선택 후 출근 보고 진행
          </p>
          <select
            {...register('attendanceRecordType')}
            className="select-tight block w-full sm:w-1/2 rounded-md border-border-strong shadow-sm focus:border-primary-500 focus:ring-primary-500 sm:text-sm px-3 py-2 border bg-surface"
          >
            <option value="출근보고 진행 (주말출근, 휴가 포함)">출근보고 진행 (주말출근, 휴가 포함)</option>
            <option value="스킵(누락퇴근보고, 퇴근보고 수정)">스킵(누락퇴근보고, 퇴근보고 수정)</option>
          </select>

          {formValues.attendanceRecordType === '출근보고 진행 (주말출근, 휴가 포함)' && (
            <div className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-medium text-text-secondary">출근 예정 날짜 *</label>
                <p className="text-xs text-text-muted mt-0.5">내일 출근 날짜를 입력해주세요</p>
                <div className="mt-1">
                  <DateInputWithDow
                    value={formValues.expectedStartDate}
                    inputProps={register('expectedStartDate')}
                    className="w-full sm:w-1/2"
                  />
                </div>
                {errors.expectedStartDate && <p className="mt-1 text-xs text-danger-text">{errors.expectedStartDate.message as string}</p>}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-text-secondary">출근예정시간 *</label>
                  <HalfHourTimeSelect
                    value={formValues.expectedStartTime ?? ''}
                    onChange={(v) => setValue('expectedStartTime', v, { shouldValidate: true, shouldDirty: true })}
                    ariaLabel="출근예정시간"
                  />
                  {(errors as { expectedStartTime?: { message?: string } }).expectedStartTime?.message && (
                    <p className="mt-1 text-xs text-danger-text">
                      {(errors as { expectedStartTime?: { message?: string } }).expectedStartTime?.message}
                    </p>
                  )}
                </div>
                <div>
                  <label className="block text-xs font-medium text-text-secondary">퇴근예정시간 *</label>
                  <HalfHourTimeSelect
                    value={formValues.expectedEndTime ?? ''}
                    onChange={(v) => setValue('expectedEndTime', v, { shouldValidate: true, shouldDirty: true })}
                    allowNextDay
                    ariaLabel="퇴근예정시간"
                  />
                  {(errors as { expectedEndTime?: { message?: string } }).expectedEndTime?.message && (
                    <p className="mt-1 text-xs text-danger-text">
                      {(errors as { expectedEndTime?: { message?: string } }).expectedEndTime?.message}
                    </p>
                  )}
                </div>
              </div>

              {/* 위계 정리: 근무장소가 다음 출근일 휴가여부 앞으로 */}
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1">근무장소 *</label>
                <p className="text-[12px] text-text-muted mb-2">
                  내일 들를 장소를 순서대로 추가하세요. 시간과 무관합니다.
                </p>
                <WorkLocationChipsInput
                  value={(formValues.plannedWorkLocations ?? []) as WorkLocations}
                  onChange={next => setValue('plannedWorkLocations', next, { shouldValidate: false, shouldDirty: true })}
                  errors={validateWorkLocations((formValues.plannedWorkLocations ?? []) as WorkLocations)}
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1">다음 출근일 휴가/반차</label>
                <LeaveTimelineInput
                  value={(formValues.expectedLeaveTimeline ?? []) as LeaveTimeline}
                  onChange={next => setValue('expectedLeaveTimeline', next, { shouldValidate: false, shouldDirty: true })}
                />
              </div>
            </div>
          )}
        </div>
      </div>
      )}

      {/* 5. 기타 — 지각/당일수정 + 감사 마카롱 */}
      <div>
        <h3 className="text-lg leading-6 font-medium text-text-primary mb-4 border-b pb-2">기타</h3>

        <div className="space-y-6">
          {showCheckOutSections && (
          <div className="p-4 bg-surface-muted rounded-lg border border-border">
            <label className="block text-sm font-medium text-text-primary mb-1">지각 or 출근 시간 입력 수정 여부</label>
            <p className="mb-2 text-xs text-warning-text">
              ※ 당일 수정 기준은 <span className="font-medium">당일 07시 이후</span>이며, 조기출근으로 인한 수정은 제외
            </p>
            <select
              {...register('lateOrAttendanceStatus')}
              className="select-tight block w-full sm:w-1/2 rounded-md border-border-strong shadow-sm focus:border-primary-500 focus:ring-primary-500 sm:text-sm px-3 py-2 border bg-surface"
            >
              <option value="아니오">아니오</option>
              <option value="예">예</option>
            </select>

            {formValues.lateOrAttendanceStatus === '예' && (
              <div className="mt-4 grid grid-cols-1 gap-y-4 gap-x-4 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-medium text-text-secondary">전일 출근보고 시간 *</label>
                  <TimeSelect
                    className="mt-1"
                    value={formValues.previousReportTime ?? ''}
                    onChange={(v) => setValue('previousReportTime', v, { shouldValidate: true, shouldDirty: true })}
                    ariaLabelHour="전일 출근보고 시"
                    ariaLabelMinute="전일 출근보고 분"
                  />
                  {errors.previousReportTime && <p className="mt-1 text-xs text-danger-text">{errors.previousReportTime.message as string}</p>}
                </div>
                <div>
                  <label className="block text-xs font-medium text-text-secondary">당일 실제 출퇴근 시간 *</label>
                  <TimeSelect
                    className="mt-1"
                    value={formValues.currentReportTime ?? ''}
                    onChange={(v) => setValue('currentReportTime', v, { shouldValidate: true, shouldDirty: true })}
                    ariaLabelHour="당일 실제 출퇴근 시"
                    ariaLabelMinute="당일 실제 출퇴근 분"
                  />
                  {errors.currentReportTime && <p className="mt-1 text-xs text-danger-text">{errors.currentReportTime.message as string}</p>}
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-text-secondary">지각/출근수정 사유 *</label>
                  <input type="text" {...register('lateReason')} className="mt-1 block w-full rounded-md border-border-strong shadow-sm focus:border-primary-500 focus:ring-primary-500 sm:text-sm px-3 py-2 border" />
                  {errors.lateReason && <p className="mt-1 text-xs text-danger-text">{errors.lateReason.message as string}</p>}
                </div>
              </div>
            )}
          </div>
          )}

          <div>
            <label className="block text-sm font-medium text-text-primary">감사 마카롱 메시지 (선택)</label>
            <textarea
              rows={2}
              placeholder="동료에게 전하고 싶은 감사 메시지를 적어주세요!"
              {...register('thanksMacaron')}
              className="mt-1 block w-full rounded-md border-border-strong shadow-sm focus:border-primary-500 focus:ring-primary-500 sm:text-sm px-3 py-2 border"
            />
          </div>
        </div>
      </div>

      </div>
      {/* ─── 부가 영역 wrapper 끝 ─── */}

      {submitError && (
        <div className="rounded-md bg-danger-bg p-4">
          <h3 className="text-sm font-medium text-danger-text">{submitError}</h3>
        </div>
      )}

    </form>
    </>
  )
}
