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
import { LogIn, LogOut, RefreshCw, Clock, MapPin } from 'lucide-react'
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

  // ── 렌더 ─────────────────────────────────────────────────────────
  const userName = myCard?.display_name ?? null
  const showCheckOutBtn = !!(myCard?.daily_status_id && !myCard?.checked_out_at)

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
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-xl font-bold text-gray-900 leading-tight">
                {userName ? `${userName}님 — 오늘 ${todayLabel}` : `오늘 ${todayLabel}`}
              </h2>
              {myCard && (
                <span
                  className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${statusBadgeClass(myCard.color)}`}
                >
                  {myCard.status_text}
                </span>
              )}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-600">
              <div className="flex items-center gap-1">
                <Clock className="h-3.5 w-3.5 text-gray-400" />
                <span>출근예정 {trimToHHmm(myCard?.start_time) || '-'}</span>
              </div>
              <div className="flex items-center gap-1">
                <Clock className="h-3.5 w-3.5 text-gray-400" />
                <span>퇴근예정 {trimToHHmm(myCard?.end_time) || '-'}</span>
              </div>
              <div className="flex items-center gap-1">
                <LogIn className="h-3.5 w-3.5 text-gray-400" />
                <span>출근 {fmtHHmm(myCard?.checked_in_at)}</span>
              </div>
              <div className="flex items-center gap-1">
                <LogOut className="h-3.5 w-3.5 text-gray-400" />
                <span>퇴근 {fmtHHmm(myCard?.checked_out_at)}</span>
              </div>
              {myCard?.current_location && (
                <div className="flex items-center gap-1">
                  <MapPin className="h-3.5 w-3.5 text-gray-400" />
                  <span>{myCard.current_location}</span>
                </div>
              )}
            </div>
          </div>

          {/* 액션 버튼 */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={openCheckInFlow}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
            >
              <LogIn className="h-4 w-4" />
              출근보고 작성
            </button>
            {showCheckOutBtn && (
              <button
                onClick={openCheckOutFlow}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700"
              >
                <LogOut className="h-4 w-4" />
                퇴근보고 작성
              </button>
            )}
            <button
              onClick={() => { fetchMyCard(); fetchLogs() }}
              className="inline-flex items-center gap-1 px-2 py-2 text-sm text-gray-500 hover:text-gray-700"
              title="새로고침"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
          </div>
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
