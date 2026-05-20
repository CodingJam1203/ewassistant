'use client'

/**
 * /admin/calendars — 본부 캘린더 관리 (단계 B — CRUD UI)
 *
 * 기능:
 *   - 등록된 캘린더 목록 + 마지막 sync 시각·이벤트 수 통계
 *   - 수동 동기화 버튼 + 결과 표시
 *   - "신규 추가" 버튼 → 모달 form (본부/팀/유형/라벨/Google ID/활성)
 *   - row 별 [수정]/[활성토글]/[삭제] 액션
 *
 * 검증:
 *   - 필수: 본부, 캘린더 유형, 라벨, Google Calendar ID
 *   - team_id 미선택 시 본부 공용 캘린더
 *   - Google Calendar ID는 plain id 또는 iCal URL 모두 허용 (sync 시 extractCalendarRawId 처리)
 *   - 삭제는 confirm 후 동기화된 이벤트도 같이 제거
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, RefreshCw, Loader2, Calendar as CalendarIcon, CheckCircle2, AlertCircle, Plus, Pencil, Trash2 } from 'lucide-react'

type CalendarType = 'meeting' | 'vacation' | 'birthday' | 'other'

interface CalendarRow {
  id: string
  googleCalendarId: string
  calendarType: CalendarType
  label: string
  isActive: boolean
  createdAt: string
  updatedAt: string
  division: { id: string; name: string; sort_order: number } | null
  team: { id: string; name: string; sort_order: number } | null
  eventCount: number
  lastSyncedAt: string | null
}

interface DivisionOption {
  id: string
  name: string
  sort_order: number
}
interface TeamOption {
  id: string
  name: string
  sort_order: number
  division_id: string
}

interface FormState {
  id?: string  // 수정 모드면 채워짐
  division_id: string
  team_id: string  // '' = 본부 공용
  calendar_type: CalendarType
  label: string
  google_calendar_id: string
  is_active: boolean
}

const EMPTY_FORM: FormState = {
  division_id: '',
  team_id: '',
  calendar_type: 'meeting',
  label: '',
  google_calendar_id: '',
  is_active: true,
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
  const [divisions, setDivisions] = useState<DivisionOption[]>([])
  const [teams, setTeams] = useState<TeamOption[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null)
  const [syncError, setSyncError] = useState<string | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  // 단계 B — form 모달
  const [formOpen, setFormOpen] = useState(false)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

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
      setDivisions(data.divisions ?? [])
      setTeams(data.teams ?? [])
    } catch (err) {
      setListError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // 단계 B — form 모달 핸들러
  const openCreate = () => {
    setForm({ ...EMPTY_FORM, division_id: divisions[0]?.id ?? '' })
    setFormError(null)
    setFormOpen(true)
  }
  const openEdit = (r: CalendarRow) => {
    setForm({
      id: r.id,
      division_id: r.division?.id ?? '',
      team_id: r.team?.id ?? '',
      calendar_type: r.calendarType,
      label: r.label,
      google_calendar_id: r.googleCalendarId,
      is_active: r.isActive,
    })
    setFormError(null)
    setFormOpen(true)
  }
  const handleSubmitForm = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    setFormError(null)
    try {
      const isEdit = !!form.id
      const url = isEdit ? `/api/admin/calendars/${form.id}` : '/api/admin/calendars'
      const method = isEdit ? 'PATCH' : 'POST'
      const body = {
        google_calendar_id: form.google_calendar_id.trim(),
        calendar_type: form.calendar_type,
        label: form.label.trim(),
        division_id: form.division_id,
        team_id: form.team_id || null,
        is_active: form.is_active,
      }
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setFormError(data.error || `HTTP ${res.status}`)
        return
      }
      setFormOpen(false)
      load()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }
  const handleToggleActive = async (r: CalendarRow) => {
    const next = !r.isActive
    if (!next && !confirm(`"${r.label}" 캘린더를 비활성화하시겠습니까?\n동기화 대상에서 제외됩니다 (데이터는 보존).`)) return
    const res = await fetch(`/api/admin/calendars/${r.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: next }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) { alert(data.error || `HTTP ${res.status}`); return }
    load()
  }
  const handleDelete = async (r: CalendarRow) => {
    if (!confirm(`"${r.label}" 캘린더를 완전히 삭제하시겠습니까?\n동기화된 이벤트 ${r.eventCount}건도 함께 삭제됩니다. 되돌릴 수 없습니다.`)) return
    const res = await fetch(`/api/admin/calendars/${r.id}`, { method: 'DELETE' })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) { alert(data.error || `HTTP ${res.status}`); return }
    load()
  }

  // form의 본부 변경에 따라 팀 옵션 필터 + 기존 team_id 유효성 체크
  const filteredTeams = useMemo(
    () => teams.filter(t => t.division_id === form.division_id),
    [teams, form.division_id]
  )
  useEffect(() => {
    if (!formOpen) return
    if (form.team_id && !filteredTeams.some(t => t.id === form.team_id)) {
      setForm(f => ({ ...f, team_id: '' }))
    }
  }, [formOpen, form.team_id, filteredTeams])

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
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={openCreate}
            className="inline-flex items-center gap-2 h-10 px-4 rounded-[10px] text-sm font-semibold text-white bg-primary-600 hover:bg-primary-700 transition-colors"
          >
            <Plus className="h-4 w-4" />
            신규 추가
          </button>
          <button
            type="button"
            onClick={handleSync}
            disabled={syncing}
            className="inline-flex items-center gap-2 h-10 px-4 rounded-[10px] text-sm font-semibold text-text-primary bg-surface border border-border hover:bg-surface-muted disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {syncing ? '동기화 중…' : '수동 동기화'}
          </button>
        </div>
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
                  <th className="px-3 py-2 text-left font-medium">활성</th>
                  <th className="px-3 py-2 text-right font-medium tabular-nums">이벤트</th>
                  <th className="px-3 py-2 text-left font-medium">마지막 동기화</th>
                  <th className="px-3 py-2 text-left font-medium">Google Calendar ID</th>
                  <th className="px-3 py-2 text-right font-medium">액션</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id} className={`border-t border-border hover:bg-surface-muted/50 ${!r.isActive ? 'opacity-60' : ''}`}>
                    <td className="px-3 py-2 font-medium text-text-primary">{r.label}</td>
                    <td className="px-3 py-2 text-text-secondary">
                      {r.division?.name ?? '—'}
                      {r.team ? <span className="text-text-muted"> · {r.team.name}</span> : <span className="text-text-muted"> · 본부 공용</span>}
                    </td>
                    <td className="px-3 py-2">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-medium ${CALENDAR_TYPE_COLOR[r.calendarType]}`}>
                        {CALENDAR_TYPE_LABEL[r.calendarType]}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        onClick={() => handleToggleActive(r)}
                        className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-medium ${
                          r.isActive
                            ? 'bg-success-bg text-success-text border border-success-border'
                            : 'bg-surface-muted text-text-muted border border-border'
                        }`}
                        title="클릭하여 활성/비활성 토글"
                      >
                        {r.isActive ? '활성' : '비활성'}
                      </button>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-text-primary">{r.eventCount}</td>
                    <td className="px-3 py-2 text-text-secondary text-xs tabular-nums">{fmtDateTime(r.lastSyncedAt)}</td>
                    <td className="px-3 py-2 font-mono text-[11px] text-text-muted break-all max-w-[20rem]">{r.googleCalendarId}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => openEdit(r)}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[12px] text-text-secondary hover:bg-surface-muted hover:text-text-primary"
                        title="수정"
                      >
                        <Pencil className="h-3.5 w-3.5" />수정
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(r)}
                        className="ml-1 inline-flex items-center gap-1 px-2 py-1 rounded-md text-[12px] text-danger-text hover:bg-danger-bg"
                        title="삭제"
                      >
                        <Trash2 className="h-3.5 w-3.5" />삭제
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="text-xs text-text-muted">
        ※ Google Calendar ID 입력 시 plain id(<code className="font-mono">xxxx@group.calendar.google.com</code>) 또는
        iCal 공개 URL 둘 다 허용. 캘린더는 N-Click의 Service Account에 <strong>"변경 권한"</strong>으로 공유돼 있어야 합니다.
      </div>

      {/* 단계 B — 신규 추가 / 수정 모달 */}
      {formOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 px-4">
          <form
            onSubmit={handleSubmitForm}
            className="bg-surface rounded-2xl shadow-2xl w-full max-w-lg p-6 space-y-4"
          >
            <h3 className="text-lg font-semibold text-text-primary">
              {form.id ? '캘린더 수정' : '캘린더 신규 등록'}
            </h3>

            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-[12px] font-medium text-text-secondary">본부 *</span>
                <select
                  value={form.division_id}
                  onChange={e => setForm(f => ({ ...f, division_id: e.target.value }))}
                  required
                  className="mt-1 w-full h-10 px-3 rounded-[10px] border border-border bg-surface text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary-500"
                >
                  <option value="">— 선택 —</option>
                  {divisions.map(d => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="text-[12px] font-medium text-text-secondary">팀 (선택)</span>
                <select
                  value={form.team_id}
                  onChange={e => setForm(f => ({ ...f, team_id: e.target.value }))}
                  className="mt-1 w-full h-10 px-3 rounded-[10px] border border-border bg-surface text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-50"
                  disabled={!form.division_id}
                >
                  <option value="">본부 공용</option>
                  {filteredTeams.map(t => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="text-[12px] font-medium text-text-secondary">캘린더 유형 *</span>
                <select
                  value={form.calendar_type}
                  onChange={e => setForm(f => ({ ...f, calendar_type: e.target.value as CalendarType }))}
                  required
                  className="mt-1 w-full h-10 px-3 rounded-[10px] border border-border bg-surface text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary-500"
                >
                  {(Object.keys(CALENDAR_TYPE_LABEL) as CalendarType[]).map(t => (
                    <option key={t} value={t}>{CALENDAR_TYPE_LABEL[t]}</option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="text-[12px] font-medium text-text-secondary">활성</span>
                <div className="mt-1 h-10 flex items-center">
                  <input
                    id="is_active"
                    type="checkbox"
                    checked={form.is_active}
                    onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))}
                    className="h-4 w-4 rounded border-border"
                  />
                  <label htmlFor="is_active" className="ml-2 text-sm text-text-primary cursor-pointer">
                    활성 (동기화 대상)
                  </label>
                </div>
              </label>
            </div>

            <label className="block">
              <span className="text-[12px] font-medium text-text-secondary">라벨 * <span className="text-text-muted font-normal">(예 — "마이스팀 회의", "본부 공용 휴가")</span></span>
              <input
                type="text"
                value={form.label}
                onChange={e => setForm(f => ({ ...f, label: e.target.value }))}
                required
                maxLength={100}
                className="mt-1 w-full h-10 px-3 rounded-[10px] border border-border bg-surface text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </label>

            <label className="block">
              <span className="text-[12px] font-medium text-text-secondary">Google Calendar ID *</span>
              <input
                type="text"
                value={form.google_calendar_id}
                onChange={e => setForm(f => ({ ...f, google_calendar_id: e.target.value }))}
                required
                placeholder="xxxx@group.calendar.google.com 또는 iCal URL"
                className="mt-1 w-full h-10 px-3 rounded-[10px] border border-border bg-surface text-sm text-text-primary font-mono focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
              <span className="mt-1 block text-[11px] text-text-muted">
                Google 캘린더 → 설정 → "캘린더 통합" 에서 캘린더 ID 또는 iCal 비공개 URL 복사.
                Service Account(<span className="font-mono">{`*@*.iam.gserviceaccount.com`}</span>)에 변경 권한 공유 필수.
              </span>
            </label>

            {formError && (
              <div className="rounded-[10px] border border-danger-border bg-danger-bg p-3 text-sm text-danger-text">
                {formError}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2 border-t border-border">
              <button
                type="button"
                onClick={() => setFormOpen(false)}
                disabled={submitting}
                className="px-4 py-2 rounded-[10px] border border-border text-text-primary hover:bg-surface-muted text-sm disabled:opacity-50"
              >
                취소
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="px-4 py-2 rounded-[10px] bg-primary-600 text-white hover:bg-primary-700 text-sm font-medium disabled:opacity-50 inline-flex items-center gap-2"
              >
                {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                {form.id ? '수정 저장' : '등록'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
