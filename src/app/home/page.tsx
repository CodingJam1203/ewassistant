'use client'

/**
 * 홈 (/home) — 내 업무 처리 허브.
 *
 * 구성:
 *   1) 본인 오늘 상태 헤더 — 출근보고/퇴근보고 작성 버튼
 *   2) 본인 이번 달 근로현황 (compact)
 *   3) 내 제출 내역 (탭: 일자별 최종 / RAW)
 *
 * 기존 /my-logs 페이지 콘텐츠를 흡수하고, 상단에 오늘 상태 + 액션 버튼을 추가.
 */

import { useState, useEffect, useCallback } from 'react'
import { format } from 'date-fns'
import { ko } from 'date-fns/locale'
import { LogIn, LogOut, RefreshCw, Clock, MapPin, Coffee, X, Check } from 'lucide-react'
import WorkLogModal from '@/components/WorkLogModal'
import CheckInModal from '@/components/CheckInModal'
import WorkHoursCard from '@/components/WorkHoursCard'
import SubmissionsRawTable from '@/components/SubmissionsRawTable'
import type { WorkLog } from '@/types/work-log'
import type { MonthBaselines, UserMonthSummary } from '@/lib/utils/work-hours'
import type { TeamMemberCard } from '@/app/api/team-status/route'

type TabKey = 'final' | 'raw'

/** ISO timestamp → 'HH:mm' (KST 사용자 브라우저 기준) */
function fmtHHmm(iso: string | null | undefined): string {
  if (!iso) return '-'
  try { return format(new Date(iso), 'HH:mm') } catch { return '-' }
}

/** "HH:mm:ss" 또는 "HH:mm" → "HH:mm" */
function trimToHHmm(t: string | null | undefined): string {
  if (!t) return ''
  return t.slice(0, 5)
}

/** 카드 색상 → tailwind 클래스 */
function statusBadgeClass(color: 'green' | 'yellow' | 'red'): string {
  if (color === 'green') return 'bg-green-100 text-green-700'
  if (color === 'yellow') return 'bg-yellow-100 text-yellow-700'
  return 'bg-red-100 text-red-600'
}

/** 카드 색상 → 좌측 강조선 색 */
function accentBarClass(color: 'green' | 'yellow' | 'red'): string {
  if (color === 'green') return 'bg-green-500'
  if (color === 'yellow') return 'bg-yellow-500'
  return 'bg-red-500'
}

/** 작은 통계 칩 — 라벨 + 값 + 아이콘 */
function StatChip({
  icon, label, value, accentClass,
}: {
  icon: React.ReactNode
  label: string
  value: string
  accentClass?: string
}) {
  return (
    <div className="flex items-center gap-2.5 bg-gray-50 rounded-lg px-3 py-2 min-w-0 flex-1">
      <div className={`shrink-0 w-7 h-7 rounded-md flex items-center justify-center ${accentClass ?? 'bg-gray-200 text-gray-600'}`}>
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-[11px] text-gray-500 leading-tight">{label}</div>
        <div className="text-sm font-semibold text-gray-900 leading-tight truncate">{value}</div>
      </div>
    </div>
  )
}

/** 근무지 변경 select — 홈 헤더용 (간소화 버전) */
const LOCATION_OPTIONS = ['사무실', '재택', '외근', '기타'] as const

function LocationSelectInline({
  current, date, onChange,
}: {
  current: string | null
  date: string
  onChange: () => void
}) {
  const [custom, setCustom] = useState('')
  const [showCustom, setShowCustom] = useState(false)
  const [saving, setSaving] = useState(false)

  const save = async (loc: string) => {
    setSaving(true)
    try {
      await fetch('/api/team-status/location', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, location: loc }),
      })
      onChange()
    } finally {
      setSaving(false)
    }
  }

  const handleSelect = async (val: string) => {
    if (val === '기타') { setShowCustom(true); return }
    setShowCustom(false)
    await save(val)
  }
  const handleCustomConfirm = async () => {
    const v = custom.trim()
    if (!v) return
    await save(v)
    setShowCustom(false)
    setCustom('')
  }

  const isStandard = LOCATION_OPTIONS.includes(current as typeof LOCATION_OPTIONS[number])
  return (
    <div className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2">
      <MapPin className="h-4 w-4 text-gray-500 shrink-0" />
      <span className="text-xs text-gray-500">근무지</span>
      {showCustom ? (
        <>
          <input
            value={custom}
            onChange={e => setCustom(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleCustomConfirm() }}
            placeholder="장소 입력"
            className="border border-gray-300 rounded px-2 py-0.5 text-xs w-24 focus:outline-none focus:ring-1 focus:ring-blue-400"
            autoFocus
          />
          <button onClick={handleCustomConfirm} disabled={saving} className="text-blue-600 hover:text-blue-800">
            <Check className="h-3.5 w-3.5" />
          </button>
          <button onClick={() => setShowCustom(false)} className="text-gray-400 hover:text-gray-600">
            <X className="h-3.5 w-3.5" />
          </button>
        </>
      ) : (
        <select
          value={isStandard ? current ?? '사무실' : '기타'}
          onChange={e => handleSelect(e.target.value)}
          disabled={saving}
          className="select-tight text-xs font-medium text-gray-900 bg-white border border-gray-200 rounded px-2 py-0.5 focus:outline-none focus:ring-1 focus:ring-blue-400 disabled:opacity-50"
        >
          {LOCATION_OPTIONS.map(l => <option key={l} value={l}>{l}</option>)}
          {current && !isStandard && <option value={current}>{current}</option>}
        </select>
      )}
    </div>
  )
}

