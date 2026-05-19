'use client'

/**
 * /admin/calendars — 본부 캘린더 관리 (MVP — 단계 A)
 *
 * 현재 단계:
 *   - 등록된 캘린더 목록 (read-only)
 *   - 수동 동기화 버튼 + 결과 표시
 *   - 각 캘린더의 마지막 sync 시각·이벤트 수 통계
 *
 * 다음 단계 (B):
 *   - 추가/수정/삭제 form
 *   - 본부·팀·calendar_type select
 */

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, RefreshCw, Loader2, Calendar as CalendarIcon, CheckCircle2, AlertCircle } from 'lucide-react'

interface CalendarRow {
  id: string
  googleCalendarId: string
  calendarType: 'meeting' | 'vacation' | 'birthday' | 'other'
  label: string
  isActive: boolean
  createdAt: string
  updatedAt: string
  division: { id: string; name: string; sort_order: number } | null
  team: { id: string; name: string; sort_order: number } | null
  eventCount: number
  lastSyncedAt: string | null
}

interface SyncResult {
  ok: boolean
  totalCalendars: number
  succeeded: number
  failed: number
  totalEvents: number
  failures: Array<{ calendarId: string; error: string }>
}

const CALENDAR_TYPE_LABEL: Record<CalendarRow['calendarType'], string> = {
  meeting: '회의',
  vacation: '휴가',
  birthday: '생일·기념일',
  other: '기타',
}

const CALENDAR_TYPE_COLOR: Record<CalendarRow['calendarType'], string> = {
  meeting:  'bg-primary-50 text-primary-700',
  vacation: 'bg-info-bg text-info-text',
  birthday: 'bg-warning-bg text-warning-text',
  other:    'bg-surface-muted text-text-secondary',
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })
}

