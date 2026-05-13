'use client'

import { memo, useState, useEffect, useCallback, useRef } from 'react'
import { format, addDays, subDays, parseISO } from 'date-fns'
import { ko } from 'date-fns/locale'
import { ChevronLeft, ChevronRight, RefreshCw, MapPin, Clock, Coffee, LogIn, LogOut, X, LayoutGrid, List, Check } from 'lucide-react'
import CheckInModal from '@/components/CheckInModal'
import WorkLogModal from '@/components/WorkLogModal'
import {
  Button, Badge, Select, FilterBar, PageHeader,
  TableContainer, TableScroll, Table, Th, Td, TR_HOVER,
  DateInputWithDow,
} from '@/components/ui'
import type { BadgeVariant } from '@/components/ui'
import { cn } from '@/lib/utils/cn'
import type { TeamMemberCard } from '@/app/api/team-status/route'
import { computeWorkLogState, buttonsForState } from '@/lib/work-log-state'
import { resolveDisplayLocations, resolvePlannedLocations, chipLabel, formatChipsArrow } from '@/lib/work-locations-v2'
import EditableLocationChips from '@/components/EditableLocationChips'
import type { WorkLocations } from '@/types/work-locations-v2'

type ViewMode = 'card' | 'list'

/** localStorage 안전 read — SSR에서는 default. */
function readViewMode(): ViewMode {
  if (typeof window === 'undefined') return 'card'
  try {
    const v = localStorage.getItem('team-view-mode')
    return v === 'list' ? 'list' : 'card'
  } catch {
    return 'card'
  }
}

/** 현재 시각을 30분 단위로 floor한 'HH:mm' 문자열 (KST 기준) */
function nowRoundedTo30(): string {
  const now = new Date()
  const h = now.getHours().toString().padStart(2, '0')
  const m = now.getMinutes() < 30 ? '00' : '30'
  return `${h}:${m}`
}

// ─── 시간 포맷 ────────────────────────────────────────────────────────────────
// 정책: 모든 시각 표시는 30분 단위. 일부 레거시/외부 경로로 :15, :45 등이
//       들어와도 표시 시점에서 정합성 유지 (21:23 → 21:00, 21:45 → 21:30).
function floor30(d: Date): string {
  const h = d.getHours()
  const m = d.getMinutes() < 30 ? 0 : 30
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}
function fmtTime(iso: string | null): string {
  if (!iso) return '-'
  try { return floor30(new Date(iso)) } catch { return '-' }
}
function toHHmm(iso: string | null | undefined): string | undefined {
  if (!iso) return undefined
  try { return floor30(new Date(iso)) } catch { return undefined }
}

function colorToBadgeVariant(c: 'green' | 'yellow' | 'red'): BadgeVariant {
  if (c === 'green') return 'success'
  if (c === 'yellow') return 'warning'
  return 'danger'
}

const STATUS_BORDER: Record<'green' | 'yellow' | 'red', string> = {
  green:  'border-l-success-text',
  yellow: 'border-l-warning-text',
  red:    'border-l-danger-text',
}