export default function HomePage() {
  const today = format(new Date(), 'yyyy-MM-dd')
  const todayLabel = format(new Date(), 'M월 d일 (EEE)', { locale: ko })

  const [logs, setLogs] = useState<WorkLog[]>([])
  const [editingLog, setEditingLog] = useState<WorkLog | null>(null)
  const [editScope, setEditScope] = useState<'check_in' | 'check_out' | undefined>(undefined)

  const [tab, setTab] = useState<TabKey>('final')
  const [filterDate, setFilterDate] = useState('')

  // 본인 이번 달 근로현황
  const [hoursSummary, setHoursSummary] = useState<{
    baselines: MonthBaselines
    me: UserMonthSummary | null
  } | null>(null)

  // 본인 오늘 카드 (status header용)
  const [myCard, setMyCard] = useState<TeamMemberCard | null>(null)

  // CheckInModal / WorkLogModal 트리거
  const [showCheckIn, setShowCheckIn] = useState(false)
  const [checkOutTarget, setCheckOutTarget] = useState<TeamMemberCard | null>(null)

  // ─── 본인 이번 달 근로현황 ──────────────────────────────────────
  useEffect(() => {
    const now = new Date()
    fetch(`/api/work-hours?year=${now.getFullYear()}&month=${now.getMonth() + 1}&mine=true`)
      .then(r => r.ok ? r.json() : null)
      .then((d: { baselines: MonthBaselines; users: UserMonthSummary[] } | null) => {
        if (!d) return
        setHoursSummary({
          baselines: d.baselines,
          me: d.users[0] ?? null,
        })
      })
      .catch(() => {})
  }, [])

  // ─── 본인 오늘 카드 ─────────────────────────────────────────────
  // /api/team-status는 전체 조회 가능하므로, 응답 중 is_self=true인 카드 1건 사용.
  // mine 옵션은 없지만, 본부/팀 필터로 좁혀도 본인은 항상 포함됨.
  // 가장 단순하게 — 필터 없이 전체 받고 is_self만 선택.
  const fetchMyCard = useCallback(async () => {
    try {
      const res = await fetch(`/api/team-status?date=${today}`)
      const data = await res.json()
      if (Array.isArray(data)) {
        const me = data.find((c: TeamMemberCard) => c.is_self) ?? null
        setMyCard(me)
      }
    } catch {
      setMyCard(null)
    }
  }, [today])

  useEffect(() => { fetchMyCard() }, [fetchMyCard])

  // ─── 내 work_logs (수정/삭제용 캐시) ──────────────────────────────
  const fetchLogs = async () => {
    try {
      const res = await fetch('/api/work-logs?mine=true&limit=100')
      const data = await res.json()
      if (res.ok) setLogs(data)
    } catch (err) {
      console.error(err)
    }
  }
  useEffect(() => { fetchLogs() }, [])

  // ─── 수정 모달 진입 ─────────────────────────────────────────────
  const openEditByWorkLogId = async (
    workLogId: string,
    scope: 'check_in' | 'check_out',
  ) => {
    const cached = logs.find(l => l.id === workLogId)
    if (cached) {
      setEditScope(scope)
      setEditingLog(cached)
      return
    }
    try {
      const res = await fetch(`/api/work-logs/${workLogId}`)
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        alert('해당 보고를 불러오지 못했습니다: ' + (err.error ?? res.statusText))
        return
      }
      const fresh = (await res.json()) as WorkLog
      setEditScope(scope)
      setEditingLog(fresh)
    } catch {
      alert('해당 보고를 불러오는 중 오류가 발생했습니다.')
    }
  }

  const handleEditSuccess = () => {
    setEditingLog(null)
    fetchLogs()
    fetchMyCard()
  }

  // ─── 헤더 액션 핸들러 ─────────────────────────────────────────────
  const openCheckInFlow = () => setShowCheckIn(true)
  const openCheckOutFlow = () => {
    if (myCard) setCheckOutTarget(myCard)
  }

  /** 휴게 시작/종료 — endpoint 호출 후 카드 다시 fetch */
  const [breakBusy, setBreakBusy] = useState(false)
  const triggerBreak = async (endpoint: 'break-start' | 'break-end') => {
    if (breakBusy) return
    setBreakBusy(true)
    try {
      await fetch(`/api/team-status/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: today }),
      })
      await fetchMyCard()
    } finally {
      setBreakBusy(false)
    }
  }

  // ── 렌더 ─────────────────────────────────────────────────────────
  const userName = myCard?.display_name ?? null
  const isCheckedIn = !!(myCard?.daily_status_id && !myCard?.checked_out_at)
  // 퇴근보고는 출근 여부 무관하게 항상 가능 (사후 퇴근 / 출근 누락 케이스 지원).
  // 단 이미 퇴근 처리된 상태면 숨김.
  const showCheckOutBtn = !myCard?.checked_out_at
  // 휴게 / 근무지 변경은 출근한 상태에서만 의미가 있어 isCheckedIn 유지
  const showBreakBtn = isCheckedIn
  const showLocationSelect = isCheckedIn

  return (
    <div className="space-y-6">
      {/* 수정 모달 */}
      {editingLog && (
        <WorkLogModal
          date={editingLog.leave_date}
          userName={editingLog.name}
          editingLog={editingLog}
          editScope={editScope}
          onClose={() => { setEditingLog(null); setEditScope(undefined) }}
          onSuccess={() => { handleEditSuccess(); setEditScope(undefined) }}
        />
      )}

      {/* 출근보고 작성 모달 (CheckInModal — 카드의 출근 버튼과 동일한 흐름) */}
      {showCheckIn && (
        <CheckInModal
          date={today}
          userName={userName}
          onClose={() => setShowCheckIn(false)}
          onSuccess={() => { setShowCheckIn(false); fetchMyCard(); fetchLogs() }}
        />
      )}

      {/* 퇴근보고 작성 모달 */}
      {checkOutTarget && (
        <WorkLogModal
          date={today}
          userName={userName}
          initialTimeline={checkOutTarget.work_location_timeline ?? null}
          initialLeaveTimeline={checkOutTarget.leave_timeline ?? null}
          initialBreakAutoActualMinutes={checkOutTarget.break_auto_actual_minutes ?? null}
          initialStartTime={
            checkOutTarget.checked_in_at
              ? fmtHHmm(checkOutTarget.checked_in_at)
              : trimToHHmm(checkOutTarget.start_time) || undefined
          }
          initialEndTime={trimToHHmm(checkOutTarget.end_time) || undefined}
          resubmitWorkLogId={checkOutTarget.work_log_id ?? null}
          onClose={() => setCheckOutTarget(null)}
          onSuccess={() => { setCheckOutTarget(null); fetchMyCard(); fetchLogs() }}
        />
      )}

      {/* ─── 본인 오늘 상태 헤더 ────────────────────────────────────── */}
      <div className="relative bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        {/* 좌측 강조선 (상태 색) */}
        {myCard && (
          <div className={`absolute left-0 top-0 bottom-0 w-1 ${accentBarClass(myCard.color)}`} />
        )}

        <div className="p-5 sm:p-6">
          {/* 1행: 이름 + 상태 배지 / 날짜 + 새로고침 */}
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div className="flex items-center gap-3 min-w-0">
              <div>
                <div className="text-xs text-gray-500 font-medium tracking-wide uppercase">MY PAGE</div>
                <h2 className="text-xl sm:text-2xl font-bold text-gray-900 leading-tight truncate">
                  {userName ? `${userName}님` : '내 업무'}
                </h2>
              </div>
              {myCard && (
                <span
                  className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${statusBadgeClass(myCard.color)}`}
                >
                  {myCard.status_text}
                </span>
              )}
            </div>
            <div className="flex items-center gap-3">
              <span className="text-sm text-gray-500">{todayLabel}</span>
              <button
                onClick={() => { fetchMyCard(); fetchLogs() }}
                className="text-gray-400 hover:text-gray-600 p-1.5 rounded-md hover:bg-gray-50"
                title="새로고침"
              >
                <RefreshCw className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* 2행: 시각 정보 4개 칩 */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
            <StatChip
              icon={<Clock className="h-4 w-4" />}
              label="출근예정"
              value={trimToHHmm(myCard?.start_time) || '-'}
              accentClass="bg-blue-50 text-blue-600"
            />
            <StatChip
              icon={<Clock className="h-4 w-4" />}
              label="퇴근예정"
              value={trimToHHmm(myCard?.end_time) || '-'}
              accentClass="bg-blue-50 text-blue-600"
            />
            <StatChip
              icon={<LogIn className="h-4 w-4" />}
              label="실제 출근"
              value={fmtHHmm(myCard?.checked_in_at)}
              accentClass="bg-green-50 text-green-600"
            />
            <StatChip
              icon={<LogOut className="h-4 w-4" />}
              label="실제 퇴근"
              value={fmtHHmm(myCard?.checked_out_at)}
              accentClass="bg-purple-50 text-purple-600"
            />
          </div>

          {/* 3행: 액션 버튼 + 근무지 */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={openCheckInFlow}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 shadow-sm"
            >
              <LogIn className="h-4 w-4" />
              출근보고 작성
            </button>
            {showCheckOutBtn && (
              <button
                onClick={openCheckOutFlow}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white bg-green-600 rounded-lg hover:bg-green-700 shadow-sm"
              >
                <LogOut className="h-4 w-4" />
                퇴근보고 작성
              </button>
            )}
            {showBreakBtn && (
              myCard?.is_on_break ? (
                <button
                  onClick={() => triggerBreak('break-end')}
                  disabled={breakBusy}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-lg hover:bg-amber-100 disabled:opacity-50"
                >
                  <Coffee className="h-4 w-4" />
                  휴게 종료
                </button>
              ) : (
                <button
                  onClick={() => triggerBreak('break-start')}
                  disabled={breakBusy}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
                >
                  <Coffee className="h-4 w-4" />
                  휴게 시작
                </button>
              )
            )}
            {showLocationSelect && (
              <div className="ml-auto">
                <LocationSelectInline
                  current={myCard?.current_location ?? null}
                  date={today}
                  onChange={fetchMyCard}
                />
              </div>
            )}
          </div>

          {/* 휴게 중일 때 안내 라인 */}
          {myCard?.is_on_break && (
            <div className="mt-3 flex items-center gap-2 text-xs text-amber-700">
              <Coffee className="h-3.5 w-3.5" />
              <span>휴게 시작 {fmtHHmm(myCard.break_started_at)} — 종료 시 [휴게 종료] 버튼 클릭</span>
            </div>
          )}
        </div>
      </div>

      {/* ─── 본인 이번 달 근로현황 ────────────────────────────────── */}
      {hoursSummary?.me && (
        <WorkHoursCard
          baselines={hoursSummary.baselines}
          summary={hoursSummary.me}
          compact
        />
      )}

      {/* ─── 내 제출 내역 ─────────────────────────────────────────── */}
      <div className="sm:flex sm:items-center sm:justify-between gap-4">
        <h3 className="text-lg font-bold leading-7 text-gray-900">내 제출 내역</h3>
        <div className="flex items-center gap-3 mt-2 sm:mt-0">
          {tab === 'final' && (
            <>
              <input
                type="date"
                value={filterDate}
                onChange={e => setFilterDate(e.target.value)}
                className="rounded-md border border-gray-300 text-sm px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              {filterDate && (
                <button
                  onClick={() => setFilterDate('')}
                  className="text-xs text-gray-500 hover:text-gray-700"
                >
                  초기화
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* 탭 */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex gap-6" aria-label="탭">
          {[
            { key: 'final' as TabKey, label: '일자별 최종 보고' },
            { key: 'raw'   as TabKey, label: 'RAW 제출 내역' },
          ].map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`py-2 px-1 border-b-2 font-medium text-sm transition-colors ${
                tab === t.key
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </div>

      {/* RAW */}
      {tab === 'raw' && (
        <SubmissionsRawTable
          mine mode="raw"
          onEditWorkLog={openEditByWorkLogId}
        />
      )}

      {/* 일자별 최종 */}
      {tab === 'final' && (
        <SubmissionsRawTable
          mine mode="final"
          onEditWorkLog={openEditByWorkLogId}
        />
      )}
    </div>
  )
}
