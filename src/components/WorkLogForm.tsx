'use client'

import { useEffect, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import * as z from 'zod'
import { calculateEw, EwCalculationResult } from '@/lib/ew-calculator'
import { Loader2, Copy } from 'lucide-react'
import { format, addDays } from 'date-fns'

const formSchema = z.object({
  name: z.string().min(1, '이름을 입력해주세요'),
  workTypeLabel: z.enum(['기본근무 등록', '간주근로 등록', '공휴일근로 등록']),
  leaveDate: z.string().min(1, '퇴근일자를 입력해주세요'),
  startTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'HH:mm 형식으로 입력해주세요'),
  endTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'HH:mm 형식으로 입력해주세요'),
  breakTime: z.string().min(1, '휴게시간을 선택해주세요'),
  breakReason: z.string().optional(),
  workContent: z.string().min(1, '근무내용을 입력해주세요'),
  workLocationType: z.enum(['사무실', '외근', '재택', '기타']),
  workLocationCustom: z.string().optional(),
  lateOrAttendanceStatus: z.enum(['아니오', '예']),
  previousReportTime: z.string().optional(),
  currentReportTime: z.string().optional(),
  lateReason: z.string().optional(),
  attendanceRecordType: z.enum(['출근보고 진행 (주말출근, 휴가 포함)', '스킵(누락퇴근보고, 퇴근보고 수정)']),
  expectedStartDate: z.string().optional(),
  expectedWorkTime: z.string().optional(),
  expectedWorkLocationType: z.enum(['사무실', '재택', '외근', '기타']).optional(),
  expectedWorkLocation: z.string().optional(),
  thanksMacaron: z.string().optional(),
  sendTeams: z.boolean().optional(),
}).superRefine((data, ctx) => {
  if (data.workLocationType === '기타' && !data.workLocationCustom) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: '근무장소를 입력해주세요', path: ['workLocationCustom'] })
  }
  if (data.lateOrAttendanceStatus === '예') {
    if (!data.previousReportTime) ctx.addIssue({ code: z.ZodIssueCode.custom, message: '필수 입력', path: ['previousReportTime'] })
    if (!data.currentReportTime) ctx.addIssue({ code: z.ZodIssueCode.custom, message: '필수 입력', path: ['currentReportTime'] })
    if (!data.lateReason) ctx.addIssue({ code: z.ZodIssueCode.custom, message: '필수 입력', path: ['lateReason'] })
  }
  if (data.attendanceRecordType === '출근보고 진행 (주말출근, 휴가 포함)') {
    if (!data.expectedStartDate) ctx.addIssue({ code: z.ZodIssueCode.custom, message: '필수 입력', path: ['expectedStartDate'] })
    if (!data.expectedWorkTime) ctx.addIssue({ code: z.ZodIssueCode.custom, message: '필수 입력', path: ['expectedWorkTime'] })
    if (!data.expectedWorkLocationType) ctx.addIssue({ code: z.ZodIssueCode.custom, message: '필수 입력', path: ['expectedWorkLocationType'] })
    if (data.expectedWorkLocationType === '기타' && !data.expectedWorkLocation) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: '상세 장소를 입력해주세요', path: ['expectedWorkLocation'] })
    }
  }
})

export type WorkLogFormData = z.infer<typeof formSchema>

interface WorkLogFormProps {
  userName: string | null
  initialStartTime?: string   // 퇴근 버튼 → 기존 출근보고 start_time pre-fill
  initialEndTime?: string     // 퇴근 버튼 → 기존 출근보고 end_time pre-fill
  onCalculate: (result: EwCalculationResult | null, error: string | null) => void
  onSubmitSuccess: () => void
}

