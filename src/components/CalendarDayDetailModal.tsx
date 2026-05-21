'use client'

/**
 * CalendarDayDetailModal
 *
 * 캘린더뷰에서 날짜 셀을 클릭했을 때 표시되는 상세 모달.
 *
 * 표시:
 *   - 출근보고 (출근예정/실제, 근무장소)
 *   - 퇴근보고 (출퇴근, 휴게, 휴가, EW, 근무내용)
 *   - Google 캘린더 휴가 라벨
 *   - Google 캘린더 일정
 *
 * 액션:
 *   - "출근보고 수정" / "퇴근보고 수정" — 부모에서 WorkLogModal 트리거
 *   - "이 날 휴가 등록" — 부모에서 VacationRegisterModal 띄움
 *   - "EW 복사 문구 복사"
 *
 * 부모(MyHistoryCalendar)는 onEditWorkLog / onRegisterVacation을 통해
 * 실제 모달 흐름을 처리.
 */

import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import { ko } from 'date-fns/locale'
import { X, Pencil, CalendarPlus, Copy, Check, Plane, Clock, MapPin, Plus, LogIn, LogOut } from 'lucide-react'
import { Badge, Button } from '@/components/ui'
import { resolveDisplayLocations, formatChipsArrow } from '@/lib/work-locations-v2'
import { cn } from '@/lib/utils/cn'
import type { SubmissionRow } from '@/components/SubmissionsRawTable'
import type { UserCalendarLookup } from '@/types/leave-calendar'
import type { LeaveTimeline, LeaveTimelineItem } from '@/types/leave-timeline'
import { useRegisterModalOpen } from '@/contexts/ModalOpenContext'

export interface CalendarDayDetailModalProps {
  date: string  // YYYY-MM-DD
  checkIn:  SubmissionRow | null
  checkOut: SubmissionRow | null
  calendar: UserCalendarLookup | null
  onClose: () => void
  /** ✏ 수정 — 부모에서 WorkLogModal 호출 */
  /** cellDate: 클릭한 캘린더 셀의 날짜 (YYYY-MM-DD). 부모가 work_log row의
      어느 영역이 셀의 데이터인지 판단할 때 사용 (D-day 본문 vs D+1 expected_*).
      없으면 부모는 기존 흐름(WorkLogModal editScope)으로 fallback. */
  onEditWorkLog?: (workLogId: string, scope: 'check_in' | 'check_out', cellDate?: string) => void
  /** "휴가 등록" — 부모에서 VacationRegisterModal 호출 */
  onRegisterVacation?: () => void
  /** "출근보고 작성" — 부모에서 CheckInModal 호출 (해당 date로) */
  onCreateCheckIn?: () => void
  /** "퇴근보고 작성" — 부모에서 WorkLogModal 호출 (해당 date로 신규 제출) */
  onCreateCheckOut?: () => void
  /** Phase 1.5e — Google 캘린더 chip 클릭 → EventEditModal 수정 모드. ev에는 id + 원본 필드 포함 */
  onEditEvent?: (ev: import('@/types/leave-calendar').CalendarEventChunk) => void
  /** Phase 1.5e — "+ 일정 등록" → EventEditModal 신규 모드 (해당 date prefill) */
  onCreateEvent?: () => void
}

function trimToHHmm(s: string | null | undefined): string {
  if (!s) return '-'
  return s.slice(0, 5) || '-'
}

function fmtIntervalShort(s: string | null | undefined): string {
  if (!s) return '-'
  if (s.includes(':')) {
    const parts = s.split(':')
    return `${parts[0].padStart(2, '0')}:${parts[1].padStart(2, '0')}`
  }
  return s
}

