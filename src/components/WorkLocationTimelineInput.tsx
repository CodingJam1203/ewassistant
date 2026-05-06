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

/** 30분 단위 당일 시간 옵션 (00:00 ~ 23:30) — 출근(첫 work_location 항목)에서 사용 */
export const TIMELINE_TIME_OPTIONS: string[] = (() => {
  const opts: string[] = []
  for (let h = 0; h < 24; h++) {
    opts.push(`${String(h).padStart(2, '0')}:00`)
    opts.push(`${String(h).padStart(2, '0')}:30`)
  }
  return opts
})()

/**
 * 명일 시간 포함 옵션 (00:00 ~ 23:30 + 24:00 ~ 36:00 = 명일 12:00) —
 * 두 번째 이후 항목 / 퇴근(예정) 항목에서 사용. 새벽까지 근무하는 케이스용.
 */
export const TIMELINE_TIME_OPTIONS_WITH_NEXT_DAY: string[] = (() => {
  const opts: string[] = [...TIMELINE_TIME_OPTIONS]
  for (let h = 24; h <= 36; h++) {
    opts.push(`${String(h).padStart(2, '0')}:00`)
    if (h < 36) opts.push(`${String(h).padStart(2, '0')}:30`)
  }
  return opts
})()

/** select option 라벨 — 24시 이상은 "(명일) HH:mm"으로 표기 */
function timeLabel(value: string): string {
  const h = parseInt(value.split(':')[0], 10)
  if (h < 24) return value
  const adj = h - 24
  return `(명일) ${String(adj).padStart(2, '0')}:${value.split(':')[1]}`
}

interface WorkLocationTimelineInputProps {
  value: WorkLocationTimeline
  onChange: (next: WorkLocationTimeline) => void
  /** 부모가 제출 직전 검증 결과를 넘겨주면 인라인으로 표시 */
  errors?: TimelineValidationError[]
  disabled?: boolean
}

const TIME_OPTIONS = TIMELINE_TIME_OPTIONS
const TYPE_ORDER: WorkLocationType[] = ['office', 'remote', 'field', 'custom']

/**
 * 타임라인 기본값 — 진행 중(출근보고/근무지변경) 단계에서 사용.
 * - 사무실 09:00 + 퇴근예정 18:00
 */
export function defaultTimeline(): WorkLocationTimeline {
  return [
    { kind: 'work_location', type: 'office', label: WORK_LOCATION_TYPE_LABELS.office, customLabel: null, startTime: '09:00' },
    { kind: 'expected_checkout', startTime: '18:00' },
  ]
}

/**
 * 퇴근보고 단계의 기본값 — 마지막 항목이 checkout(실제 퇴근).
 * - 사무실 09:00 + 퇴근 18:00
 */
export function defaultCheckoutTimeline(): WorkLocationTimeline {
  return [
    { kind: 'work_location', type: 'office', label: WORK_LOCATION_TYPE_LABELS.office, customLabel: null, startTime: '09:00' },
    { kind: 'checkout', startTime: '18:00' },
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
    // 종료 항목(expected_checkout 또는 checkout)이 마지막에 있어야 정상.
    // 만약 중간에 끼어 있다면 먼저 마지막으로 이동시켜 정렬한다.
    const normalized = (() => {
      const arr = [...value]
      const endIdx = arr.findIndex(e => e.kind === 'expected_checkout' || e.kind === 'checkout')
      if (endIdx === -1) return arr
      if (endIdx === arr.length - 1) return arr
      const [endItem] = arr.splice(endIdx, 1)
      arr.push(endItem)
      return arr
    })()

    // 종료 항목 직전에 새 work_location 삽입
    const endIdx = normalized.findIndex(e => e.kind === 'expected_checkout' || e.kind === 'checkout')
    const insertAt = endIdx === -1 ? normalized.length : endIdx

    // 새 항목 시작 시간: 직전 항목 시간보다 1시간 늦게.
    // 단 종료 항목 시간을 넘어가면 종료 시간 직전 30분으로 보정.
    const prev = normalized[insertAt - 1]
    const endItem = endIdx === -1 ? null : normalized[endIdx]
    let suggested = prev ? bumpHour(prev.startTime, 1) : '12:00'

    if (endItem) {
      const endMin = toMinutes(endItem.startTime)
      const sugMin = toMinutes(suggested)
      if (sugMin >= endMin) {
        const clampedMin = Math.max(endMin - 30, 0)
        suggested = minutesToHHmm(clampedMin)
      }
    }

    const newItem: WorkLocationItem = {
      kind: 'work_location',
      type: 'office',
      label: WORK_LOCATION_TYPE_LABELS.office,
      customLabel: null,
      startTime: suggested,
    }
    const next = [...normalized.slice(0, insertAt), newItem, ...normalized.slice(insertAt)]
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
        const isEnd = entry.kind === 'expected_checkout' || entry.kind === 'checkout'
        const endLabel = entry.kind === 'checkout' ? '퇴근' : '퇴근예정'

        return (
          <div
            key={i}
            className={`rounded-lg border p-3 ${
              isEnd
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
                {isEnd ? (
                  <LogOut className="h-3.5 w-3.5 text-blue-500 flex-shrink-0" />
                ) : (
                  <MapPin className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" />
                )}
              </div>

              {/* 라벨/장소 선택 */}
              {isEnd ? (
                <span className="text-sm font-medium text-blue-700 dark:text-blue-300 min-w-[5rem]">
                  {endLabel}
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

              {/* 시간 select — 첫 항목(출근시각)은 당일만, 그 외(중간 근무지/퇴근)는 명일 12:00까지 선택 가능 */}
              {(() => {
                const allowNextDay = i > 0
                const opts = allowNextDay
                  ? TIMELINE_TIME_OPTIONS_WITH_NEXT_DAY
                  : TIMELINE_TIME_OPTIONS
                return (
                  <select
                    value={entry.startTime}
                    onChange={e => updateAt(i, { startTime: e.target.value })}
                    disabled={disabled}
                    className="rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {opts.map(t => (
                      <option key={t} value={t}>
                        {timeLabel(t)}
                        {isEnd ? '' : '~'}
                      </option>
                    ))}
                  </select>
                )
              })()}

              {/* 삭제 버튼: work_location 행 + 2개 이상일 때만 */}
              {!isEnd && workLocCount > 1 && (
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
            {!isEnd && (entry as WorkLocationItem).type === 'custom' && (
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

/** 'HH:mm' → 분 단위 정수 */
function toMinutes(hhmm: string): number {
  const [h, m] = (hhmm ?? '').split(':').map(Number)
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0)
}

/** 분 단위 정수 → 'HH:mm' (30분 단위 floor + 24h 클램프) */
function minutesToHHmm(min: number): string {
  const clamped = Math.max(0, Math.min(min, 23 * 60 + 30))
  const h = Math.floor(clamped / 60)
  const flooredM = clamped % 60 < 30 ? 0 : 30
  return `${String(h).padStart(2, '0')}:${String(flooredM).padStart(2, '0')}`
}
