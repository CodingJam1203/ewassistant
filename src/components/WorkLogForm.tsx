'use client'

import { useEffect, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import * as z from 'zod'
import { calculateEw, EwCalculationResult } from '@/lib/ew-calculator'
import { Loader2, Copy } from 'lucide-react'
import { format, addDays } from 'date-fns'
import { getKstTodayDateString, toKstDateString } from '@/lib/utils/date'
import WorkLocationTimelineInput, { defaultTimeline, defaultCheckoutTimeline } from '@/components/WorkLocationTimelineInput'
import LeaveTimelineInput from '@/components/LeaveTimelineInput'
import {
  validateTimeline,
  firstWorkLocation,
  endItemOf,
  displayLocation,
  buildLocationSummary,
  legacyToTimeline,
} from '@/lib/work-location-timeline'
import {
  validateLeaveTimeline,
  totalLeaveRoundedMinutes,
  isFullDayLeave,
  ceilTo30Min,
  minutesToDisplay,
} from '@/lib/leave-timeline'
import type { WorkLocationTimeline } from '@/types/work-location-timeline'
import type { LeaveTimeline } from '@/types/leave-timeline'
import type { WorkLog } from '@/types/work-log'

const workLocationItemZ = z.object({
  kind: z.literal('work_location'),
  type: z.enum(['office', 'remote', 'field', 'custom']),
  label: z.string(),
  customLabel: z.string().nullable(),
  startTime: z.string(),
})
const expectedCheckoutZ = z.object({
  kind: z.literal('expected_checkout'),
  startTime: z.string(),
})
const checkoutZ = z.object({
  kind: z.literal('checkout'),
  startTime: z.string(),
})
const timelineEntryZ = z.discriminatedUnion('kind', [workLocationItemZ, expectedCheckoutZ, checkoutZ])

// 휴가 항목 zod 스키마
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
  workTypeLabel: z.enum(['기본근무 등록', '간주근로 등록', '공휴일근로 등록']),
  leaveDate: z.string().min(1, '퇴근일자를 입력해주세요'),
  // 본문 근무장소 타임라인 (마지막은 'checkout' = 실제 퇴근)
  workLocationTimeline: z.array(timelineEntryZ).optional(),
  // 본문 휴가/반차 타임라인
  leaveTimeline: z.array(leaveItemZ).optional(),
  breakTime: z.string().min(1, '휴게시간을 선택해주세요'),
  breakReason: z.string().optional(),
  workContent: z.string().min(1, '근무내용을 입력해주세요'),
  lateOrAttendanceStatus: z.enum(['아니오', '예']),
  previousReportTime: z.string().optional(),
  currentReportTime: z.string().optional(),
  lateReason: z.string().optional(),
  attendanceRecordType: z.enum(['출근보고 진행 (주말출근, 휴가 포함)', '스킵(누락퇴근보고, 퇴근보고 수정)']),
  expectedStartDate: z.string().optional(),
  // 다음 출근 예정 타임라인 (마지막은 'expected_checkout' = 퇴근예정)
  expectedTimeline: z.array(timelineEntryZ).optional(),
  // 다음 출근 예정 휴가/반차
  expectedLeaveTimeline: z.array(leaveItemZ).optional(),
  thanksMacaron: z.string().optional(),
  sendTeams: z.boolean().optional(),
}).superRefine((data, ctx) => {
  const leaveTl = (data.leaveTimeline ?? []) as LeaveTimeline
  const isAllDay = isFullDayLeave(leaveTl)

  // 휴가 자체 검증
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

  // 본문 근무장소 타임라인 검증 — 종일 휴가일 때는 비어있어도 OK
  const wlTl = (data.workLocationTimeline ?? []) as WorkLocationTimeline
  if (!isAllDay) {
    const wlTimelineErrors = validateTimeline(wlTl)
    wlTimelineErrors.forEach(err => {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: err.message,
        path: typeof err.index === 'number'
          ? ['workLocationTimeline', err.index]
          : ['workLocationTimeline'],
      })
    })
    if (wlTl.length > 0 && wlTl[wlTl.length - 1].kind !== 'checkout') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: '퇴근보고의 마지막 항목은 퇴근(실제) 시간이어야 합니다.',
        path: ['workLocationTimeline'],
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
    const tlErrors = validateTimeline((data.expectedTimeline ?? []) as WorkLocationTimeline)
    tlErrors.forEach(err => {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: err.message,
        path: typeof err.index === 'number'
          ? ['expectedTimeline', err.index]
          : ['expectedTimeline'],
      })
    })
    // 다음 출근 예정의 마지막은 'expected_checkout'
    const exTl = (data.expectedTimeline ?? []) as WorkLocationTimeline
    if (exTl.length > 0 && exTl[exTl.length - 1].kind !== 'expected_checkout') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: '다음 출근 예정의 마지막 항목은 퇴근예정 시간이어야 합니다.',
        path: ['expectedTimeline'],
      })
    }
  }
})

