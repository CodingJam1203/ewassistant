'use client'

/**
 * 근무장소 타임라인 입력 컴포넌트
 *
 * - 여러 work_location 행과 마지막 expected_checkout 행을 입력받습니다.
 * - "+ 장소 추가" 버튼으로 새 work_location 행 삽입 (expected_checkout 직전)
 * - work_location 행: type select + customLabel input(기타 시) + 시간 select + 삭제 버튼
 * - expected_checkout 행: 시간 select만 (삭제 불가)
 * - 검증 에러는 부모에서 props로 내려줍니다.
 *
 * 입력 순서를 그대로 유지합니다 (자동 정렬 X). 시간 검증은 제출 시점에서 일괄.
 */

import { useMemo } from 'react'
import { Plus, X, MapPin, LogOut } from 'lucide-react'
import {
  WORK_LOCATION_TYPE_LABELS,
  type WorkLocationItem,
  type WorkLocationTimeline,
  type WorkLocationType,
} from '@/types/work-location-timeline'
import type { TimelineValidationError } from '@/lib/work-location-timeline'

interface WorkLocationTimelineInputProps {
  value: WorkLocationTimeline
  onChange: (next: WorkLocationTimeline) => void
  /** 부모가 제출 직전 검증 결과를 넘겨주면 인라인으로 표시 */
  errors?: TimelineValidationError[]
  disabled?: boolean
}

/** 30분 단위 시간 옵션 (00:00 ~ 23:30) */
function buildTimeOptions(): string[] {
  const opts: string[] = []
  for (let h = 0; h < 24; h++) {
    opts.push(`${String(h).padStart(2, '0')}:00`)
    opts.push(`${String(h).padStart(2, '0')}:30`)
  }
  return opts
}

const TIME_OPTIONS = buildTimeOptions()
const TYPE_ORDER: WorkLocationType[] = ['office', 'remote', 'field', 'custom']

/**
 * 타임라인 기본값 (외부에서 import해서 폼 초기값으로 사용 가능)
 * - 사무실 09:00 + 퇴근예정 18:00
 */
export function defaultTimeline(): WorkLocationTimeline {
  return [
    { kind: 'work_location', type: 'office', label: WORK_LOCATION_TYPE_LABELS.office, customLabel: null, startTime: '09:00' },
    { kind: 'expected_checkout', startTime: '18:00' },
  ]
}