export default function AdminCalendarsPage() {
  const [rows, setRows] = useState<CalendarRow[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null)
  const [syncError, setSyncError] = useState<string | null>(null)
  const [listError, setListError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setListError(null)
    try {
      const res = await fetch('/api/admin/calendars', { cache: 'no-store' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setListError(body.error || `HTTP ${res.status}`)
        return
      }
      const data = await res.json()
      setRows(data.rows ?? [])
    } catch (err) {
      setListError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const handleSync = async () => {
    setSyncing(true)
    setSyncError(null)
    setSyncResult(null)
    try {
      const res = await fetch('/api/admin/calendars/sync', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) {
        setSyncError(data.error || `HTTP ${res.status}`)
        return
      }
      setSyncResult(data)
      // 목록 새로고침 (eventCount/lastSyncedAt 갱신)
      load()
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : String(err))
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div className="max-w-6xl mx-auto p-4 sm:p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/admin" className="inline-flex items-center gap-1 text-sm text-text-secondary hover:text-text-primary">
          <ArrowLeft className="h-4 w-4" />
          관리자 홈
        </Link>
      </div>

      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-text-primary flex items-center gap-2">
            <CalendarIcon className="h-6 w-6" /> 본부 캘린더 관리
          </h1>
          <p className="mt-1 text-sm text-text-secondary">
            본부별 Google Calendar ID 등록 · iCal 공개 fetch 기반 read-only 동기화 (ABC-217)
          </p>
        </div>
        <button
          type="button"
          onClick={handleSync}
          disabled={syncing}
          className="inline-flex items-center gap-2 h-10 px-4 rounded-[10px] text-sm font-semibold text-white bg-primary-600 hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          {syncing ? '동기화 중…' : '수동 동기화 실행'}
        </button>
      </header>

      {/* 동기화 결과 카드 */}
      {syncResult && (
        <div className={`rounded-[12px] border p-4 ${
          syncResult.failed === 0
            ? 'border-success-border bg-success-bg'
            : 'border-warning-border bg-warning-bg'
        }`}>
          <div className="flex items-start gap-3">
            {syncResult.failed === 0
              ? <CheckCircle2 className="h-5 w-5 text-success-text shrink-0 mt-0.5" />
              : <AlertCircle  className="h-5 w-5 text-warning-text shrink-0 mt-0.5" />}
            <div className="flex-1">
              <p className={`text-sm font-semibold ${
                syncResult.failed === 0 ? 'text-success-text' : 'text-warning-text'
              }`}>
                동기화 완료 — 총 {syncResult.totalCalendars}개 캘린더 중 {syncResult.succeeded}개 성공
                {syncResult.failed > 0 && ` · ${syncResult.failed}개 실패`}
              </p>
              <p className="mt-1 text-xs text-text-secondary">
                불러온 이벤트 총 {syncResult.totalEvents}건
              </p>
              {syncResult.failures.length > 0 && (
                <details className="mt-2">
                  <summary className="text-xs text-warning-text cursor-pointer">실패 상세 보기</summary>
                  <ul className="mt-2 space-y-1 text-xs text-text-secondary">
                    {syncResult.failures.map((f, i) => (
                      <li key={i} className="font-mono break-all">
                        <span className="text-warning-text">[{i + 1}]</span> {f.calendarId} — {f.error}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          </div>
        </div>
      )}

      {syncError && (
        <div className="rounded-[12px] border border-danger-border bg-danger-bg p-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-danger-text shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-danger-text">동기화 실패</p>
              <p className="mt-1 text-xs text-text-secondary font-mono break-all">{syncError}</p>
            </div>
          </div>
        </div>
      )}

      {/* 캘린더 목록 */}
      <section className="bg-surface border border-border rounded-[12px] overflow-hidden">
        <div className="px-4 py-3 border-b border-border bg-background flex items-center justify-between">
          <h2 className="text-sm font-semibold text-text-primary">등록된 캘린더</h2>
          <span className="text-xs text-text-secondary">{rows.length}건</span>
        </div>

        {loading && (
          <div className="p-8 text-center text-sm text-text-muted">
            <Loader2 className="h-5 w-5 animate-spin inline mr-2" />
            불러오는 중…
          </div>
        )}

        {!loading && listError && (
          <div className="p-4 text-sm text-danger-text">{listError}</div>
        )}

        {!loading && !listError && rows.length === 0 && (
          <div className="p-8 text-center text-sm text-text-muted">
            등록된 캘린더가 없습니다.
          </div>
        )}

        {!loading && !listError && rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-muted text-text-secondary">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">라벨</th>
                  <th className="px-3 py-2 text-left font-medium">본부 / 팀</th>
                  <th className="px-3 py-2 text-left font-medium">유형</th>
                  <th className="px-3 py-2 text-right font-medium tabular-nums">이벤트</th>
                  <th className="px-3 py-2 text-left font-medium">마지막 동기화</th>
                  <th className="px-3 py-2 text-left font-medium">Google Calendar ID</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id} className="border-t border-border hover:bg-surface-muted/50">
                    <td className="px-3 py-2 font-medium text-text-primary">{r.label}</td>
                    <td className="px-3 py-2 text-text-secondary">
                      {r.division?.name ?? '—'}
                      {r.team && <span className="text-text-muted"> · {r.team.name}</span>}
                    </td>
                    <td className="px-3 py-2">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-medium ${CALENDAR_TYPE_COLOR[r.calendarType]}`}>
                        {CALENDAR_TYPE_LABEL[r.calendarType]}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-text-primary">{r.eventCount}</td>
                    <td className="px-3 py-2 text-text-secondary text-xs tabular-nums">{fmtDateTime(r.lastSyncedAt)}</td>
                    <td className="px-3 py-2 font-mono text-[11px] text-text-muted break-all max-w-[20rem]">{r.googleCalendarId}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="text-xs text-text-muted">
        ※ 캘린더 추가/수정/삭제 UI는 다음 단계 (B)에 추가됩니다. 현재는 DB에 시드된 9개 캘린더 read-only.
      </div>
    </div>
  )
}