// ─── 팀원 카드 ────────────────────────────────────────────────────────────────
const MemberCard = memo(function MemberCard({
  card,
  date,
  onAction,
  onOpenCheckIn,
  onCheckOutNeeded,
}: {
  card: TeamMemberCard
  date: string
  onAction: () => void
  onOpenCheckIn: (card: TeamMemberCard, mode: 'create' | 'edit' | 'complete') => void
  onCheckOutNeeded: (card: TeamMemberCard) => void
}) {
  const [busy, setBusy] = useState(false)

  const action = async (endpoint: string) => {
    setBusy(true)
    await fetch(`/api/team-status/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date }),
    })
    setBusy(false)
    onAction()
  }

  return (
    <div
      className={cn(
        'bg-surface rounded-2xl shadow-[var(--shadow-card)]',
        'border border-border border-l-[5px]',
        STATUS_BORDER[card.color],
        'p-4 flex flex-col gap-3',
      )}
    >
      {/* 상단: 이름 + 상태 배지 */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 min-w-0">
            <p className="font-semibold text-text-primary text-sm truncate">
              {card.display_name ?? card.email}
            </p>
            {card.is_self && (
              <Badge variant="info" className="!h-5 !px-1.5 !text-[10px]">나</Badge>
            )}
          </div>
          <p className="text-[12px] text-text-muted truncate mt-0.5">
            {[card.division, card.team].filter(Boolean).join(' / ') || '-'}
          </p>
        </div>
        <div className="shrink-0 flex items-center gap-1">
          {card.calendar_leave_type && !card.work_log_id && (
            <Badge variant={card.calendar_leave_type === 'full_day' ? 'warning' : 'warning'}>
              {card.calendar_leave_type === 'full_day' ? '휴가'
                : card.calendar_leave_type === 'morning_half' ? '오전반차'
                : '오후반차'}
            </Badge>
          )}
          <Badge variant={colorToBadgeVariant(card.color)} dot>
            {card.status_text}
          </Badge>
        </div>
      </div>

      {/* 정보 그리드 */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[12px] text-text-secondary tabular-nums">
        <div className="flex items-center gap-1">
          <Clock className="h-3 w-3 text-text-muted shrink-0" aria-hidden />
          <span>출근예정 {card.start_time ?? '-'}</span>
        </div>
        <div className="flex items-center gap-1">
          <Clock className="h-3 w-3 text-text-muted shrink-0" aria-hidden />
          <span>퇴근예정 {card.end_time ?? '-'}</span>
        </div>
        <div className="flex items-center gap-1">
          <LogIn className="h-3 w-3 text-text-muted shrink-0" aria-hidden />
          <span>출근 {fmtTime(card.checked_in_at)}</span>
        </div>
        <div className="flex items-center gap-1">
          <LogOut className="h-3 w-3 text-text-muted shrink-0" aria-hidden />
          <span>퇴근 {fmtTime(card.checked_out_at)}</span>
        </div>
        {card.is_on_break && (
          <div className="col-span-2 flex items-center gap-1 text-warning-text">
            <Coffee className="h-3 w-3 shrink-0" aria-hidden />
            <span>휴게 시작 {fmtTime(card.break_started_at)}</span>
          </div>
        )}
        {card.last_event_at && (
          <div className="col-span-2 text-text-muted">
            마지막 변경 {fmtTime(card.last_event_at)}
          </div>
        )}
      </div>

      {/* 캘린더 오늘 일정 */}
      {!card.calendar_leave_type && card.calendar_events && card.calendar_events.length > 0 && (
        <div className="rounded-[10px] bg-info-bg border border-info-border px-2.5 py-2">
          <div className="text-[10px] font-semibold text-info-text mb-1">오늘 일정</div>
          <ul className="space-y-0.5">
            {card.calendar_events.slice(0, 3).map((ev, i) => (
              <li key={i} className="text-[12px] text-text-primary truncate">
                {ev.startTime && ev.endTime
                  ? `${ev.startTime}~${ev.endTime}  ${ev.title}`
                  : ev.startTime
                    ? `${ev.startTime}~  ${ev.title}`
                    : `(종일) ${ev.title}`}
              </li>
            ))}
            {card.calendar_events.length > 3 && (
              <li className="text-[10px] text-text-muted">
                외 {card.calendar_events.length - 3}건 더
              </li>
            )}
          </ul>
        </div>
      )}

      {/* 근무지 — 예정 chips + 실제 chips 분리 표시 */}
      {(() => {
        const plannedChips = resolvePlannedLocations({
          planned: card.planned_work_locations,
          legacyExpectedTimeline: card.work_location_timeline,
          legacyExpectedWorkLocation: card.work_location,
        })
        const actualChips = resolveDisplayLocations({
          actual: card.actual_work_locations,
          // actual이 NULL이면 planned는 보지 않음 (위에서 따로 표시)
          legacyActualTimeline: card.actual_work_locations ? null : null,
          legacyWorkLocation: card.current_location,
        })
        const showPlanned = plannedChips && plannedChips.length > 0
        const showActual = actualChips && actualChips.length > 0
        return (
          <div className="space-y-1.5">
            {showPlanned && (
              <div className="flex items-start gap-2 text-[12px]">
                <span className="shrink-0 text-text-muted font-semibold mt-0.5">예정</span>
                <div className="flex items-center gap-1 flex-wrap text-text-secondary">
                  <MapPin className="h-3 w-3 text-text-muted shrink-0" aria-hidden />
                  {plannedChips!.map((chip, i) => (
                    <span key={i} className="inline-flex items-center">
                      {i > 0 && <span className="mx-1 text-text-muted">→</span>}
                      {chipLabel(chip)}
                    </span>
                  ))}
                </div>
              </div>
            )}
            <div className="flex items-start gap-2 text-[12px]">
              <span className="shrink-0 text-text-muted font-semibold mt-0.5">실제</span>
              <div className="flex-1 min-w-0">
                {card.is_self ? (
                  <EditableLocationChips
                    value={
                      actualChips && actualChips.length > 0
                        ? actualChips
                        : (plannedChips ?? [])
                    }
                    currentLabel={card.current_location ?? card.work_location ?? null}
                    currentIndex={card.current_location_index ?? null}
                    date={date}
                    onChange={onAction}
                    showLabels={false}
                  />
                ) : showActual ? (
                  <div className="flex items-center gap-1 flex-wrap text-text-primary font-medium">
                    <MapPin className="h-3 w-3 text-primary-600 shrink-0" aria-hidden />
                    {actualChips!.map((chip, i) => (
                      <span key={i} className="inline-flex items-center">
                        {i > 0 && <span className="mx-1 text-text-muted">→</span>}
                        {chipLabel(chip)}
                      </span>
                    ))}
                  </div>
                ) : (
                  <span className="text-text-muted">- (실제 변경 없음)</span>
                )}
              </div>
            </div>
          </div>
        )
      })()}

      {/* 출퇴근 액션 (본인만) — 5상태 분기 */}
      {card.is_self && (() => {
        const state = computeWorkLogState({
          hasWorkLog: !!card.work_log_id,
          checkedInAt: card.checked_in_at,
          checkedOutAt: card.checked_out_at,
          isOnBreak: !!card.is_on_break,
        })
        const buttons = buttonsForState(state, { useCheckInComplete: card.use_check_in_complete ?? true })
        return (
          <div className="flex flex-wrap gap-1.5 pt-2 border-t border-border">
            {/* 출근보고 작성 (A) */}
            {buttons.showCheckInCreate && (
              <Button
                variant="primary"
                size="sm"
                onClick={() => onOpenCheckIn(card, 'create')}
                disabled={busy}
              >
                <LogIn className="h-3.5 w-3.5" aria-hidden />
                출근보고 작성
              </Button>
            )}

            {/* 출근보고 수정 + 출근 완료 (B) — 이어진 디자인 */}
            {buttons.showCheckInEdit && buttons.showCheckInComplete && (
              <div className="inline-flex rounded-[8px] overflow-hidden border border-border-strong">
                <button
                  type="button"
                  onClick={() => onOpenCheckIn(card, 'edit')}
                  className="inline-flex items-center gap-1 h-8 px-2 text-[12px] font-medium text-text-primary bg-surface hover:bg-surface-muted transition-colors border-r border-border-strong"
                >
                  <Check className="h-3 w-3 text-success-text" aria-hidden />
                  수정
                </button>
                <button
                  type="button"
                  onClick={() => onOpenCheckIn(card, 'complete')}
                  className="inline-flex items-center gap-1 h-8 px-2 text-[12px] font-semibold text-white bg-primary-600 hover:bg-primary-700 transition-colors"
                >
                  <LogIn className="h-3 w-3" aria-hidden />
                  출근 완료
                </button>
              </div>
            )}

            {/* 출근보고 수정 단독 (C/D/E) */}
            {buttons.showCheckInEdit && !buttons.showCheckInComplete && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => onOpenCheckIn(card, 'edit')}
                disabled={busy}
              >
                <Check className="h-3.5 w-3.5" aria-hidden />
                출근보고 수정
              </Button>
            )}

            {/* 퇴근보고 작성 (A/B/C/D) — 항상 primary */}
            {buttons.showCheckOutCreate && (
              <Button
                variant="primary"
                size="sm"
                onClick={() => onCheckOutNeeded(card)}
                disabled={busy}
              >
                <LogOut className="h-3.5 w-3.5" aria-hidden />
                퇴근보고 작성
              </Button>
            )}

            {/* 퇴근보고 수정 (E) */}
            {buttons.showCheckOutEdit && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => onCheckOutNeeded(card)}
                disabled={busy}
              >
                <Check className="h-3.5 w-3.5" aria-hidden />
                퇴근보고 수정
              </Button>
            )}

            {/* 휴게 시작 — 평상시 secondary */}
            {buttons.showBreakStart && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => action('break-start')}
                disabled={busy}
              >
                <Coffee className="h-3.5 w-3.5" aria-hidden />
                휴게 시작
              </Button>
            )}
            {/* 휴게 종료 — 진행 중 강조 (warning-soft) */}
            {buttons.showBreakEnd && (
              <Button
                variant="warning-soft"
                size="sm"
                onClick={() => action('break-end')}
                disabled={busy}
              >
                <Coffee className="h-3.5 w-3.5" aria-hidden />
                휴게 종료
              </Button>
            )}
          </div>
        )
      })()}
    </div>
  )
})

// ─── 팀원 리스트 행 (리스트뷰 전용) ───────────────────────────────────────────
const MemberListRow = memo(function MemberListRow({
  card,
  date,
  onAction,
  onOpenCheckIn,
  onCheckOutNeeded,
}: {
  card: TeamMemberCard
  date: string
  onAction: () => void
  onOpenCheckIn: (card: TeamMemberCard, mode: 'create' | 'edit' | 'complete') => void
  onCheckOutNeeded: (card: TeamMemberCard) => void
}) {
  const [busy, setBusy] = useState(false)

  const action = async (endpoint: string) => {
    setBusy(true)
    await fetch(`/api/team-status/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date }),
    })
    setBusy(false)
    onAction()
  }

  const leaveLabel =
    card.calendar_leave_type === 'full_day' ? '휴가'
    : card.calendar_leave_type === 'morning_half' ? '오전반차'
    : card.calendar_leave_type === 'afternoon_half' ? '오후반차'
    : null

  return (
    <tr className={cn(TR_HOVER, 'border-l-[3px]', STATUS_BORDER[card.color])}>
      {/* 이름 / 소속 */}
      <Td>
        <div className="flex items-center gap-1.5">
          <span className="font-semibold text-text-primary">
            {card.display_name ?? card.email}
          </span>
          {card.is_self && (
            <Badge variant="info" className="!h-5 !px-1.5 !text-[10px]">나</Badge>
          )}
        </div>
        <div className="text-[11px] text-text-muted truncate mt-0.5">
          {[card.division, card.team].filter(Boolean).join(' / ') || '-'}
        </div>
      </Td>

      {/* 상태 */}
      <Td>
        <div className="flex items-center gap-1">
          {leaveLabel && !card.work_log_id && (
            <Badge variant="warning">{leaveLabel}</Badge>
          )}
          <Badge variant={colorToBadgeVariant(card.color)} dot>
            {card.status_text}
          </Badge>
        </div>
      </Td>

      {/* 출근/퇴근 예정 */}
      <Td className="tabular-nums">{card.start_time ?? '-'}</Td>
      <Td className="tabular-nums">{card.end_time ?? '-'}</Td>

      {/* 실제 출근/퇴근 */}
      <Td className="tabular-nums">{fmtTime(card.checked_in_at)}</Td>
      <Td className="tabular-nums">{fmtTime(card.checked_out_at)}</Td>

      {/* 휴게 */}
      <Td className="tabular-nums">
        {card.is_on_break ? (
          <span className="inline-flex items-center gap-1 text-warning-text">
            <Coffee className="h-3 w-3" aria-hidden />
            {fmtTime(card.break_started_at)}
          </span>
        ) : (
          <span className="text-text-muted">-</span>
        )}
      </Td>

      {/* 근무지 — 리스트뷰는 컴팩트, 두 줄로 예정/실제 */}
      <Td>
        {(() => {
          const plannedChips = resolvePlannedLocations({
            planned: card.planned_work_locations,
            legacyExpectedTimeline: card.work_location_timeline,
            legacyExpectedWorkLocation: card.work_location,
          })
          const actualChips = resolveDisplayLocations({
            actual: card.actual_work_locations,
            legacyWorkLocation: card.current_location,
          })
          return (
            <div className="space-y-0.5">
              {plannedChips && plannedChips.length > 0 && (
                <div className="text-[11px] text-text-muted">
                  <span className="font-semibold mr-1">예정</span>
                  {formatChipsArrow(plannedChips)}
                </div>
              )}
              {card.is_self ? (
                <EditableLocationChips
                  value={
                    actualChips && actualChips.length > 0
                      ? actualChips
                      : (plannedChips ?? [])
                  }
                  currentLabel={card.current_location ?? card.work_location ?? null}
                  currentIndex={card.current_location_index ?? null}
                  date={date}
                  onChange={onAction}
                  showLabels={false}
                  chipSize="sm"
                />
              ) : (
                <div className="text-[12px] text-text-primary font-medium inline-flex items-center gap-1">
                  <MapPin className="h-3 w-3 text-primary-600 shrink-0" aria-hidden />
                  {actualChips && actualChips.length > 0
                    ? formatChipsArrow(actualChips)
                    : (card.current_location ?? card.work_location ?? '-')}
                </div>
              )}
            </div>
          )
        })()}
      </Td>

      {/* 액션 (본인만) — 5상태 분기 */}
      <Td>
        {card.is_self ? (() => {
          const state = computeWorkLogState({
            hasWorkLog: !!card.work_log_id,
            checkedInAt: card.checked_in_at,
            checkedOutAt: card.checked_out_at,
            isOnBreak: !!card.is_on_break,
          })
          const buttons = buttonsForState(state, { useCheckInComplete: card.use_check_in_complete ?? true })
          return (
            <div className="flex flex-wrap gap-1">
              {buttons.showCheckInCreate && (
                <Button variant="primary" size="sm" onClick={() => onOpenCheckIn(card, 'create')} disabled={busy} className="!h-7 !px-2 !text-[11px]">
                  <LogIn className="h-3 w-3" aria-hidden /> 출근보고
                </Button>
              )}
              {buttons.showCheckInEdit && buttons.showCheckInComplete && (
                <div className="inline-flex rounded-[6px] overflow-hidden border border-border-strong">
                  <button onClick={() => onOpenCheckIn(card, 'edit')} className="h-7 px-2 text-[11px] font-medium text-text-primary bg-surface hover:bg-surface-muted border-r border-border-strong">수정</button>
                  <button onClick={() => onOpenCheckIn(card, 'complete')} className="h-7 px-2 text-[11px] font-semibold text-white bg-primary-600 hover:bg-primary-700">출근 완료</button>
                </div>
              )}
              {buttons.showCheckInEdit && !buttons.showCheckInComplete && (
                <Button variant="secondary" size="sm" onClick={() => onOpenCheckIn(card, 'edit')} disabled={busy} className="!h-7 !px-2 !text-[11px]">
                  <Check className="h-3 w-3" aria-hidden /> 출근수정
                </Button>
              )}
              {buttons.showCheckOutCreate && (
                <Button variant="primary" size="sm" onClick={() => onCheckOutNeeded(card)} disabled={busy} className="!h-7 !px-2 !text-[11px]">
                  <LogOut className="h-3 w-3" aria-hidden /> 퇴근
                </Button>
              )}
              {buttons.showCheckOutEdit && (
                <Button variant="secondary" size="sm" onClick={() => onCheckOutNeeded(card)} disabled={busy} className="!h-7 !px-2 !text-[11px]">
                  <Check className="h-3 w-3" aria-hidden /> 퇴근수정
                </Button>
              )}
              {buttons.showBreakStart && (
                <Button variant="secondary" size="sm" onClick={() => action('break-start')} disabled={busy} className="!h-7 !px-2 !text-[11px]">
                  <Coffee className="h-3 w-3" aria-hidden /> 휴게
                </Button>
              )}
              {buttons.showBreakEnd && (
                <Button variant="warning-soft" size="sm" onClick={() => action('break-end')} disabled={busy} className="!h-7 !px-2 !text-[11px]">
                  <Coffee className="h-3 w-3" aria-hidden /> 종료
                </Button>
              )}
            </div>
          )
        })() : (
          <span className="text-text-muted text-[11px]">-</span>
        )}
      </Td>
    </tr>
  )
})

