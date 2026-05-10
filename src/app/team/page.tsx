'use client'

import { useState, useEffect, useCallback } from 'react'
import { format, addDays, subDays, parseISO } from 'date-fns'
import { ko } from 'date-fns/locale'
import { ChevronLeft, ChevronRight, RefreshCw, MapPin, Clock, Coffee, LogIn, LogOut, X, LayoutGrid, List } from 'lucide-react'
import CheckInModal from '@/components/CheckInModal'
import WorkLogModal from '@/components/WorkLogModal'
import {
  Button, Badge, Select, FilterBar, PageHeader,
  TableContainer, TableScroll, Table, Th, Td, TR_HOVER,
} from '@/components/ui'
import type { BadgeVariant } from '@/components/ui'
import { cn } from '@/lib/utils/cn'
import type { TeamMemberCard } from '@/app/api/team-status/route'
import { resolveDisplayLocations, resolvePlannedLocations, chipLabel, formatChipsArrow } from '@/lib/work-locations-v2'
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
function fmtTime(iso: string | null): string {
  if (!iso) return '-'
  try { return format(new Date(iso), 'HH:mm') } catch { return '-' }
}
function toHHmm(iso: string | null | undefined): string | undefined {
  if (!iso) return undefined
  try { return format(new Date(iso), 'HH:mm') } catch { return undefined }
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

// ─── 근무지 변경 드롭다운 ─────────────────────────────────────────────────────
const LOCATION_OPTIONS = ['사무실', '재택', '외근', '기타'] as const

function LocationSelect({
  current, date, onChange, target = 'planned',
}: {
  current: string | null
  date: string
  onChange: (loc: string) => void
  /** 'planned' (예정 갱신, 기본) | 'actual' (실제 갱신) */
  target?: 'planned' | 'actual'
}) {
  const [custom, setCustom] = useState('')
  const [showCustom, setShowCustom] = useState(false)
  const [saving, setSaving] = useState(false)

  const handleChange = async (val: string) => {
    if (val === '기타') { setShowCustom(true); return }
    setShowCustom(false)
    setSaving(true)
    await fetch('/api/team-status/location', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date, location: val, target }),
    })
    setSaving(false)
    onChange(val)
  }
  const handleCustomSubmit = async () => {
    if (!custom.trim()) return
    setSaving(true)
    await fetch('/api/team-status/location', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date, location: custom.trim(), target }),
    })
    setSaving(false)
    onChange(custom.trim())
    setShowCustom(false)
    setCustom('')
  }

  const isStandard = LOCATION_OPTIONS.includes(current as typeof LOCATION_OPTIONS[number])

  return (
    <div className="flex items-center gap-1.5">
      <MapPin className="h-3.5 w-3.5 text-text-muted shrink-0" aria-hidden />
      {showCustom ? (
        <div className="flex items-center gap-1">
          <input
            value={custom}
            onChange={e => setCustom(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleCustomSubmit() }}
            placeholder="장소 입력"
            className="h-7 w-24 rounded-[8px] border border-border-strong px-2 text-[12px] focus:outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20"
            autoFocus
          />
          <Button variant="ghost" size="sm" onClick={handleCustomSubmit} disabled={saving} className="!h-7 !px-2 text-[12px]">
            확인
          </Button>
          <button
            onClick={() => setShowCustom(false)}
            className="text-text-muted hover:text-text-primary"
            aria-label="취소"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
      ) : (
        <Select
          selectSize="sm"
          value={isStandard ? current ?? '사무실' : '기타'}
          onChange={e => handleChange(e.target.value)}
          disabled={saving}
          className="!h-7 !text-[12px] !py-0 w-24"
        >
          {LOCATION_OPTIONS.map(l => <option key={l} value={l}>{l}</option>)}
          {current && !isStandard && <option value={current}>{current}</option>}
        </Select>
      )}
      {!showCustom && current && !isStandard && (
        <span className="text-[12px] text-text-muted">({current})</span>
      )}
    </div>
  )
}