export type WorkLogFormData = z.infer<typeof formSchema>

interface WorkLogFormProps {
  userName: string | null
  /** 퇴근보고 모달 진입 시 미리 받아온 오늘의 work_location_timeline (마지막은 'checkout') */
  initialTimeline?: WorkLocationTimeline | null
  /** 오늘의 leave_timeline (휴가/반차) — WorkLogModal hydration */
  initialLeaveTimeline?: LeaveTimeline | null
  /** 휴게 시작/종료 로그 누적 실제 분 */
  initialBreakAutoActualMinutes?: number | null
  /** legacy: timeline이 없을 때만 사용. 첫 work_location.startTime으로 prefill */
  initialStartTime?: string
  /** legacy: timeline이 없을 때만 사용. checkout.startTime으로 prefill */
  initialEndTime?: string
  resubmitLogId?: string | null
  /**
   * 수정 모드 — 기존 work_log를 받아 모든 폼 필드를 prefill하고
   * 제출 시 PATCH /api/work-logs/{id}를 호출.
   * resubmitLogId와 동시에 줄 수 없음 (편집은 별도 흐름).
   */
  editingLog?: WorkLog | null
  onCalculate: (result: EwCalculationResult | null, error: string | null) => void
  onSubmitSuccess: () => void
}

/** 'HH:mm[:ss]' → 'HH:mm' (5자) */
function trimToHHmm(t: string | undefined | null): string {
  if (!t) return ''
  return t.slice(0, 5)
}

/** initial props로 본문 timeline 기본값 결정 */
function buildInitialTimeline(
  initialTimeline?: WorkLocationTimeline | null,
  initialStartTime?: string,
  initialEndTime?: string,
): WorkLocationTimeline {
  if (Array.isArray(initialTimeline) && initialTimeline.length > 0) {
    // 마지막 항목이 expected_checkout이면 checkout으로 변환
    const arr = [...initialTimeline]
    const last = arr[arr.length - 1]
    if (last.kind === 'expected_checkout') {
      arr[arr.length - 1] = { kind: 'checkout', startTime: last.startTime }
    }
    return arr
  }
  // legacy: 단일 항목 timeline 합성
  const start = trimToHHmm(initialStartTime) || '09:00'
  const end   = trimToHHmm(initialEndTime)   || '18:00'
  const synth = legacyToTimeline({
    expectedWorkLocation: '사무실',
    expectedWorkLocationType: '사무실',
    expectedWorkTime: start,
    fallbackCheckoutTime: end,
    asExpected: false, // 퇴근보고 모드 → checkout
  })
  return synth ?? defaultCheckoutTimeline()
}

