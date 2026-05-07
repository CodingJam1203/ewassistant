'use client'

import { useState, useEffect, useCallback } from 'react'
import { format, addDays, subDays, parseISO } from 'date-fns'
import { ko } from 'date-fns/locale'
import { ChevronLeft, ChevronRight, RefreshCw, MapPin, Clock, Coffee, LogIn, LogOut, X } from 'lucide-react'
import CheckInModal from '@/components/CheckInModal'
import { getKstTodayDateString } from '@/lib/utils/date'
import WorkLogModal from '@/components/WorkLogModal'

/** 현재 시각을 30분 단위로 floor한 'HH:mm' 문자열 (KST 기준) */
function nowRoundedTo30(): string {
  const now = new Date()
  const h = now.getHours().toString().padStart(2, '0')
  const m = now.getMinutes() < 30 ? '00' : '30'
  return `${h}:${m}`
}
import type { TeamMemberCard } from '@/app/api/team-status/route'

// ─── 상태 색상 ────────────────────────────────────────────────────────────────
function StatusDot({ color }: { color: 'green' | 'yellow' | 'red' }) {
  const cls = {
    green:  'bg-green-400',
    yellow: 'bg-yellow-400',
    red:    'bg-red-400',
  }[color]
  return <span className={`inline-block w-3 h-3 rounded-full ${cls} flex-shrink-0`} />
}

// ─── 시간 포맷 ────────────────────────────────────────────────────────────────
function fmtTime(iso: string | null): string {
  if (!iso) return '-'
  try { return format(new Date(iso), 'HH:mm') } catch { return '-' }
}

/** ISO → 'HH:mm' 변환. 실패 시 undefined 반환 (pre-fill 용) */
function toHHmm(iso: string | null | undefined): string | undefined {
  if (!iso) return undefined
  try { return format(new Date(iso), 'HH:mm') } catch { return undefined }
}

// ─── 근무지 변경 드롭다운 ─────────────────────────────────────────────────────
const LOCATION_OPTIONS = ['사무실', '재택', '외근', '기타'] as const