export default function CalendarDayDetailModal({
  date,
  checkIn,
  checkOut,
  calendar,
  onClose,
  onEditWorkLog,
  onRegisterVacation,
  onCreateCheckIn,
  onCreateCheckOut,
  onEditEvent,
  onCreateEvent,
}: CalendarDayDetailModalProps) {
  // Stage 4: 글로벌 모달 카운터 등록
  useRegisterModalOpen()
  const dayDate = parseISO(date)
  const dateLabel = format(dayDate, 'yyyy년 M월 d일 (EEE)', { locale: ko })

  const co = checkOut
  const ci = checkIn

  // 휴가 항목 (퇴근보고 row의 leave_timeline 우선, 없으면 출근보고 row의 leave_timeline)
  const leaveTimeline: LeaveTimeline =
    (Array.isArray(co?.leave_timeline) ? (co!.leave_timeline as LeaveTimeline) : null)
    ?? (Array.isArray(ci?.leave_timeline) ? (ci!.leave_timeline as LeaveTimeline) : null)
    ?? []

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 overflow-y-auto py-6 px-4">
      <div className="bg-surface rounded-[20px] shadow-[var(--shadow-popover)] w-full max-w-lg">
        {/* 헤더 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div>
            <h3 className="text-base font-semibold text-text-primary">{dateLabel}</h3>
            <p className="text-[12px] text-text-secondary mt-0.5">날짜별 최종 상태</p>
          </div>
          <button
            onClick={onClose}
            className="inline-flex items-center justify-center h-9 w-9 rounded-[10px] text-text-muted hover:text-text-primary hover:bg-surface-muted transition-colors"
            aria-label="닫기"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>

        {/* 본문 */}
        <div className="px-6 py-5 space-y-4">
          {/* 휴가 표시 — 차감 시간(roundedMinutes) 기반 (slot startTime~endTime은 leaveType 표준 슬롯이라 실제 차감과 다를 수 있어 사용자 혼란 — v1.30) */}
          {leaveTimeline.length > 0 && (
            <div className="rounded-[10px] border border-warning-border bg-warning-bg p-3">
              <div className="flex items-center gap-1.5 text-[12px] font-semibold text-warning-text mb-1">
                <Plane className="h-3.5 w-3.5" aria-hidden /> N-Click 휴가
              </div>
              <ul className="text-sm text-text-primary space-y-0.5">
                {leaveTimeline.map((it: LeaveTimelineItem, i: number) => {
                  const mins = typeof it.roundedMinutes === 'number' && it.roundedMinutes >= 0
                    ? it.roundedMinutes
                    : (typeof it.actualMinutes === 'number' && it.actualMinutes >= 0 ? it.actualMinutes : 0)
                  const h = Math.floor(mins / 60)
                  const m = mins % 60
                  const durationLabel =
                    h > 0 && m > 0 ? `${h}시간 ${m}분`
                    : h > 0        ? `${h}시간`
                                   : `${m}분`
                  return (
                    <li key={i} className="tabular-nums">
                      <span className="font-medium">{it.label}</span>{' '}
                      <span className="text-text-secondary">{durationLabel}</span>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}

          {/* 출근보고 (사전/실제) */}
          <Section
            title="출근보고"
            empty={!ci && !co?.start_time}
            actions={
              ci?.work_log_id && onEditWorkLog ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onEditWorkLog(ci.work_log_id!, 'check_in', date)}
                >
                  <Pencil className="h-3.5 w-3.5" aria-hidden /> 수정
                </Button>
              ) : (!ci && !co?.start_time && onCreateCheckIn ? (
                <Button
                  variant="primary"
                  size="sm"
                  onClick={onCreateCheckIn}
                >
                  <LogIn className="h-3.5 w-3.5" aria-hidden /> 출근보고 작성
                </Button>
              ) : null)
            }
          >
            <KvRow label="출근예정" value={trimToHHmm(ci?.expected_work_time ?? ci?.start_time)} />
            <KvRow label="퇴근예정" value={trimToHHmm(ci?.end_time)} />
            <KvRow
              label="예정 장소"
              value={(() => {
                const chips = resolveDisplayLocations({
                  planned: ci?.planned_work_locations,
                  actual: ci?.actual_work_locations,
                  legacyExpectedTimeline: ci?.expected_work_location_timeline as unknown as never,
                  legacyActualTimeline: ci?.work_location_timeline as unknown as never,
                  legacyExpectedWorkLocation: ci?.expected_work_location,
                  legacyWorkLocation: ci?.work_location,
                })
                return chips && chips.length > 0 ? formatChipsArrow(chips) : (ci?.expected_work_location ?? ci?.work_location ?? '-')
              })()}
              icon={<MapPin className="h-3.5 w-3.5 text-text-muted" aria-hidden />}
            />
            <KvRow
              label="실제 출근"
              value={trimToHHmm(co?.start_time)}
              icon={<Clock className="h-3.5 w-3.5 text-text-muted" aria-hidden />}
            />
          </Section>

          {/* 퇴근보고 */}
          {/* 실제 퇴근시각이 있어야 진짜 '수정' — 출근만/출근완료까지 한 상태는 신규 작성 흐름으로 */}
          <Section
            title="퇴근보고"
            empty={!co?.end_time}
            actions={
              co?.end_time && co?.work_log_id && onEditWorkLog ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onEditWorkLog(co.work_log_id!, 'check_out', date)}
                >
                  <Pencil className="h-3.5 w-3.5" aria-hidden /> 수정
                </Button>
              ) : (onCreateCheckOut ? (
                <Button
                  variant="primary"
                  size="sm"
                  onClick={onCreateCheckOut}
                >
                  <LogOut className="h-3.5 w-3.5" aria-hidden /> 퇴근보고 작성
                </Button>
              ) : null)
            }
          >
            <KvRow label="실제 퇴근" value={trimToHHmm(co?.end_time)} />
            <KvRow label="근무장소" value={(() => {
              const chips = resolveDisplayLocations({
                actual: co?.actual_work_locations,
                planned: co?.planned_work_locations,
                legacyActualTimeline: co?.work_location_timeline as unknown as never,
                legacyWorkLocation: co?.work_location,
              })
              return chips && chips.length > 0 ? formatChipsArrow(chips) : (co?.work_location ?? '-')
            })()} />
            <KvRow label="휴게" value={fmtIntervalShort(co?.break_time)} />
            <KvRow label="실근무" value={fmtIntervalShort(co?.actual_work_time)} />
            <KvRow
              label="EW"
              value={co?.ew_value ?? '-'}
              valueClass="font-bold text-primary-600"
            />
            {co?.work_content && (
              <KvRow label="근무내용" value={co.work_content} valueClass="text-text-primary" multiLine />
            )}
            {co?.copy_text && (
              <div className="pt-2 mt-2 border-t border-border">
                <CopyEwText text={co.copy_text} />
              </div>
            )}
          </Section>

          {/* Google 캘린더 */}
          {calendar?.enabled && (calendar.leaveLabel || (calendar.events && calendar.events.length > 0)) && (
            <Section title="Google 캘린더">
              {calendar.leaveLabel && (
                <div className="flex items-center gap-2">
                  <Badge variant="warning" dot>{calendar.leaveLabel}</Badge>
                  <span className="text-[12px] text-text-muted">시트에서 자동 인식</span>
                </div>
              )}
              {calendar.events && calendar.events.length > 0 && (
                <ul className="text-[13px] text-text-primary space-y-0.5 tabular-nums mt-1">
                  {calendar.events.map((ev, i) => {
                    const text = ev.startTime && ev.endTime
                      ? `${ev.startTime}~${ev.endTime} ${ev.title}`
                      : ev.startTime
                        ? `${ev.startTime}~ ${ev.title}`
                        : `(종일) ${ev.title}`
                    // Phase 1.5e — id가 있는 chunk만 클릭 가능 (org_calendar_events row 식별)
                    if (ev.id && onEditEvent) {
                      return (
                        <li key={ev.id ?? i}>
                          <button
                            type="button"
                            onClick={() => onEditEvent(ev)}
                            className="text-left w-full rounded-md px-1.5 py-0.5 hover:bg-primary-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                            title="클릭해서 수정"
                          >
                            {text}
                          </button>
                        </li>
                      )
                    }
                    return <li key={i} className="px-1.5">{text}</li>
                  })}
                </ul>
              )}
            </Section>
          )}
        </div>

        {/* 푸터 */}
        <div className="flex items-center justify-between gap-2 px-6 py-4 border-t border-border bg-background/40 rounded-b-[20px]">
          <div className="flex items-center gap-2">
            {onRegisterVacation && (
              <Button variant="secondary" size="sm" onClick={onRegisterVacation}>
                <CalendarPlus className="h-4 w-4" aria-hidden />
                이 날 휴가 등록
              </Button>
            )}
            {onCreateEvent && (
              <Button variant="secondary" size="sm" onClick={onCreateEvent}>
                <CalendarPlus className="h-4 w-4" aria-hidden />
                일정 등록
              </Button>
            )}
          </div>
          <div className="ml-auto">
            <Button variant="ghost" size="sm" onClick={onClose}>닫기</Button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── 작은 부품 ────────────────────────────────────────────────────────────────

function Section({
  title, empty, actions, children,
}: {
  title: string
  empty?: boolean
  actions?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-[12px] font-semibold text-text-secondary">{title}</h4>
        {actions ? <div>{actions}</div> : null}
      </div>
      {empty ? (
        <div className="text-[13px] text-text-muted">기록 없음</div>
      ) : (
        <div className="space-y-1">{children}</div>
      )}
    </div>
  )
}

function KvRow({
  label, value, icon, valueClass, multiLine,
}: {
  label: string
  value: React.ReactNode
  icon?: React.ReactNode
  valueClass?: string
  multiLine?: boolean
}) {
  return (
    <div className={cn('flex gap-3 items-baseline text-[13px]', multiLine && 'flex-col items-start')}>
      <div className="w-20 shrink-0 text-text-muted">{label}</div>
      <div className={cn('flex items-center gap-1 tabular-nums', valueClass ?? 'text-text-primary')}>
        {icon}
        <span className={cn(multiLine && 'whitespace-pre-wrap')}>{value}</span>
      </div>
    </div>
  )
}

function CopyEwText({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const handle = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      alert('복사 실패. 브라우저 권한을 확인해주세요.')
    }
  }
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-[12px] font-semibold text-text-secondary">EW 복사 문구</p>
      <div className="flex items-center gap-2">
        <code className="flex-1 text-[12px] font-mono text-text-primary bg-surface-muted border border-border rounded-[8px] px-2 py-1.5 truncate" title={text}>
          {text}
        </code>
        <Button
          variant={copied ? 'secondary' : 'primary'}
          size="sm"
          onClick={handle}
          className={copied ? '!text-success-text !bg-success-bg !border-success-border' : ''}
        >
          {copied ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
          {copied ? '완료' : '복사'}
        </Button>
      </div>
    </div>
  )
}