export default function WorkLocationTimelineInput({
  value,
  onChange,
  errors,
  disabled,
}: WorkLocationTimelineInputProps) {
  const workLocCount = useMemo(
    () => value.filter(e => e.kind === 'work_location').length,
    [value]
  )

  /** 인덱스별 에러 메시지 매핑 (있으면) */
  const errorByIndex = useMemo(() => {
    const map = new Map<number, string[]>()
    const general: string[] = []
    ;(errors ?? []).forEach(err => {
      if (typeof err.index === 'number') {
        const arr = map.get(err.index) ?? []
        arr.push(err.message)
        map.set(err.index, arr)
      } else {
        general.push(err.message)
      }
    })
    return { byIndex: map, general }
  }, [errors])

  const updateAt = (i: number, patch: Partial<WorkLocationItem> | Partial<{ startTime: string }>) => {
    const next = value.map((entry, idx) => {
      if (idx !== i) return entry
      if (entry.kind === 'work_location') {
        return { ...entry, ...(patch as Partial<WorkLocationItem>) }
      }
      return { ...entry, ...(patch as { startTime: string }) }
    })
    onChange(next)
  }

  const removeAt = (i: number) => {
    if (value[i]?.kind !== 'work_location') return
    if (workLocCount <= 1) return // 최소 1개 유지
    const next = value.filter((_, idx) => idx !== i)
    onChange(next)
  }

  const addLocation = () => {
    // expected_checkout 직전에 새 work_location 삽입
    const checkoutIdx = value.findIndex(e => e.kind === 'expected_checkout')
    const insertAt = checkoutIdx === -1 ? value.length : checkoutIdx

    // 새 항목 시작 시간: 직전 항목 시간보다 1시간 늦게 (TIME_OPTIONS 범위 안에서)
    const prev = value[insertAt - 1]
    const suggested = prev ? bumpHour(prev.startTime, 1) : '12:00'

    const newItem: WorkLocationItem = {
      kind: 'work_location',
      type: 'office',
      label: WORK_LOCATION_TYPE_LABELS.office,
      customLabel: null,
      startTime: suggested,
    }
    const next = [...value.slice(0, insertAt), newItem, ...value.slice(insertAt)]
    onChange(next)
  }

  const handleTypeChange = (i: number, newType: WorkLocationType) => {
    updateAt(i, {
      type: newType,
      label: WORK_LOCATION_TYPE_LABELS[newType],
      customLabel: newType === 'custom' ? (value[i] as WorkLocationItem).customLabel ?? '' : null,
    })
  }

  return (
    <div className="space-y-2">
      {value.map((entry, i) => {
        const itemErrors = errorByIndex.byIndex.get(i) ?? []
        const isCheckout = entry.kind === 'expected_checkout'

        return (
          <div
            key={i}
            className={`rounded-lg border p-3 ${
              isCheckout
                ? 'border-blue-200 bg-blue-50/40 dark:border-blue-800 dark:bg-blue-900/10'
                : 'border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800'
            }`}
          >
            <div className="flex items-center gap-2 flex-wrap">
              {/* 순번 + 아이콘 */}
              <div className="flex items-center gap-1 min-w-[2.5rem]">
                <span className="text-xs font-semibold text-gray-500 dark:text-gray-400">
                  {i + 1}.
                </span>
                {isCheckout ? (
                  <LogOut className="h-3.5 w-3.5 text-blue-500 flex-shrink-0" />
                ) : (
                  <MapPin className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" />
                )}
              </div>

              {/* 라벨/장소 선택 */}
              {isCheckout ? (
                <span className="text-sm font-medium text-blue-700 dark:text-blue-300 min-w-[5rem]">
                  퇴근예정
                </span>
              ) : (
                <select
                  value={(entry as WorkLocationItem).type}
                  onChange={e => handleTypeChange(i, e.target.value as WorkLocationType)}
                  disabled={disabled}
                  className="rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {TYPE_ORDER.map(t => (
                    <option key={t} value={t}>
                      {WORK_LOCATION_TYPE_LABELS[t]}
                    </option>
                  ))}
                </select>
              )}

              {/* 시간 select */}
              <select
                value={entry.startTime}
                onChange={e => updateAt(i, { startTime: e.target.value })}
                disabled={disabled}
                className="rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {TIME_OPTIONS.map(t => (
                  <option key={t} value={t}>
                    {t}
                    {isCheckout ? '' : '~'}
                  </option>
                ))}
              </select>

              {/* 삭제 버튼: work_location 행 + 2개 이상일 때만 */}
              {!isCheckout && workLocCount > 1 && (
                <button
                  type="button"
                  onClick={() => removeAt(i)}
                  disabled={disabled}
                  aria-label="삭제"
                  className="ml-auto p-1.5 rounded text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>

            {/* 기타 선택 시 상세 입력 */}
            {!isCheckout && (entry as WorkLocationItem).type === 'custom' && (
              <div className="mt-2 ml-10">
                <input
                  type="text"
                  placeholder="상세 장소 (예: 외근(현대모비스 본사), 재택(삼성역 카페))"
                  value={(entry as WorkLocationItem).customLabel ?? ''}
                  onChange={e => updateAt(i, { customLabel: e.target.value })}
                  disabled={disabled}
                  className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            )}

            {/* 항목별 에러 */}
            {itemErrors.length > 0 && (
              <div className="mt-1 ml-10 space-y-0.5">
                {itemErrors.map((m, idx) => (
                  <p key={idx} className="text-xs text-red-600">{m}</p>
                ))}
              </div>
            )}
          </div>
        )
      })}

      {/* 장소 추가 버튼 */}
      <button
        type="button"
        onClick={addLocation}
        disabled={disabled}
        className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 px-3 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 disabled:opacity-50"
      >
        <Plus className="h-4 w-4" />
        근무장소 추가
      </button>

      {/* 일반 에러 (인덱스 없는 메시지들) */}
      {errorByIndex.general.length > 0 && (
        <div className="space-y-0.5">
          {errorByIndex.general.map((m, i) => (
            <p key={i} className="text-xs text-red-600">{m}</p>
          ))}
        </div>
      )}
    </div>
  )
}

/** 'HH:mm' 시간을 hours만큼 더해 다시 'HH:mm' 반환 (24h 넘으면 23:30 클램프) */
function bumpHour(hhmm: string, hours: number): string {
  const [h, m] = hhmm.split(':').map(Number)
  let next = (Number.isFinite(h) ? h : 0) + hours
  let mm = Number.isFinite(m) ? m : 0
  if (next >= 24) {
    next = 23
    mm = 30
  }
  return `${String(next).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}