const generateTimeOptions = (startHour: number) => {
  const options = []
  for (let i = 0; i < 48; i++) {
    const totalMinutes = (startHour * 60) + (i * 30)
    const normalizedMinutes = totalMinutes % (24 * 60)
    const hour = Math.floor(normalizedMinutes / 60)
    const minute = normalizedMinutes % 60
    const value = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`
    options.push(value)
  }
  return options
}

const startTimeOptions = generateTimeOptions(6)
const endTimeOptions = generateTimeOptions(16)

export default function WorkLogForm({ userName, initialStartTime, initialEndTime, onCalculate, onSubmitSuccess }: WorkLogFormProps) {
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
    defaultValues: {
      name: userName || '',
      workTypeLabel: '기본근무 등록',
      leaveDate: format(new Date(), 'yyyy-MM-dd'),
      startTime: initialStartTime?.substring(0, 5) ?? '09:00',
      endTime: initialEndTime?.substring(0, 5) ?? '18:00',
      breakTime: '00:00',
      workContent: '',
      workLocationType: '사무실',
      workLocationCustom: '',
      lateOrAttendanceStatus: '아니오',
      attendanceRecordType: '출근보고 진행 (주말출근, 휴가 포함)',
      expectedStartDate: format(addDays(new Date(), 1), 'yyyy-MM-dd'),
      expectedWorkTime: '09:00',
      expectedWorkLocationType: '사무실',
      expectedWorkLocation: '',
      sendTeams: true,
    },
  })

  const formValues = watch()
  const workLoc = formValues.workLocationType === '기타' ? formValues.workLocationCustom : formValues.workLocationType

  // 휴게사유 표시 여부: 휴게시간 30분 이상
  const showBreakReason = formValues.breakTime && formValues.breakTime !== '00:00'

  // ── userName prop이 비동기로 로드되면 이름 필드에 자동완성 (최초 1회) ───────
  useEffect(() => {
    if (userName && !nameInitialized.current) {
      setValue('name', userName)
      nameInitialized.current = true
    }
  }, [userName, setValue])

  // ── 이름 필드 변경 시 debounce로 display_name 자동 업데이트 (800ms) ────────
  useEffect(() => {
    const currentName = formValues.name
    // 아직 초기화 전이거나 빈 값이면 스킵
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
  }, [formValues.name]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    try {
      if (
        formValues.name &&
        formValues.workTypeLabel &&
        formValues.leaveDate &&
        formValues.startTime &&
        formValues.endTime &&
        (formValues.workLocationType !== '기타' || formValues.workLocationCustom)
      ) {
        const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;
        if (!timeRegex.test(formValues.startTime) || !timeRegex.test(formValues.endTime)) {
          onCalculate(null, null);
          return;
        }

        const result = calculateEw({
          name: formValues.name,
          workTypeLabel: formValues.workTypeLabel,
          leaveDate: formValues.leaveDate,
          startTime: formValues.startTime,
          endTime: formValues.endTime,
          breakTime: formValues.breakTime || '00:00',
          workLocation: workLoc || '사무실',
          workContent: formValues.workContent,
          breakReason: showBreakReason ? formValues.breakReason : undefined,
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
    formValues.startTime, formValues.endTime, formValues.breakTime,
    formValues.workLocationType, formValues.workLocationCustom,
    formValues.workContent, formValues.breakReason, onCalculate, workLoc, showBreakReason
  ])

  const onSubmit = async (data: WorkLogFormData) => {
    setIsSubmitting(true)
    setSubmitError(null)

    try {
      const finalWorkLocation = data.workLocationType === '기타' ? data.workLocationCustom : data.workLocationType;
      const finalExpectedWorkLocation =
        data.expectedWorkLocationType === '기타'
          ? data.expectedWorkLocation
          : data.expectedWorkLocationType;

      const res = await fetch('/api/work-logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...data, finalWorkLocation, finalExpectedWorkLocation }),
      })

      const resData = await res.json()

      if (!res.ok) {
        throw new Error(resData.error || '제출에 실패했습니다.')
      }

      // 복사 로직 실행
      const result = calculateEw({
        name: data.name,
        workTypeLabel: data.workTypeLabel,
        leaveDate: data.leaveDate,
        startTime: data.startTime,
        endTime: data.endTime,
        breakTime: data.breakTime || '00:00',
        workLocation: finalWorkLocation || '사무실',
        workContent: data.workContent,
        breakReason: showBreakReason ? data.breakReason : undefined,
      })
      await navigator.clipboard.writeText(result.copyText)
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

          <div>
            <label className="block text-sm font-medium text-gray-700">근무장소 *</label>
            <select
              {...register('workLocationType')}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm px-3 py-2 border bg-white"
            >
              <option value="사무실">사무실</option>
              <option value="외근">외근</option>
              <option value="재택">재택</option>
              <option value="기타">기타</option>
            </select>
            <p className="mt-1 text-xs text-gray-500">
              작성예시) 사무실 / 외근(삼성 현대모비스 본사) / 재택(삼성역 카페) 등<br />
              ※ 외근·재택의 경우 <span className="font-medium">기타</span> 선택 후 상세 장소를 직접 입력해주세요
            </p>
          </div>

          {formValues.workLocationType === '기타' && (
            <div>
              <label className="block text-sm font-medium text-gray-700">상세 근무장소 *</label>
              <input
                type="text"
                placeholder="장소 직접 입력 (예: 외근(현대모비스 본사))"
                {...register('workLocationCustom')}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm px-3 py-2 border"
              />
              {errors.workLocationCustom && <p className="mt-1 text-sm text-red-600">{errors.workLocationCustom.message as string}</p>}
            </div>
          )}
        </div>
      </div>

      {/* 2. 출퇴근 시간 섹션 */}
      <div>
        <h3 className="text-lg leading-6 font-medium text-gray-900 mb-4 border-b pb-2">출퇴근 시간</h3>
        <div className="grid grid-cols-1 gap-y-6 gap-x-4 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-gray-700">퇴근일자 *</label>
            <input
              type="date"
              {...register('leaveDate')}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm px-3 py-2 border"
            />
          </div>
          <div className="hidden sm:block"></div>

          <div>
            <label className="block text-sm font-medium text-gray-700">출근시간 *</label>
            <select
              {...register('startTime')}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm px-3 py-2 border bg-white"
            >
              {startTimeOptions.map(opt => <option key={opt} value={opt}>{opt}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">퇴근시간 *</label>
            <select
              {...register('endTime')}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm px-3 py-2 border bg-white"
            >
              {endTimeOptions.map(opt => <option key={opt} value={opt}>{opt}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">휴게시간 *</label>
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

      {/* 3. 추가 확인 섹션 (조건부) */}
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
              <div className="mt-4 grid grid-cols-1 gap-y-4 gap-x-4 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-medium text-gray-500">출근 예정 날짜 *</label>
                  <p className="text-xs text-gray-400 mt-0.5">내일 출근 날짜를 입력해주세요</p>
                  <input type="date" {...register('expectedStartDate')} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm px-3 py-2 border" />
                  {errors.expectedStartDate && <p className="mt-1 text-xs text-red-600">{errors.expectedStartDate.message as string}</p>}
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500">출근 예정 시간 *</label>
                  <p className="text-xs text-gray-400 mt-0.5">내일 출근 예정 시간을 입력해주세요</p>
                  <select {...register('expectedWorkTime')} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm px-3 py-2 border bg-white">
                    {startTimeOptions.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                  </select>
                  {errors.expectedWorkTime && <p className="mt-1 text-xs text-red-600">{errors.expectedWorkTime.message as string}</p>}
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-gray-500">출퇴근 예정 장소 *</label>
                  <p className="text-xs text-gray-400 mt-0.5">예) 사무실 / 재택 / 외근 / 기타(상세 입력)</p>
                  <select
                    {...register('expectedWorkLocationType')}
                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm px-3 py-2 border bg-white"
                  >
                    <option value="사무실">사무실</option>
                    <option value="재택">재택</option>
                    <option value="외근">외근</option>
                    <option value="기타">기타 (직접 입력)</option>
                  </select>
                  {errors.expectedWorkLocationType && <p className="mt-1 text-xs text-red-600">{errors.expectedWorkLocationType.message as string}</p>}

                  {formValues.expectedWorkLocationType === '기타' && (
                    <div className="mt-2">
                      <input
                        type="text"
                        placeholder="장소 직접 입력 (예: 외근(현대모비스 본사), 재택(삼성역 카페))"
                        {...register('expectedWorkLocation')}
                        className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm px-3 py-2 border"
                      />
                      {errors.expectedWorkLocation && <p className="mt-1 text-xs text-red-600">{errors.expectedWorkLocation.message as string}</p>}
                    </div>
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
            <Loader2 className="animate-spin -ml-1 mr-2 h-5 w-5" />
          ) : <Copy className="mr-2 h-5 w-5" />}
          제출 및 복사하기
        </button>
      </div>
    </form>
    </>
  )
}