/** editingLog → 본문 timeline (legacy 데이터에서 work_location_type/_custom 활용) */
function buildEditTimeline(log: WorkLog): WorkLocationTimeline {
  if (Array.isArray(log.work_location_timeline) && log.work_location_timeline.length > 0) {
    const arr = [...log.work_location_timeline]
    const last = arr[arr.length - 1]
    if (last.kind === 'expected_checkout') {
      arr[arr.length - 1] = { kind: 'checkout', startTime: last.startTime }
    }
    return arr
  }
  const start = trimToHHmm(log.start_time) || '09:00'
  const end   = trimToHHmm(log.end_time)   || '18:00'
  const synth = legacyToTimeline({
    expectedWorkLocation:     log.work_location_custom ?? log.work_location ?? null,
    expectedWorkLocationType: log.work_location_type ?? log.work_location ?? null,
    expectedWorkTime:         start,
    fallbackCheckoutTime:     end,
    asExpected: false,
  })
  return synth ?? defaultCheckoutTimeline()
}

export default function WorkLogForm({
  userName,
  initialTimeline,
  initialLeaveTimeline,
  initialBreakAutoActualMinutes,
  initialStartTime,
  initialEndTime,
  resubmitLogId,
  editingLog,
  onCalculate,
  onSubmitSuccess,
}: WorkLogFormProps) {
  const isEditing = !!editingLog

  // 휴게 자동값 — 수정 모드면 editingLog의 값 우선
  const breakAutoActualMinutes = isEditing
    ? (editingLog?.break_auto_actual_minutes ?? 0)
    : (initialBreakAutoActualMinutes ?? 0)
  const breakAutoRoundedMinutes = ceilTo30Min(breakAutoActualMinutes)
  /** 자동 계산값을 'HH:mm'으로 표현 (폼 default용) */
  const breakAutoHHmm = (() => {
    const m = breakAutoRoundedMinutes
    const h = Math.floor(m / 60)
    const mm = m % 60
    return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
  })()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [showEwPopup, setShowEwPopup] = useState(false)
  const nameDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // 최초 자동완성 여부 추적 (userName prop이 로드되면 한 번만 setValue)
  const nameInitialized = useRef(false)

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
          // 수정 모드 — editingLog의 모든 필드 prefill
          name: editingLog.name,
          workTypeLabel: (
            editingLog.work_type_label === '간주근로 등록' || editingLog.work_type_label === '공휴일근로 등록'
              ? editingLog.work_type_label
              : '기본근무 등록'
          ) as '기본근무 등록' | '간주근로 등록' | '공휴일근로 등록',
          leaveDate: editingLog.leave_date,
          workLocationTimeline: buildEditTimeline(editingLog),
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
          expectedTimeline: (editingLog.expected_work_location_timeline ?? defaultTimeline()) as WorkLocationTimeline,
          expectedLeaveTimeline: (editingLog.expected_leave_timeline ?? []) as LeaveTimeline,
          thanksMacaron: (editingLog.thanks_macaron as string | null) ?? '',
          sendTeams: true,
        }
      : {
          // 신규 작성 모드
          name: userName || '',
          workTypeLabel: '기본근무 등록',
          leaveDate: getKstTodayDateString(),
          workLocationTimeline: buildInitialTimeline(initialTimeline, initialStartTime, initialEndTime),
          leaveTimeline: (initialLeaveTimeline ?? []) as LeaveTimeline,
          // 휴게 자동값이 있으면 그것을 기본값으로, 없으면 00:00
          breakTime: breakAutoRoundedMinutes > 0 ? breakAutoHHmm : '00:00',
          workContent: '',
          lateOrAttendanceStatus: '아니오',
          // 퇴근보고 모달 default — '출근보고 진행' (다음 출근 사전 보고를 자연스럽게 유도).
          // 단 expectedStartDate는 빈칸으로 두고 사용자가 직접 입력 (zod 필수 검증) →
          // 사용자가 의식하지 않으면 통과 안 되므로 가짜 다른날 row 방지.
          // (출근 경로/CheckInModal에서 만들어진 record는 서버에서 '스킵'으로 저장됨)
          attendanceRecordType: '출근보고 진행 (주말출근, 휴가 포함)',
          expectedStartDate: '',
          expectedTimeline: defaultTimeline(),
          expectedLeaveTimeline: [] as LeaveTimeline,
          sendTeams: true,
        },
  })

  const formValues = watch()

  // 본문 timeline에서 출근/퇴근 시간 / 근무장소 도출
  const workTimeline = (formValues.workLocationTimeline ?? []) as WorkLocationTimeline
  const firstWL = firstWorkLocation(workTimeline)
  const endIt = endItemOf(workTimeline)
  const derivedStartTime = firstWL?.startTime ?? ''
  const derivedEndTime = endIt?.startTime ?? ''
  const derivedWorkLocationSummary = buildLocationSummary(workTimeline)

  // 휴가 관련 도출값 — 점심 중복 방지는 사용자가 차감시간을 직접 조정하므로 자동 처리 안 함
  const leaveTl = (formValues.leaveTimeline ?? []) as LeaveTimeline
  const leaveMinutesTotal = totalLeaveRoundedMinutes(leaveTl)
  const isAllDay = isFullDayLeave(leaveTl)

  // 휴게사유 표시 여부: 휴게시간 30분 이상
  const showBreakReason = formValues.breakTime && formValues.breakTime !== '00:00'

  // 휴게 사용자 수정 여부 — 자동 계산값과 다르면 manual로 간주
  const breakUserChanged = (formValues.breakTime ?? '00:00') !== breakAutoHHmm && breakAutoRoundedMinutes > 0

  // ── userName prop이 비동기로 로드되면 이름 필드에 자동완성 (최초 1회) ───────
  // 수정 모드에서는 editingLog.name이 이미 prefill됐으므로 덮어쓰지 않음
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

  // ── 이름 필드 변경 시 debounce로 display_name 자동 업데이트 (800ms) ────────
  // 수정 모드에서는 historical record 이름을 바꾼다고 사용자 프로필을 갱신하면 안 되므로 스킵
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
        // 실패해도 무시 (폼 입력에 영향 없음)
      }
    }, 800)

    return () => {
      if (nameDebounceRef.current) clearTimeout(nameDebounceRef.current)
    }
  }, [formValues.name, isEditing]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    try {
      const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/
      // 종일 휴가일 땐 work_location 시간 검증을 스킵하고 09:00~18:00을 가정
      const calcStart = isAllDay ? '09:00' : derivedStartTime
      const calcEnd   = isAllDay ? '18:00' : derivedEndTime
      const calcLocation = isAllDay ? '휴가' : (derivedWorkLocationSummary || '사무실')

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
          // leaveIncludesLunch는 사용자가 차감시간을 직접 조정하므로 항상 false (점심 자동 차감 그대로)
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
    derivedStartTime, derivedEndTime, derivedWorkLocationSummary,
    formValues.breakTime, formValues.workContent, formValues.breakReason,
    leaveMinutesTotal, isAllDay,
    onCalculate, showBreakReason
  ])

  const onSubmit = async (data: WorkLogFormData) => {
    setIsSubmitting(true)
    setSubmitError(null)

    try {
      const submittedLeave = (data.leaveTimeline ?? []) as LeaveTimeline
      const submittedIsAllDay = isFullDayLeave(submittedLeave)
      const submittedLeaveMinutes = totalLeaveRoundedMinutes(submittedLeave)

      const submittedTimeline = (data.workLocationTimeline ?? []) as WorkLocationTimeline
      const submittedFirst = firstWorkLocation(submittedTimeline)
      const submittedEnd = endItemOf(submittedTimeline)
      // 종일 휴가일 때는 09:00~18:00 가정 (EW/legacy mirror용)
      const submittedStartTime = submittedIsAllDay ? '09:00' : (submittedFirst?.startTime ?? '09:00')
      const submittedEndTime   = submittedIsAllDay ? '18:00' : (submittedEnd?.startTime ?? '18:00')
      const submittedWorkLocation = submittedIsAllDay
        ? '휴가'
        : (submittedFirst ? displayLocation(submittedFirst) : '사무실')
      const submittedLocationSummary = submittedIsAllDay
        ? '휴가'
        : (buildLocationSummary(submittedTimeline) || submittedWorkLocation)

      // 휴게: manual = breakTime, auto = breakAutoRoundedMinutes
      const breakManualHHmm = data.breakTime || '00:00'
      const [bH, bM] = breakManualHHmm.split(':').map(Number)
      const breakManualMinutes = (Number.isFinite(bH) ? bH : 0) * 60 + (Number.isFinite(bM) ? bM : 0)
      const breakIsManual = breakManualMinutes !== breakAutoRoundedMinutes
      const breakFinalRoundedMinutes = breakManualMinutes  // 화면값이 곧 최종 반영값

      // 브라우저 포커스 유실을 방지하기 위해 비동기 API 통신 전 클립보드 복사를 먼저 실행합니다.
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
        // leaveIncludesLunch 자동 처리 안 함 — 사용자가 차감시간 직접 조정
      })

      try {
        await navigator.clipboard.writeText(result.copyText)
      } catch (err) {
        console.warn('Clipboard write failed:', err)
      }

      // 수정 모드 vs 신규 작성 모드 분기
      const url = isEditing && editingLog
        ? `/api/work-logs/${editingLog.id}`
        : '/api/work-logs'
      const method = isEditing ? 'PATCH' : 'POST'

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...data,
          // 서버 호환: timeline에서 도출된 값을 함께 전달
          workLocationTimeline: submittedTimeline,
          leaveTimeline: submittedLeave,
          startTime: submittedStartTime,
          endTime: submittedEndTime,
          workLocationType: submittedFirst?.type === 'custom' ? '기타' : (submittedFirst?.label ?? '사무실'),
          workLocationCustom: submittedFirst?.type === 'custom' ? (submittedFirst.customLabel ?? '') : '',
          finalWorkLocation: submittedWorkLocation,
          workLocation: submittedWorkLocation, // PATCH legacy fallback 호환
          // 휴게 분리 값
          breakAutoActualMinutes: breakAutoActualMinutes,
          breakAutoRoundedMinutes: breakAutoRoundedMinutes,
          breakManualRoundedMinutes: breakIsManual ? breakManualMinutes : null,
          breakFinalRoundedMinutes: breakFinalRoundedMinutes,
          // 수정 모드에서는 resubmitLogId 안 씀 (별도 흐름)
          resubmitLogId: isEditing ? null : resubmitLogId,
        }),
      })

      const resData = await res.json()

      if (!res.ok) {
        throw new Error(resData.error || '제출에 실패했습니다.')
      }

      setShowEwPopup(true)
      // onSubmitSuccess는 팝업 버튼 클릭 후 호출 (팝업이 닫히면서 호출)
    } catch (err: any) {
      setSubmitError(err.message)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <>
      {showEwPopup && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 px-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">EW 페이지로 이동할까요?</h3>
            <p className="text-sm text-gray-600 mb-6">
              복사한 내용을 Enjoy Working 페이지에 붙여넣어 등록할 수 있습니다.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => { setShowEwPopup(false); onSubmitSuccess() }}
                className="flex-1 px-4 py-2.5 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
              >
                취소
              </button>
              <a
                href="https://working.univ.me/Home"
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => { setShowEwPopup(false); onSubmitSuccess() }}
                className="flex-1 px-4 py-2.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors text-center"
              >
                이동하기
              </a>
            </div>
          </div>
        </div>
      )}
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-8 bg-white p-6 sm:p-8 rounded-lg border border-gray-200 shadow-sm">

      {/* 1. 기본 정보 섹션 */}
      <div>
        <h3 className="text-lg leading-6 font-medium text-gray-900 mb-4 border-b pb-2">기본 정보</h3>
        <div className="grid grid-cols-1 gap-y-6 gap-x-4 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-gray-700">이름 *</label>
            <input
              type="text"
              {...register('name')}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm px-3 py-2 border"
            />
            {errors.name && <p className="mt-1 text-sm text-red-600">{errors.name.message as string}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">근무유형 *</label>
            <select
              {...register('workTypeLabel')}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm px-3 py-2 border bg-white"
            >
              <option value="기본근무 등록">기본근무 등록</option>
              <option value="간주근로 등록">간주근로 등록</option>
              <option value="공휴일근로 등록">공휴일근로 등록</option>
            </select>
          </div>

          <div className="sm:col-span-2">
            <label className="block text-sm font-medium text-gray-700">퇴근일자 *</label>
            <input
              type="date"
              {...register('leaveDate')}
              className="mt-1 block w-full sm:w-1/2 rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm px-3 py-2 border"
            />
            {errors.leaveDate && <p className="mt-1 text-sm text-red-600">{errors.leaveDate.message as string}</p>}
          </div>
        </div>
      </div>

      {/* 2. 휴가/반차 */}
      <div>
        <h3 className="text-lg leading-6 font-medium text-gray-900 mb-4 border-b pb-2">휴가/반차</h3>
        <LeaveTimelineInput
          value={(formValues.leaveTimeline ?? []) as LeaveTimeline}
          onChange={next => setValue('leaveTimeline', next, { shouldValidate: false, shouldDirty: true })}
        />
        {(errors as { leaveTimeline?: { message?: string } }).leaveTimeline?.message && (
          <p className="mt-1 text-xs text-red-600">
            {(errors as { leaveTimeline?: { message?: string } }).leaveTimeline?.message}
          </p>
        )}
      </div>

      {/* 3. 근무장소 타임라인 — 종일 휴가가 아닐 때만 노출 */}
      {!isAllDay && (
        <div>
          <h3 className="text-lg leading-6 font-medium text-gray-900 mb-4 border-b pb-2">근무장소 타임라인</h3>
          <p className="text-xs text-gray-500 mb-3">
            하루 안에 여러 장소에서 근무한 경우 <span className="font-medium">근무장소 추가</span>로 행을 늘리고, 마지막 항목에 <span className="font-medium">실제 퇴근 시간</span>을 입력하세요. 시간은 30분 단위입니다.
          </p>
          <p className="text-xs text-gray-400 mb-3">
            ※ 첫 항목 시각이 출근시간, 마지막 <span className="font-medium">퇴근</span> 항목 시각이 퇴근시간으로 EW 계산에 사용됩니다.
          </p>
          <WorkLocationTimelineInput
            value={(formValues.workLocationTimeline ?? []) as WorkLocationTimeline}
            onChange={next => setValue('workLocationTimeline', next, { shouldValidate: false, shouldDirty: true })}
            errors={validateTimeline((formValues.workLocationTimeline ?? []) as WorkLocationTimeline)}
          />
          {(errors as { workLocationTimeline?: { message?: string } }).workLocationTimeline?.message && (
            <p className="mt-1 text-xs text-red-600">
              {(errors as { workLocationTimeline?: { message?: string } }).workLocationTimeline?.message}
            </p>
          )}
        </div>
      )}

      {/* 3. 휴게/근무내용 섹션 */}
      <div>
        <h3 className="text-lg leading-6 font-medium text-gray-900 mb-4 border-b pb-2">휴게 및 근무내용</h3>
        <div className="grid grid-cols-1 gap-y-6 gap-x-4 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-gray-700">휴게시간 *</label>
            {breakAutoRoundedMinutes > 0 && (
              <p className="mt-1 mb-1 text-xs text-gray-500">
                자동 계산 (휴게 시작/종료 로그): 실제 {breakAutoActualMinutes}분 / 30분 올림 {minutesToDisplay(breakAutoRoundedMinutes)}
                {breakUserChanged && <span className="ml-1 text-amber-600 font-medium">— 수정됨</span>}
              </p>
            )}
            <select
              {...register('breakTime')}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm px-3 py-2 border bg-white"
            >
              <option value="00:00">00:00 (휴게 없음)</option>
              <option value="00:30">00:30 (30분)</option>
              <option value="01:00">01:00 (1시간)</option>
              <option value="01:30">01:30 (1시간 30분)</option>
              <option value="02:00">02:00 (2시간)</option>
              <option value="02:30">02:30 (2시간 30분)</option>
              <option value="03:00">03:00 (3시간)</option>
            </select>
            {errors.breakTime && <p className="mt-1 text-sm text-red-600">{errors.breakTime.message as string}</p>}
          </div>

          {/* 휴게사유: 휴게시간 30분 이상일 때만 표시 */}
          {showBreakReason && (
            <div>
              <label className="block text-sm font-medium text-gray-700">휴게사유</label>
              <input
                type="text"
                placeholder="예) 점심식사, 휴식"
                {...register('breakReason')}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm px-3 py-2 border"
              />
            </div>
          )}

          <div className="sm:col-span-2">
            <label className="block text-sm font-medium text-gray-700">근무내용 *</label>
            <textarea
              rows={2}
              placeholder="오늘 수행한 업무 내용을 입력해주세요"
              {...register('workContent')}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm px-3 py-2 border"
            />
            {errors.workContent && <p className="mt-1 text-sm text-red-600">{errors.workContent.message as string}</p>}
          </div>
        </div>
      </div>

      {/* 4. 추가 확인 섹션 (조건부) */}
      <div>
        <h3 className="text-lg leading-6 font-medium text-gray-900 mb-4 border-b pb-2">추가 보고 사항</h3>

        <div className="space-y-6">
          {/* 지각 / 출근시간 수정 여부 */}
          <div className="p-4 bg-gray-50 rounded-lg border border-gray-100">
            <label className="block text-sm font-medium text-gray-700 mb-1">지각 or 출근 시간 입력 수정 여부</label>
            <p className="mb-2 text-xs text-amber-600">
              ※ 당일 수정 기준은 <span className="font-medium">당일 07시 이후</span>이며, 초기출근으로 인한 수정은 제외
            </p>
            <select
              {...register('lateOrAttendanceStatus')}
              className="block w-full sm:w-1/2 rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm px-3 py-2 border bg-white"
            >
              <option value="아니오">아니오</option>
              <option value="예">예</option>
            </select>

            {formValues.lateOrAttendanceStatus === '예' && (
              <div className="mt-4 grid grid-cols-1 gap-y-4 gap-x-4 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-medium text-gray-500">전일 출근보고 시간 *</label>
                  <input type="time" {...register('previousReportTime')} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm px-3 py-2 border" />
                  {errors.previousReportTime && <p className="mt-1 text-xs text-red-600">{errors.previousReportTime.message as string}</p>}
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500">당일 실제 출퇴근 시간 *</label>
                  <input type="time" {...register('currentReportTime')} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm px-3 py-2 border" />
                  {errors.currentReportTime && <p className="mt-1 text-xs text-red-600">{errors.currentReportTime.message as string}</p>}
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-gray-500">지각/출근수정 사유 *</label>
                  <input type="text" {...register('lateReason')} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm px-3 py-2 border" />
                  {errors.lateReason && <p className="mt-1 text-xs text-red-600">{errors.lateReason.message as string}</p>}
                </div>
              </div>
            )}
          </div>

          {/* 출근기록 선택 */}
          <div className="p-4 bg-gray-50 rounded-lg border border-gray-100">
            <label className="block text-sm font-medium text-gray-700 mb-1">출근기록 선택 (유형)</label>
            <p className="mb-2 text-xs text-amber-600">
              ※ 휴가자는 아래 출근보고에 <span className="font-medium">휴가 복귀날</span>을 선택 후 출근 보고 진행
            </p>
            <select
              {...register('attendanceRecordType')}
              className="block w-full sm:w-1/2 rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm px-3 py-2 border bg-white"
            >
              <option value="출근보고 진행 (주말출근, 휴가 포함)">출근보고 진행 (주말출근, 휴가 포함)</option>
              <option value="스킵(누락퇴근보고, 퇴근보고 수정)">스킵(누락퇴근보고, 퇴근보고 수정)</option>
            </select>

            {formValues.attendanceRecordType === '출근보고 진행 (주말출근, 휴가 포함)' && (
              <div className="mt-4 space-y-4">
                <div>
                  <label className="block text-xs font-medium text-gray-500">출근 예정 날짜 *</label>
                  <p className="text-xs text-gray-400 mt-0.5">내일 출근 날짜를 입력해주세요</p>
                  <input type="date" {...register('expectedStartDate')} className="mt-1 block w-full sm:w-1/2 rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm px-3 py-2 border" />
                  {errors.expectedStartDate && <p className="mt-1 text-xs text-red-600">{errors.expectedStartDate.message as string}</p>}
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">다음 출근일 휴가/반차</label>
                  <LeaveTimelineInput
                    value={(formValues.expectedLeaveTimeline ?? []) as LeaveTimeline}
                    onChange={next => setValue('expectedLeaveTimeline', next, { shouldValidate: false, shouldDirty: true })}
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">근무장소 타임라인 *</label>
                  <p className="text-xs text-gray-400 mb-2">
                    하루 안에 여러 장소에서 근무하는 경우 <span className="font-medium">근무장소 추가</span>로 행을 늘리고, 마지막에 <span className="font-medium">퇴근예정</span> 시간을 입력하세요.
                  </p>
                  <WorkLocationTimelineInput
                    value={(formValues.expectedTimeline ?? defaultTimeline()) as WorkLocationTimeline}
                    onChange={next => setValue('expectedTimeline', next, { shouldValidate: false, shouldDirty: true })}
                    errors={validateTimeline((formValues.expectedTimeline ?? []) as WorkLocationTimeline)}
                  />
                  {/* zod 단계의 array 레벨 에러 (제출 시점) */}
                  {(errors as { expectedTimeline?: { message?: string } }).expectedTimeline?.message && (
                    <p className="mt-1 text-xs text-red-600">
                      {(errors as { expectedTimeline?: { message?: string } }).expectedTimeline?.message}
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="sm:col-span-2">
            <label className="block text-sm font-medium text-gray-700">감사 마카롱 메시지 (선택)</label>
            <textarea
              rows={2}
              placeholder="동료에게 전하고 싶은 감사 메시지를 적어주세요!"
              {...register('thanksMacaron')}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm px-3 py-2 border"
            />
          </div>
        </div>
      </div>

      {/* 4. 제출 옵션 — TODO: Teams 연동 권한 확보 후 주석 해제 */}
      {/* <div className="relative flex items-start pt-4 border-t border-gray-200">
        <div className="flex h-5 items-center">
          <input
            id="sendTeams"
            type="checkbox"
            {...register('sendTeams')}
            className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
        </div>
        <div className="ml-3 text-sm">
          <label htmlFor="sendTeams" className="font-medium text-gray-700">
            제출 후 Teams 발송
          </label>
          <p className="text-gray-500">기록 제출과 함께 Teams 채널로 메시지를 발송합니다.</p>
        </div>
      </div> */}

      {submitError && (
        <div className="rounded-md bg-red-50 p-4">
          <h3 className="text-sm font-medium text-red-800">{submitError}</h3>
        </div>
      )}

      <div className="pt-5">
        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full flex justify-center items-center py-4 px-4 border border-transparent rounded-md shadow-sm text-base font-bold text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
        >
          {isSubmitting ? (
            <Loader2 className="animate-spin h-5 w-5 mr-2" />
          ) : (
            <Copy className="h-5 w-5 mr-2" />
          )}
          {isSubmitting ? '제출 중...' : '제출 및 복사하기'}
        </button>
      </div>
    </form>
    </>
  )
}