// ─── 팀원 카드 ────────────────────────────────────────────────────────────────
function MemberCard({
  card,
  date,
  onAction,
  onOpenCheckInTime,
  onCheckOutNeeded,
}: {
  card: TeamMemberCard
  date: string
  onAction: () => void
  onOpenCheckInTime: (card: TeamMemberCard) => void
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
                  <div className="space-y-1">
                    {showActual && (
                      <div className="flex items-center gap-1 flex-wrap text-text-primary font-medium">
                        <MapPin className="h-3 w-3 text-primary-600 shrink-0" aria-hidden />
                        {actualChips!.map((chip, i) => (
                          <span key={i} className="inline-flex items-center">
                            {i > 0 && <span className="mx-1 text-text-muted">→</span>}
                            {chipLabel(chip)}
                          </span>
                        ))}
                      </div>
                    )}
                    {/* 본인 카드 — 실제 근무지 추가 (actual에 칩 append) */}
                    <LocationSelect
                      current={card.current_location ?? card.work_location}
                      date={date}
                      onChange={onAction}
                      target="actual"
                    />
                  </div>
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

      {/* 출퇴근 액션 (본인만) */}
      {card.is_self && (
        <div className="flex flex-wrap gap-1.5 pt-2 border-t border-border">
          {!card.checked_in_at ? (
            <Button
              variant="primary"
              size="sm"
              onClick={() => onOpenCheckInTime(card)}
              disabled={busy}
            >
              <LogIn className="h-3.5 w-3.5" aria-hidden />
              출근
            </Button>
          ) : (
            <Button
              variant="danger-soft"
              size="sm"
              onClick={() => action('check-in-cancel')}
              disabled={busy}
            >
              <X className="h-3.5 w-3.5" aria-hidden />
              출근취소
            </Button>
          )}

          {!card.checked_out_at && (
            <Button
              variant="primary"
              size="sm"
              onClick={() => onCheckOutNeeded(card)}
              disabled={busy}
            >
              <LogOut className="h-3.5 w-3.5" aria-hidden />
              퇴근
            </Button>
          )}
          {card.checked_out_at && (
            <Button
              variant="danger-soft"
              size="sm"
              onClick={() => action('check-out-cancel')}
              disabled={busy}
            >
              <X className="h-3.5 w-3.5" aria-hidden />
              퇴근취소
            </Button>
          )}

          {card.checked_in_at && !card.checked_out_at && (
            !card.is_on_break ? (
              <Button
                variant="warning-soft"
                size="sm"
                onClick={() => action('break-start')}
                disabled={busy}
              >
                <Coffee className="h-3.5 w-3.5" aria-hidden />
                휴게시작
              </Button>
            ) : (
              <Button
                variant="warning-soft"
                size="sm"
                onClick={() => action('break-end')}
                disabled={busy}
                className="!bg-warning-text !text-white !border-warning-text hover:!bg-warning-text/90"
              >
                <Coffee className="h-3.5 w-3.5" aria-hidden />
                휴게종료
              </Button>
            )
          )}
        </div>
      )}
    </div>
  )
}

// ─── 팀원 리스트 행 (리스트뷰 전용) ───────────────────────────────────────────
function MemberListRow({
  card,
  date,
  onAction,
  onOpenCheckInTime,
  onCheckOutNeeded,
}: {
  card: TeamMemberCard
  date: string
  onAction: () => void
  onOpenCheckInTime: (card: TeamMemberCard) => void
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
                <LocationSelect
                  current={card.current_location ?? card.work_location}
                  date={date}
                  onChange={onAction}
                  target="actual"
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

      {/* 액션 (본인만) */}
      <Td>
        {card.is_self ? (
          <div className="flex flex-wrap gap-1">
            {!card.checked_in_at ? (
              <Button
                variant="primary"
                size="sm"
                onClick={() => onOpenCheckInTime(card)}
                disabled={busy}
                className="!h-7 !px-2 !text-[11px]"
              >
                <LogIn className="h-3 w-3" aria-hidden />
                출근
              </Button>
            ) : (
              <Button
                variant="danger-soft"
                size="sm"
                onClick={() => action('check-in-cancel')}
                disabled={busy}
                className="!h-7 !px-2 !text-[11px]"
              >
                <X className="h-3 w-3" aria-hidden />
                출근취소
              </Button>
            )}
            {!card.checked_out_at && (
              <Button
                variant="primary"
                size="sm"
                onClick={() => onCheckOutNeeded(card)}
                disabled={busy}
                className="!h-7 !px-2 !text-[11px]"
              >
                <LogOut className="h-3 w-3" aria-hidden />
                퇴근
              </Button>
            )}
            {card.checked_out_at && (
              <Button
                variant="danger-soft"
                size="sm"
                onClick={() => action('check-out-cancel')}
                disabled={busy}
                className="!h-7 !px-2 !text-[11px]"
              >
                <X className="h-3 w-3" aria-hidden />
                퇴근취소
              </Button>
            )}
            {card.checked_in_at && !card.checked_out_at && (
              !card.is_on_break ? (
                <Button
                  variant="warning-soft"
                  size="sm"
                  onClick={() => action('break-start')}
                  disabled={busy}
                  className="!h-7 !px-2 !text-[11px]"
                >
                  <Coffee className="h-3 w-3" aria-hidden />
                  휴게
                </Button>
              ) : (
                <Button
                  variant="warning-soft"
                  size="sm"
                  onClick={() => action('break-end')}
                  disabled={busy}
                  className="!h-7 !px-2 !text-[11px] !bg-warning-text !text-white !border-warning-text hover:!bg-warning-text/90"
                >
                  <Coffee className="h-3 w-3" aria-hidden />
                  종료
                </Button>
              )
            )}
          </div>
        ) : (
          <span className="text-text-muted text-[11px]">-</span>
        )}
      </Td>
    </tr>
  )
}