// ─── 메인 페이지 ──────────────────────────────────────────────────────────────
export default function TeamPage() {
  const today = format(new Date(), 'yyyy-MM-dd')
  const [date, setDate]         = useState(today)
  const [cards, setCards]       = useState<TeamMemberCard[]>([])
  const [loading, setLoading]   = useState(true)
  const [filterDiv, setFilterDiv] = useState('')
  const [filterTeam, setFilterTeam] = useState('')
  const [orgDivisions, setOrgDivisions] = useState<{ id: string; name: string; teams: { id: string; name: string }[] }[]>([])
  const [checkInTarget, setCheckInTarget] = useState<{ card: TeamMemberCard; mode: 'create' | 'edit' | 'complete' } | null>(null)
  const [checkOutTarget,    setCheckOutTarget]    = useState<TeamMemberCard | null>(null)
  const [showHeaderCheckIn, setShowHeaderCheckIn] = useState(false)
  const [myProfile, setMyProfile] = useState<{ display_name: string | null; division: string | null; team: string | null } | null>(null)
  // 초기 fetch는 mine_team=true — 서버가 본인 division/team으로 자체 필터링.
  // 사용자가 직접 본부/팀 dropdown을 바꾸면 false로 전환되어 명시 필터 사용.
  const [mineTeamMode, setMineTeamMode] = useState(true)
  const [viewMode, setViewMode] = useState<ViewMode>(readViewMode)

  // viewMode 변경 시 localStorage 저장
  useEffect(() => {
    if (typeof window === 'undefined') return
    try { localStorage.setItem('team-view-mode', viewMode) } catch {}
  }, [viewMode])

  useEffect(() => {
    let cancelled = false
    Promise.all([
      fetch('/api/org').then(r => r.json()).catch(() => null),
      fetch('/api/auth/profile').then(r => r.json()).catch(() => null),
    ]).then(([orgData, profileData]) => {
      if (cancelled) return
      if (Array.isArray(orgData)) setOrgDivisions(orgData)
      if (profileData?.email) {
        setMyProfile({
          display_name: profileData.display_name,
          division: profileData.division,
          team: profileData.team,
        })
        // dropdown 표시용 — mineTeamMode=true 동안엔 쿼리에 사용되지 않으나 UI는 동기화.
        setFilterDiv(prev => prev || profileData.division || '')
        setFilterTeam(prev => prev || profileData.team || '')
      }
    })
    return () => { cancelled = true }
  }, [])

  const fetchCards = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ date })
      if (mineTeamMode) {
        // 첫 진입 — 서버가 본인 division/team 자체 조회. profile 응답 대기 불필요.
        params.set('mine_team', 'true')
      } else {
        if (filterDiv)  params.set('division', filterDiv)
        if (filterTeam) params.set('team', filterTeam)
      }
      const res = await fetch(`/api/team-status?${params}`, { cache: 'no-store' })
      const data = await res.json()
      if (Array.isArray(data)) {
        // 변경되지 않은 카드는 이전 객체 참조를 유지 — React.memo가 실제로 skip되도록.
        // 50개 카드 × small JSON ≈ 5-10ms. 매 fetch마다 새 객체로 덮으면 모든 카드 재렌더.
        setCards(prev => {
          if (!Array.isArray(prev) || prev.length === 0) return data
          const prevByEmail = new Map(prev.map(c => [c.email, c]))
          return data.map(newCard => {
            const old = prevByEmail.get(newCard.email)
            if (!old) return newCard
            try {
              return JSON.stringify(old) === JSON.stringify(newCard) ? old : newCard
            } catch { return newCard }
          })
        })
      }
    } catch {
      setCards([])
    } finally {
      setLoading(false)
    }
  }, [date, mineTeamMode, filterDiv, filterTeam])

  // 중복 fetch 방지 — 동일한 쿼리 조합이면 skip.
  // (mineTeamMode=true 인 동안 profile 응답으로 filterDiv/filterTeam이 채워져도
  //  서버에 보내는 쿼리는 동일하므로 재호출 불필요.)
  const lastQueryKeyRef = useRef('')
  useEffect(() => {
    const queryKey = mineTeamMode
      ? `mine__${date}`
      : `manual__${date}__${filterDiv}__${filterTeam}`
    if (queryKey === lastQueryKeyRef.current) return
    lastQueryKeyRef.current = queryKey
    fetchCards()
  }, [fetchCards, mineTeamMode, date, filterDiv, filterTeam])

  // 안정 콜백 — memo'd MemberCard/MemberListRow의 prop identity 고정
  const handleOpenCheckIn = useCallback(
    (c: TeamMemberCard, mode: 'create' | 'edit' | 'complete') => {
      setCheckInTarget({ card: c, mode })
    },
    [],
  )

  const availableTeams = orgDivisions.find(d => d.name === filterDiv)?.teams ?? []

  const prevDay = () => setDate(d => format(subDays(parseISO(d), 1), 'yyyy-MM-dd'))
  const nextDay = () => setDate(d => format(addDays(parseISO(d), 1), 'yyyy-MM-dd'))

  // 카드 색상별 카운트 (요약 표시용)
  const greenCount  = cards.filter(c => c.color === 'green').length
  const yellowCount = cards.filter(c => c.color === 'yellow').length
  const redCount    = cards.filter(c => c.color === 'red').length

  return (
    <div className="space-y-5">
      <PageHeader
        title="둘러보기"
        description="팀원들의 출근/퇴근/휴게 상태를 한눈에 확인합니다."
        actions={
          <div className="flex items-center gap-2">
            {/* 뷰 모드 토글 */}
            <div
              role="group"
              aria-label="뷰 모드"
              className="inline-flex rounded-[10px] border border-border-strong bg-surface p-0.5"
            >
              <button
                type="button"
                onClick={() => setViewMode('card')}
                className={cn(
                  'inline-flex items-center gap-1 h-8 px-2.5 rounded-[8px] text-[12px] font-medium transition-colors',
                  viewMode === 'card'
                    ? 'bg-surface-muted text-text-primary'
                    : 'text-text-muted hover:text-text-primary',
                )}
                aria-pressed={viewMode === 'card'}
                aria-label="카드뷰"
              >
                <LayoutGrid className="h-3.5 w-3.5" aria-hidden />
                카드
              </button>
              <button
                type="button"
                onClick={() => setViewMode('list')}
                className={cn(
                  'inline-flex items-center gap-1 h-8 px-2.5 rounded-[8px] text-[12px] font-medium transition-colors',
                  viewMode === 'list'
                    ? 'bg-surface-muted text-text-primary'
                    : 'text-text-muted hover:text-text-primary',
                )}
                aria-pressed={viewMode === 'list'}
                aria-label="리스트뷰"
              >
                <List className="h-3.5 w-3.5" aria-hidden />
                리스트
              </button>
            </div>
            <Button variant="ghost" onClick={fetchCards}>
              <RefreshCw className="h-4 w-4" aria-hidden />
              새로고침
            </Button>
          </div>
        }
      />

      {/* 필터 바 */}
      <FilterBar>
        {/* 날짜 이동 */}
        <FilterBar.Field label="날짜">
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" iconOnly onClick={prevDay} aria-label="이전 날짜">
              <ChevronLeft className="h-4 w-4" aria-hidden />
            </Button>
            <DateInputWithDow
              value={date}
              onChange={setDate}
              className={
                date === today
                  ? 'min-w-[150px] !text-base !font-semibold !border-primary-500 !bg-primary-50 !text-primary-700'
                  : 'min-w-[150px] !text-base !font-semibold !border-warning-text !bg-warning-bg !text-warning-text'
              }
            />
            <Button
              variant="ghost"
              size="sm"
              iconOnly
              onClick={nextDay}
              disabled={date >= today}
              aria-label="다음 날짜"
            >
              <ChevronRight className="h-4 w-4" aria-hidden />
            </Button>
          </div>
        </FilterBar.Field>

        <FilterBar.Field label="본부">
          <Select
            value={filterDiv}
            onChange={e => {
              setMineTeamMode(false)  // 사용자 명시 필터 — 더 이상 서버 본인 매핑 사용 X
              setFilterDiv(e.target.value)
              setFilterTeam('')
            }}
            className="min-w-[140px]"
          >
            <option value="">전체 본부</option>
            {orgDivisions.map(d => <option key={d.id} value={d.name}>{d.name}</option>)}
          </Select>
        </FilterBar.Field>

        <FilterBar.Field label="팀">
          <Select
            value={filterTeam}
            onChange={e => {
              setMineTeamMode(false)
              setFilterTeam(e.target.value)
            }}
            disabled={!filterDiv}
            className="min-w-[140px]"
          >
            <option value="">전체 팀</option>
            {availableTeams.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
          </Select>
        </FilterBar.Field>

        <div className="ml-auto flex items-center gap-2 text-[12px] text-text-secondary">
          <span className="font-semibold text-text-primary">{cards.length}명</span>
          {greenCount  > 0 && <Badge variant="success" dot>근무 {greenCount}</Badge>}
          {yellowCount > 0 && <Badge variant="warning" dot>보고 {yellowCount}</Badge>}
          {redCount    > 0 && <Badge variant="danger"  dot>미제출 {redCount}</Badge>}
        </div>
      </FilterBar>

      {/* 본문 — 카드뷰 / 리스트뷰 */}
      {loading ? (
        viewMode === 'card' ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {[...Array(8)].map((_, i) => (
              <div key={i} className="h-44 bg-surface-muted rounded-2xl animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="h-64 bg-surface-muted rounded-2xl animate-pulse" />
        )
      ) : cards.length === 0 ? (
        <div className="py-16 text-center text-sm text-text-muted">
          해당 날짜/조직의 팀원이 없습니다.
        </div>
      ) : viewMode === 'card' ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {cards.map(card => (
            <MemberCard
              key={card.email}
              card={card}
              date={date}
              onAction={fetchCards}
              onOpenCheckIn={handleOpenCheckIn}
              onCheckOutNeeded={setCheckOutTarget}
            />
          ))}
        </div>
      ) : (
        <TableContainer>
          <TableScroll>
            <Table>
              <thead>
                <tr>
                  <Th>이름 / 소속</Th>
                  <Th>상태</Th>
                  <Th>출근예정</Th>
                  <Th>퇴근예정</Th>
                  <Th>실제 출근</Th>
                  <Th>실제 퇴근</Th>
                  <Th>휴게</Th>
                  <Th>근무지</Th>
                  <Th>액션</Th>
                </tr>
              </thead>
              <tbody>
                {cards.map(card => (
                  <MemberListRow
                    key={card.email}
                    card={card}
                    date={date}
                    onAction={fetchCards}
                    onOpenCheckIn={handleOpenCheckIn}
                    onCheckOutNeeded={setCheckOutTarget}
                  />
                ))}
              </tbody>
            </Table>
          </TableScroll>
        </TableContainer>
      )}

      {/* 출근보고 작성/수정/출근완료 모달 */}
      {(checkInTarget || showHeaderCheckIn) && (
        <CheckInModal
          date={date}
          userName={myProfile?.display_name ?? null}
          mode={checkInTarget?.mode}
          onClose={() => { setCheckInTarget(null); setShowHeaderCheckIn(false) }}
          onSuccess={() => { setCheckInTarget(null); setShowHeaderCheckIn(false); fetchCards() }}
        />
      )}

      {/* 퇴근보고 모달 */}
      {checkOutTarget && (
        <WorkLogModal
          date={date}
          userName={myProfile?.display_name ?? null}
          initialTimeline={checkOutTarget.work_location_timeline ?? null}
          initialActualLocations={checkOutTarget.actual_work_locations ?? null}
          initialPlannedLocations={checkOutTarget.planned_work_locations ?? null}
          initialLeaveTimeline={checkOutTarget.leave_timeline ?? null}
          initialBreakAutoActualMinutes={checkOutTarget.break_auto_actual_minutes ?? null}
          initialStartTime={
            toHHmm(checkOutTarget.checked_in_at) ?? checkOutTarget.start_time ?? undefined
          }
          initialEndTime={checkOutTarget.end_time ?? undefined}
          resubmitWorkLogId={checkOutTarget.work_log_id ?? null}
          onClose={() => setCheckOutTarget(null)}
          onSuccess={() => { setCheckOutTarget(null); fetchCards() }}
        />
      )}
    </div>
  )
}
