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

import { useEffect, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { ko } from 'date-fns/locale'
import { X, Pencil, CalendarPlus, Copy, Check, Plane, Clock, MapPin, Plus, LogIn, LogOut, ExternalLink } from 'lucide-react'
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
  /** v1.60.5 — 휴가 항목 삭제 후 부모가 캘린더 refetch 트리거 */
  onLeaveTimelinePatched?: () => void
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
  onLeaveTimelinePatched,
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

  // v1.61 — 사용자 본부의 spreadsheet URL 1회 fetch.
  const [sheetUrl, setSheetUrl] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    fetch('/api/my/sheet-source-url')
      .then(r => (r.ok ? r.json() : null))
      .then((d: { url?: string | null } | null) => {
        if (!cancelled && d?.url) setSheetUrl(d.url)
      })
      .catch(() => { /* silent */ })
    return () => { cancelled = true }
  }, [])

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
          {/* 휴가 표시 — 차감 시간(roundedMinutes) 기반 (slot startTime~endTime은 leaveType 표준 슬롯이라 실제 차감과 다를 수 있어 사용자 혼란 — v1.30)
              v1.60.5 — 각 항목 옆에 "취소" 링크 추가. confirm 후 즉시 PATCH /leave-timeline.
              workLogId는 ci 또는 co의 work_log_id에서 얻음. */}
          {leaveTimeline.length > 0 && (() => {
            const workLogId = ci?.work_log_id ?? co?.work_log_id ?? null
            return (
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
                  const isFullDay = it.leaveType === 'full_day'
                  return (
                    <li key={i} className="tabular-nums flex items-center gap-2">
                      <span className="flex-1">
                        <span className="font-medium">{it.label}</span>{' '}
                        <span className="text-text-secondary">{durationLabel}</span>
                      </span>
                      {workLogId && (
                        <button
                          type="button"
                          onClick={async () => {
                            const msg = isFullDay
                              ? `${date} 종일 휴가를 취소하시겠습니까?`
                              : `${date} ${it.label}(${(mins / 60).toFixed(mins % 60 === 0 ? 0 : 1)}H) 일정을 삭제하시겠습니까?`
                            if (!window.confirm(msg)) return
                            const next = leaveTimeline.filter((_, j) => j !== i)
                            try {
                              const res = await fetch(`/api/work-logs/${workLogId}/leave-timeline`, {
                                method: 'PATCH',
                                headers: { 'Content-Type': 'application/json' },
                                // v1.60.7 — calendar source 삭제면 dismissCalendarPrefill=true
                                body: JSON.stringify({
                                  leaveTimeline: next,
                                  dismissCalendarPrefill: it.source === 'calendar',
                                }),
                              })
                              if (!res.ok) {
                                const j = await res.json().catch(() => null)
                                alert(`삭제 실패: ${j?.error ?? res.statusText}`)
                                return
                              }
                              onLeaveTimelinePatched?.()
                            } catch (e) {
                              alert(`삭제 실패: ${e instanceof Error ? e.message : String(e)}`)
                            }
                          }}
                          className="shrink-0 text-[11px] font-medium text-warning-text underline underline-offset-2 hover:text-warning-text/80"
                        >
                          {isFullDay ? '이 휴가 취소' : '일정 삭제'}
                        </button>
                      )}
                    </li>
                  )
                })}
              </ul>
              {/* v1.61 — calendar source 항목이 있고 본부 시트 URL 등록되어 있으면 deep link */}
              {sheetUrl && leaveTimeline.some(it => it.source === 'calendar') && (
                <div className="mt-2 pt-2 border-t border-warning-border/60 text-[11px] text-text-muted">
                  ※ 시트 원본은 자동으로 빠지지 않습니다.{' '}
                  <a
                    href={sheetUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-0.5 font-medium text-warning-text underline underline-offset-2 hover:text-warning-text/80"
                  >
                    캘린더 시트 열기
                    <ExternalLink className="h-3 w-3" aria-hidden />
                  </a>
                </div>
              )}
            </div>
            )
          })()}

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

          {/* 외부 캘린더 — v1.61.3: leaveSource로 GCal/시트 정확 분기.
              - gcal: N-Click [취소] = vacation-sync로 Google Calendar events.delete 자동 (양방향)
              - sheet: 단방향이라 시트 원본 안 빠짐. "가리기"만 가능 */}
          {calendar?.enabled && (calendar.leaveLabel || (calendar.events && calendar.events.length > 0)) && (
            <Section title="외부 캘린더">
              {calendar.leaveLabel && (() => {
                const lvSrc = (calendar as { leaveSource?: 'gcal' | 'sheet' | null }).leaveSource ?? null
                const lvEventId = (calendar as { leaveEventId?: string | null }).leaveEventId ?? null
                const isGcal = lvSrc === 'gcal'
                const sourceHint = isGcal ? 'Google 캘린더 (양방향 동기화)' : '시트에서 자동 인식'
                const actionLabel = isGcal ? '이 휴가 취소' : '이 일자에서 가리기'
                const confirmMsg = isGcal
                  ? `${date} 휴가를 취소하시겠습니까?\n\nGoogle 캘린더에서도 자동으로 삭제됩니다.`
                  : `${date} 휴가를 N-Click 표시에서 가리시겠습니까?\n\n※ 시트 원본은 자동으로 빠지지 않습니다. 영구 삭제는 캘린더 시트에서 직접 수정해주세요.`
                return (
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="warning" dot>{calendar.leaveLabel}</Badge>
                    <span className="text-[12px] text-text-muted">{sourceHint}</span>
                    <button
                      type="button"
                      onClick={async () => {
                        if (!window.confirm(confirmMsg)) return
                        try {
                          const res = await fetch('/api/work-logs/dismiss-calendar-prefill', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                              date,
                              // v1.61.3 — gcal source면 eventId 같이 보내서 events.delete trigger
                              leaveSource: lvSrc,
                              leaveEventId: lvEventId,
                            }),
                          })
                          if (!res.ok) {
                            const j = await res.json().catch(() => null)
                            alert(`${isGcal ? '취소' : '가리기'} 실패: ${j?.error ?? res.statusText}`)
                            return
                          }
                          onLeaveTimelinePatched?.()
                        } catch (e) {
                          alert(`${isGcal ? '취소' : '가리기'} 실패: ${e instanceof Error ? e.message : String(e)}`)
                        }
                      }}
                      className="ml-auto shrink-0 text-[11px] font-medium text-warning-text underline underline-offset-2 hover:text-warning-text/80"
                    >
                      {actionLabel}
                    </button>
                  </div>
                )
              })()}
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
              // 이미 출근/퇴근 보고가 있는 날은 bulk-leave가 안전장치로 skip하므로
              // 버튼 대신 정확한 대안 경로(출근보고 수정 → 휴가 timeline)를 안내.
              // (checkIn / checkOut prop은 work_log row가 실제로 있을 때만 non-null —
              //  workLogToSubmissionPair의 hasCheckIn 가드 적용 후 정확.)
              (checkIn || checkOut) ? (
                <span className="inline-flex items-center text-[12px] text-text-muted px-2 py-1 rounded-md bg-surface-muted">
                  💡 이미 보고된 날 — 출근보고 수정(✏)에서 휴가 추가
                </span>
              ) : (
                <Button variant="secondary" size="sm" onClick={onRegisterVacation}>
                  <CalendarPlus className="h-4 w-4" aria-hidden />
                  이 날 휴가 등록
                </Button>
              )
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