// ─── 메인 페이지 ──────────────────────────────────────────────────────────────
export default function TeamPage() {
  const today = format(new Date(), 'yyyy-MM-dd')
  const [date, setDate]         = useState(today)
  const [cards, setCards]       = useState<TeamMemberCard[]>([])
  const [loading, setLoading]   = useState(true)
  const [filterDiv, setFilterDiv] = useState('')
  const [filterTeam, setFilterTeam] = useState('')
  const [orgDivisions, setOrgDivisions] = useState<{ id: string; name: string; teams: { id: string; name: string }[] }[]>([])
  const [checkInTarget, setCheckInTarget] = useState<{ card: TeamMemberCard; startTime: string } | null>(null)
  const [checkOutTarget,    setCheckOutTarget]    = useState<TeamMemberCard | null>(null)
  const [showHeaderCheckIn, setShowHeaderCheckIn] = useState(false)
  const [myProfile, setMyProfile] = useState<{ display_name: string | null; division: string | null; team: string | null } | null>(null)
  const [profileReady, setProfileReady] = useState(false)
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
        setFilterDiv(prev => prev || profileData.division || '')
        setFilterTeam(prev => prev || profileData.team || '')
      }
      setProfileReady(true)
    })
    return () => { cancelled = true }
  }, [])

  const fetchCards = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ date })
      if (filterDiv)  params.set('division', filterDiv)
      if (filterTeam) params.set('team', filterTeam)
      const res = await fetch(`/api/team-status?${params}`)
      const data = await res.json()
      if (Array.isArray(data)) setCards(data)
    } catch {
      setCards([])
    } finally {
      setLoading(false)
    }
  }, [date, filterDiv, filterTeam])

  useEffect(() => {
    if (!profileReady) return
    fetchCards()
  }, [fetchCards, profileReady])

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
            <input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              className="h-10 rounded-[10px] border border-border-strong bg-surface px-3 text-sm focus:outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20"
            />
            <span className="text-[12px] text-text-muted whitespace-nowrap px-1">
              ({format(parseISO(date), 'eee', { locale: ko })})
            </span>
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
            onChange={e => { setFilterDiv(e.target.value); setFilterTeam('') }}
            className="min-w-[140px]"
          >
            <option value="">전체 본부</option>
            {orgDivisions.map(d => <option key={d.id} value={d.name}>{d.name}</option>)}
          </Select>
        </FilterBar.Field>

        <FilterBar.Field label="팀">
          <Select
            value={filterTeam}
            onChange={e => setFilterTeam(e.target.value)}
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
              onOpenCheckInTime={(c) => setCheckInTarget({ card: c, startTime: nowRoundedTo30() })}
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
                    onOpenCheckInTime={(c) => setCheckInTarget({ card: c, startTime: nowRoundedTo30() })}
                    onCheckOutNeeded={setCheckOutTarget}
                  />
                ))}
              </tbody>
            </Table>
          </TableScroll>
        </TableContainer>
      )}

      {/* 출근보고 작성 모달 */}
      {(checkInTarget || showHeaderCheckIn) && (
        <CheckInModal
          date={date}
          userName={myProfile?.display_name ?? null}
          initialStartTime={checkInTarget?.startTime}
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