function LocationSelect({
  current, date, onChange
}: {
  current: string | null
  date: string
  onChange: (loc: string) => void
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
      body: JSON.stringify({ date, location: val }),
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
      body: JSON.stringify({ date, location: custom.trim() }),
    })
    setSaving(false)
    onChange(custom.trim())
    setShowCustom(false)
    setCustom('')
  }

  return (
    <div className="flex items-center gap-1">
      <MapPin className="h-3 w-3 text-gray-400 flex-shrink-0" />
      {showCustom ? (
        <div className="flex items-center gap-1">
          <input
            value={custom}
            onChange={e => setCustom(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleCustomSubmit() }}
            placeholder="장소 입력"
            className="border border-gray-300 rounded px-1.5 py-0.5 text-xs w-20 focus:outline-none focus:ring-1 focus:ring-blue-400"
            autoFocus
          />
          <button onClick={handleCustomSubmit} disabled={saving}
            className="text-xs text-blue-600 hover:text-blue-800 font-medium">확인</button>
          <button onClick={() => setShowCustom(false)}
            className="text-gray-400 hover:text-gray-600"><X className="h-3 w-3" /></button>
        </div>
      ) : (
        <select
          value={LOCATION_OPTIONS.includes(current as typeof LOCATION_OPTIONS[number]) ? current ?? '사무실' : '기타'}
          onChange={e => handleChange(e.target.value)}
          disabled={saving}
          className="text-xs text-gray-700 border-none bg-transparent cursor-pointer focus:outline-none focus:ring-1 focus:ring-blue-400 rounded px-0.5 disabled:opacity-50"
        >
          {LOCATION_OPTIONS.map(l => <option key={l} value={l}>{l}</option>)}
          {current && !LOCATION_OPTIONS.includes(current as typeof LOCATION_OPTIONS[number]) && (
            <option value={current}>{current}</option>
          )}
        </select>
      )}
      {!showCustom && current && !LOCATION_OPTIONS.includes(current as typeof LOCATION_OPTIONS[number]) && (
        <span className="text-xs text-gray-500">({current})</span>
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

  const handleCheckIn = () => {
    onOpenCheckInTime(card) // 시각 선택 팝업으로 이동
  }

  const handleCheckOut = () => {
    onCheckOutNeeded(card)
  }

  const borderColor = {
    green:  'border-l-green-400',
    yellow: 'border-l-yellow-400',
    red:    'border-l-red-400',
  }[card.color]

  return (
    <div className={`bg-white rounded-xl shadow-sm border border-gray-100 border-l-4 ${borderColor} p-4 flex flex-col gap-3`}>
      {/* 상단: 상태 + 이름 */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <StatusDot color={card.color} />
          <div className="min-w-0">
            <p className="font-semibold text-gray-900 text-sm truncate">
              {card.display_name ?? card.email}
              {card.is_self && (
                <span className="ml-1.5 text-xs font-normal text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded-full">나</span>
              )}
            </p>
            <p className="text-xs text-gray-400 truncate">
              {[card.division, card.team].filter(Boolean).join(' / ') || '-'}
            </p>
          </div>
        </div>
        <div className="flex-shrink-0 flex items-center gap-1">
          {/* 캘린더 휴가 배지 — work_log 없을 때만 의미 있음 (있을 때는 기존 status가 우선) */}
          {card.calendar_leave_type && !card.work_log_id && (
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
              card.calendar_leave_type === 'full_day'
                ? 'bg-amber-100 text-amber-700'
                : 'bg-orange-100 text-orange-700'
            }`}>
              {card.calendar_leave_type === 'full_day' ? '휴가'
                : card.calendar_leave_type === 'morning_half' ? '오전반차'
                : '오후반차'}
            </span>
          )}
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full
            ${card.color === 'green'  ? 'bg-green-100 text-green-700' : ''}
            ${card.color === 'yellow' ? 'bg-yellow-100 text-yellow-700' : ''}
            ${card.color === 'red'    ? 'bg-red-100 text-red-600' : ''}
          `}>
            {card.status_text}
          </span>
        </div>
      </div>

      {/* 정보 그리드 */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-gray-600">
        <div className="flex items-center gap-1">
          <Clock className="h-3 w-3 text-gray-400 flex-shrink-0" />
          <span>출근예정 {card.start_time ?? '-'}</span>
        </div>
        <div className="flex items-center gap-1">
          <Clock className="h-3 w-3 text-gray-400 flex-shrink-0" />
          <span>퇴근예정 {card.end_time ?? '-'}</span>
        </div>
        <div className="flex items-center gap-1">
          <LogIn className="h-3 w-3 text-gray-400 flex-shrink-0" />
          <span>출근 {fmtTime(card.checked_in_at)}</span>
        </div>
        <div className="flex items-center gap-1">
          <LogOut className="h-3 w-3 text-gray-400 flex-shrink-0" />
          <span>퇴근 {fmtTime(card.checked_out_at)}</span>
        </div>
        {card.is_on_break && (
          <div className="col-span-2 flex items-center gap-1 text-orange-600">
            <Coffee className="h-3 w-3 flex-shrink-0" />
            <span>휴게 시작 {fmtTime(card.break_started_at)}</span>
          </div>
        )}
        {card.last_event_at && (
          <div className="col-span-2 text-gray-400">
            마지막 변경 {fmtTime(card.last_event_at)}
          </div>
        )}
      </div>

      {/* 캘린더 오늘 일정 — 휴가가 아니고 events가 있을 때만 표시 */}
      {!card.calendar_leave_type && card.calendar_events && card.calendar_events.length > 0 && (
        <div className="rounded-md bg-purple-50 border border-purple-100 px-2.5 py-1.5">
          <div className="text-[10px] font-semibold text-purple-700 mb-1">📅 오늘 일정</div>
          <div className="space-y-0.5">
            {card.calendar_events.slice(0, 3).map((ev, i) => (
              <div key={i} className="text-xs text-purple-900 truncate">
                {ev.startTime && ev.endTime
                  ? `${ev.startTime}~${ev.endTime}  ${ev.title}`
                  : ev.startTime
                    ? `${ev.startTime}~  ${ev.title}`
                    : `(종일) ${ev.title}`}
              </div>
            ))}
            {card.calendar_events.length > 3 && (
              <div className="text-[10px] text-purple-500">
                외 {card.calendar_events.length - 3}건 더
              </div>
            )}
          </div>
        </div>
      )}

      {/* 근무지 */}
      {card.is_self ? (
        <LocationSelect
          current={card.current_location ?? card.work_location}
          date={date}
          onChange={onAction}
        />
      ) : (
        <div className="flex items-center gap-1 text-xs text-gray-500">
          <MapPin className="h-3 w-3 text-gray-400 flex-shrink-0" />
          <span>{card.current_location ?? card.work_location ?? '-'}</span>
        </div>
      )}

      {/* 출퇴근 버튼 (본인만) */}
      {card.is_self && (
        <div className="flex flex-wrap gap-1.5 pt-1 border-t border-gray-100">
          {/* 출근 / 출근취소 */}
          {!card.checked_in_at ? (
            <button
              onClick={handleCheckIn}
              disabled={busy}
              className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
            >
              <LogIn className="h-3 w-3" /> 출근
            </button>
          ) : (
            <button
              onClick={() => action('check-in-cancel')}
              disabled={busy}
              className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 disabled:opacity-50"
            >
              <X className="h-3 w-3" /> 출근취소
            </button>
          )}

          {/* 퇴근 — 출근 여부와 무관하게 퇴근보고 없으면 항상 표시 */}
          {!card.checked_out_at && (
            <button
              onClick={handleCheckOut}
              disabled={busy}
              className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              <LogOut className="h-3 w-3" /> 퇴근
            </button>
          )}
          {card.checked_out_at && (
            <button
              onClick={() => action('check-out-cancel')}
              disabled={busy}
              className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 disabled:opacity-50"
            >
              <X className="h-3 w-3" /> 퇴근취소
            </button>
          )}

          {/* 휴게 (출근 + 미퇴근인 경우만) */}
          {card.checked_in_at && !card.checked_out_at && (
            !card.is_on_break ? (
              <button
                onClick={() => action('break-start')}
                disabled={busy}
                className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium bg-orange-100 text-orange-700 rounded-lg hover:bg-orange-200 disabled:opacity-50"
              >
                <Coffee className="h-3 w-3" /> 휴게시작
              </button>
            ) : (
              <button
                onClick={() => action('break-end')}
                disabled={busy}
                className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium bg-orange-600 text-white rounded-lg hover:bg-orange-700 disabled:opacity-50"
              >
                <Coffee className="h-3 w-3" /> 휴게종료
              </button>
            )
          )}
        </div>
      )}
    </div>
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
  // 출근 버튼 → 곧바로 CheckInModal(풀 폼)을 띄움. 시각만 받는 작은 팝업 단계는 제거.
  const [checkInTarget, setCheckInTarget] = useState<{ card: TeamMemberCard; startTime: string } | null>(null)
  const [checkOutTarget,    setCheckOutTarget]    = useState<TeamMemberCard | null>(null)
  const [showHeaderCheckIn, setShowHeaderCheckIn] = useState(false)  // 우상단 출근보고 작성
  const [myProfile, setMyProfile] = useState<{ display_name: string | null; division: string | null; team: string | null } | null>(null)
  // 프로필 로드 전엔 카드 fetch를 보류 — 빈 filter로 전체 카드가 잠깐 보이는 flash 방지
  const [profileReady, setProfileReady] = useState(false)

  // 초기 hydration — org + profile을 병렬로 로드 (각각 직렬 useEffect보다 빠름)
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
        // 기본 필터 설정 (사용자가 직접 변경하기 전에만)
        setFilterDiv(prev => prev || profileData.division || '')
        setFilterTeam(prev => prev || profileData.team || '')
      }
      // 성공/실패 무관 — fetch 보류 해제 (실패해도 빈 filter라도 다음 단계 진행)
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

  // profileReady가 true가 된 이후에만 fetch — 초기 빈 filter fetch 차단
  useEffect(() => {
    if (!profileReady) return
    fetchCards()
  }, [fetchCards, profileReady])

  const availableTeams = orgDivisions.find(d => d.name === filterDiv)?.teams ?? []

  const prevDay = () => setDate(d => format(subDays(parseISO(d), 1), 'yyyy-MM-dd'))
  const nextDay = () => setDate(d => format(addDays(parseISO(d), 1), 'yyyy-MM-dd'))

  return (
    <div className="space-y-5">
      {/* 제목 — 출근보고 작성은 홈에서. 둘러보기는 새로고침만. */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-gray-900">둘러보기</h2>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchCards}
            className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800"
          >
            <RefreshCw className="h-4 w-4" /> 새로고침
          </button>
        </div>
      </div>

      {/* 필터 바 */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm px-4 py-3 flex flex-wrap items-center gap-3">
        {/* 날짜 이동 */}
        <div className="flex items-center gap-1">
          <button onClick={prevDay} className="p-1 rounded hover:bg-gray-100 text-gray-500">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <input
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
            className="border border-gray-300 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button onClick={nextDay} disabled={date >= today} className="p-1 rounded hover:bg-gray-100 text-gray-500 disabled:opacity-30">
            <ChevronRight className="h-4 w-4" />
          </button>
          <span className="text-xs text-gray-400 ml-1">
            {format(parseISO(date), 'M월 d일 (eee)', { locale: ko })}
          </span>
        </div>

        {/* 본부 필터 */}
        <select
          value={filterDiv}
          onChange={e => { setFilterDiv(e.target.value); setFilterTeam('') }}
          className="border border-gray-300 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">전체 본부</option>
          {orgDivisions.map(d => <option key={d.id} value={d.name}>{d.name}</option>)}
        </select>

        {/* 팀 필터 */}
        <select
          value={filterTeam}
          onChange={e => setFilterTeam(e.target.value)}
          disabled={!filterDiv}
          className="border border-gray-300 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-400"
        >
          <option value="">전체 팀</option>
          {availableTeams.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
        </select>

        {/* 요약 */}
        <span className="text-xs text-gray-400 ml-auto">
          {cards.length}명
          {cards.filter(c => c.color === 'green').length > 0 && (
            <span className="ml-2 text-green-600">● 근무 {cards.filter(c => c.color === 'green').length}</span>
          )}
          {cards.filter(c => c.color === 'yellow').length > 0 && (
            <span className="ml-1 text-yellow-600">● 보고 {cards.filter(c => c.color === 'yellow').length}</span>
          )}
          {cards.filter(c => c.color === 'red').length > 0 && (
            <span className="ml-1 text-red-500">● 미제출 {cards.filter(c => c.color === 'red').length}</span>
          )}
        </span>
      </div>

      {/* 카드 그리드 */}
      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 mt-4">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="h-40 bg-gray-100 dark:bg-gray-700 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : cards.length === 0 ? (
        <div className="py-16 text-center text-sm text-gray-500">
          해당 날짜/조직의 팀원이 없습니다.
        </div>
      ) : (
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
      )}

      {/* 출근보고 작성 모달 (출근 버튼 / 우상단 버튼 모두) */}
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
