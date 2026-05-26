'use client'

/**
 * /admin/sheet-sources — 외부 스프레드시트 source 관리 (Phase A)
 *
 * 기능:
 *   - 본부별 시트 source 등록 (label · department_key · is_active)
 *   - 활성토글 / 수정 / 삭제
 *   - 각 source의 마지막 push 수신 시각 + 캐시된 날짜 수 + 매핑된 팀 수 표시
 *   - 팀별 sheet_source 매핑 드롭다운 (본부 같은 source만 선택 가능)
 *
 * 운영 흐름:
 *   1. admin이 본부별 시트 source row 등록
 *   2. Apps Script의 SHEET_CONFIGS의 본부명 key가 department_key와 일치해야 매핑됨
 *   3. 매핑 후 다음 push부터 leave_calendar_cache에 source_id-keyed row로 누적
 *   4. 팀의 sheet_source_id를 드롭다운으로 매핑
 *
 * 호환:
 *   - 등록된 source 없는 본부의 데이터는 legacy key로 backward-compat 유지 (Mode 1 zero impact)
 *   - read 측은 두 형식 모두 인식 (leave-calendar.ts dual-key)
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, RefreshCw, Loader2, Plus, Pencil, Trash2, CheckCircle2, AlertCircle } from 'lucide-react'

interface DivisionOption {
  id: string
  name: string
  sort_order: number
}

interface SheetSourceRow {
  id: string
  divisionId: string
  label: string
  departmentKey: string
  isActive: boolean
  lastPushAt: string | null
  lastPushError: string | null
  createdAt: string
  updatedAt: string
  division: { id: string; name: string; sort_order: number } | null
  cachedDates: number
  mappedTeams: number
}

interface TeamRow {
  id: string
  name: string
  division_id: string
  sheet_source_id: string | null
}

interface FormState {
  id?: string
  division_id: string
  label: string
  department_key: string
  is_active: boolean
}

const EMPTY_FORM: FormState = {
  division_id: '',
  label: '',
  department_key: '',
  is_active: true,
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return '-'
  try {
    const d = new Date(iso)
    return d.toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
  } catch {
    return iso
  }
}

export default function SheetSourcesPage() {
  const [sources, setSources] = useState<SheetSourceRow[]>([])
  const [divisions, setDivisions] = useState<DivisionOption[]>([])
  const [teams, setTeams] = useState<TeamRow[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [togglingId, setTogglingId] = useState<string | null>(null)

  const fetchAll = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [srcRes, teamsRes] = await Promise.all([
        fetch('/api/admin/sheet-sources'),
        fetch('/api/org'),
      ])
      const srcData = await srcRes.json()
      if (!srcRes.ok) throw new Error(srcData.error ?? 'failed to load sources')
      setSources(srcData.rows ?? [])
      setDivisions(srcData.divisions ?? [])

      // /api/org returns OrgDivision[] with embedded teams — flatten for mapping
      if (teamsRes.ok) {
        const orgData = await teamsRes.json() as Array<{
          id: string
          name: string
          teams: Array<{ id: string; name: string; division_id: string; sheet_source_id?: string | null }>
        }>
        const flat: TeamRow[] = []
        for (const div of orgData) {
          for (const t of div.teams) {
            flat.push({
              id: t.id,
              name: t.name,
              division_id: t.division_id,
              sheet_source_id: t.sheet_source_id ?? null,
            })
          }
        }
        setTeams(flat)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'load failed')
    } finally {
      setLoading(false)
    }
  }, [])

  // 초기 fetch — 마운트 직후 1회. fetchAll 내부에서 setState가 발생하지만 mount sync 패턴이라 의도된 cascading.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { fetchAll() }, [fetchAll])

  const teamsByDivision = useMemo(() => {
    const m = new Map<string, TeamRow[]>()
    for (const t of teams) {
      if (!m.has(t.division_id)) m.set(t.division_id, [])
      m.get(t.division_id)!.push(t)
    }
    return m
  }, [teams])

  const sourcesByDivision = useMemo(() => {
    const m = new Map<string, SheetSourceRow[]>()
    for (const s of sources) {
      if (!m.has(s.divisionId)) m.set(s.divisionId, [])
      m.get(s.divisionId)!.push(s)
    }
    return m
  }, [sources])

  const openNewForm = () => {
    setForm({ ...EMPTY_FORM, division_id: divisions[0]?.id ?? '' })
    setShowForm(true)
    setError(null)
  }

  const openEditForm = (s: SheetSourceRow) => {
    setForm({
      id: s.id,
      division_id: s.divisionId,
      label: s.label,
      department_key: s.departmentKey,
      is_active: s.isActive,
    })
    setShowForm(true)
    setError(null)
  }

  const closeForm = () => {
    setShowForm(false)
    setForm(EMPTY_FORM)
    setError(null)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const isEdit = !!form.id
      const url = isEdit ? `/api/admin/sheet-sources/${form.id}` : '/api/admin/sheet-sources'
      const method = isEdit ? 'PATCH' : 'POST'
      const payload: Record<string, unknown> = {
        label: form.label,
        department_key: form.department_key,
        is_active: form.is_active,
      }
      if (!isEdit) payload.division_id = form.division_id

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? '저장 실패')
      closeForm()
      await fetchAll()
    } catch (e) {
      setError(e instanceof Error ? e.message : '저장 실패')
    } finally {
      setSaving(false)
    }
  }

  const handleToggleActive = async (s: SheetSourceRow) => {
    setTogglingId(s.id)
    try {
      const res = await fetch(`/api/admin/sheet-sources/${s.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: !s.isActive }),
      })
      if (!res.ok) {
        const data = await res.json()
        alert(data.error ?? '토글 실패')
        return
      }
      await fetchAll()
    } finally {
      setTogglingId(null)
    }
  }

  const handleDelete = async (s: SheetSourceRow) => {
    const msg = s.mappedTeams > 0
      ? `"${s.label}"을 삭제합니다.\n매핑된 팀 ${s.mappedTeams}개의 sheet_source가 자동 해제됩니다.\n\n계속하시겠습니까?`
      : `"${s.label}"을 삭제하시겠습니까?`
    if (!confirm(msg)) return
    setTogglingId(s.id)
    try {
      const res = await fetch(`/api/admin/sheet-sources/${s.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json()
        alert(data.error ?? '삭제 실패')
        return
      }
      await fetchAll()
    } finally {
      setTogglingId(null)
    }
  }

  const handleTeamMapping = async (teamId: string, sourceId: string) => {
    const value = sourceId === '' ? null : sourceId
    const res = await fetch(`/api/admin/org/teams/${teamId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sheet_source_id: value }),
    })
    if (!res.ok) {
      const data = await res.json()
      alert(data.error ?? '매핑 변경 실패')
      return
    }
    // 로컬 상태 갱신
    setTeams(prev => prev.map(t => t.id === teamId ? { ...t, sheet_source_id: value } : t))
    await fetchAll()  // mappedTeams 갱신
  }

  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-6">
        <div>
          <Link
            href="/admin"
            className="inline-flex items-center gap-1 text-sm text-text-secondary hover:text-text-primary mb-2"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> 관리자 메인
          </Link>
          <h1 className="text-2xl sm:text-[28px] font-bold leading-tight tracking-tight text-text-primary">
            외부 시트 source 관리
          </h1>
          <p className="mt-1.5 text-sm text-text-secondary">
            Apps Script PUSH로 들어오는 본부별 휴가/일정 시트의 source 등록·매핑·진단.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={fetchAll}
            className="inline-flex items-center gap-1.5 h-9 px-3 text-sm font-medium rounded-[10px] text-text-secondary hover:bg-surface-muted hover:text-text-primary transition-colors"
          >
            <RefreshCw className="h-4 w-4" /> 새로고침
          </button>
          <button
            type="button"
            onClick={openNewForm}
            className="inline-flex items-center gap-1.5 h-10 px-4 text-sm font-medium rounded-[10px] text-white bg-primary-600 hover:bg-primary-700 transition-colors"
          >
            <Plus className="h-4 w-4" /> 신규 source 추가
          </button>
        </div>
      </div>

      {/* 운영 안내 */}
      <div className="bg-info-bg border border-info-border rounded-lg px-4 py-3 text-[13px] text-text-secondary leading-relaxed">
        <p className="font-semibold text-text-primary mb-1">운영 절차</p>
        <ol className="list-decimal list-inside space-y-0.5">
          <li>본부별로 Apps Script 배포 (시트 owner 계정)</li>
          <li>여기서 source 등록 — <code className="bg-surface px-1 rounded text-[11px]">Apps Script payload key</code>가 Apps Script <code className="bg-surface px-1 rounded text-[11px]">SHEET_CONFIGS</code>의 본부명 key와 정확히 일치해야 매핑됨</li>
          <li>다음 push(최대 1시간 후)부터 <code className="bg-surface px-1 rounded text-[11px]">last_push_at</code> 갱신 + 캐시 누적 확인</li>
          <li>아래 [팀 매핑] 섹션에서 시트 쓸 팀들의 source를 드롭다운으로 지정</li>
        </ol>
      </div>

      {/* 폼 (신규/수정) */}
      {showForm && (
        <div className="bg-surface border border-border-strong rounded-xl shadow-sm p-5">
          <h3 className="text-sm font-semibold text-text-primary mb-4">
            {form.id ? '시트 source 수정' : '신규 시트 source 등록'}
          </h3>
          <form onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1">본부 *</label>
              <select
                value={form.division_id}
                onChange={e => setForm(p => ({ ...p, division_id: e.target.value }))}
                disabled={!!form.id}
                className="w-full border border-border-strong rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:bg-surface-muted"
              >
                <option value="">선택</option>
                {divisions.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
              {form.id && <p className="text-[11px] text-text-muted mt-1">본부는 수정 불가</p>}
            </div>
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1">라벨 *</label>
              <input
                type="text"
                value={form.label}
                onChange={e => setForm(p => ({ ...p, label: e.target.value }))}
                placeholder="예: HR마케팅본부 휴가시트"
                className="w-full border border-border-strong rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-text-secondary mb-1">
                Apps Script payload key *
                <span className="ml-1 font-normal text-text-muted">(Apps Script SHEET_CONFIGS의 본부명 key와 정확히 일치)</span>
              </label>
              <input
                type="text"
                value={form.department_key}
                onChange={e => setForm(p => ({ ...p, department_key: e.target.value }))}
                placeholder="예: HR마케팅본부"
                className="w-full border border-border-strong rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 font-mono"
              />
            </div>
            <div className="sm:col-span-2 flex items-center gap-2">
              <input
                type="checkbox"
                id="is_active"
                checked={form.is_active}
                onChange={e => setForm(p => ({ ...p, is_active: e.target.checked }))}
                className="h-4 w-4 rounded border-border-strong text-primary-600 focus:ring-primary-500"
              />
              <label htmlFor="is_active" className="text-sm text-text-primary">활성 (off 시 push가 와도 source-keyed로 저장 안 함)</label>
            </div>
            {error && (
              <p className="sm:col-span-2 text-sm text-danger-text bg-danger-bg border border-danger-border rounded-lg px-3 py-2">{error}</p>
            )}
            <div className="sm:col-span-2 flex justify-end gap-2 pt-1">
              <button type="button" onClick={closeForm}
                className="px-3 py-2 text-sm font-medium text-text-secondary bg-surface border border-border-strong rounded-lg hover:bg-surface-muted">
                취소
              </button>
              <button type="submit" disabled={saving || !form.label.trim() || !form.department_key.trim() || (!form.id && !form.division_id)}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700 disabled:opacity-50">
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                {form.id ? '저장' : '등록'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Source 목록 */}
      <div className="bg-surface rounded-2xl border border-border shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-border bg-surface-muted">
          <h3 className="text-sm font-semibold text-text-primary">등록된 시트 source</h3>
        </div>
        {loading ? (
          <div className="py-12 text-center text-sm text-text-muted">
            <Loader2 className="h-5 w-5 animate-spin inline-block mr-2" /> 불러오는 중...
          </div>
        ) : sources.length === 0 ? (
          <div className="py-12 text-center text-sm text-text-secondary">등록된 source가 없습니다. [신규 source 추가]로 시작하세요.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr className="bg-background">
                  {['본부','라벨','Apps Script key','활성','마지막 push','캐시 날짜','매핑 팀','액션'].map(h => (
                    <th key={h} className="border-b border-border px-4 py-3 text-left text-[12px] font-semibold text-text-secondary whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sources.map(s => (
                  <tr key={s.id} className={`border-b border-border hover:bg-surface-muted ${!s.isActive ? 'opacity-50' : ''}`}>
                    <td className="px-4 py-3 align-middle whitespace-nowrap text-text-primary">{s.division?.name ?? '-'}</td>
                    <td className="px-4 py-3 align-middle text-text-primary font-medium">{s.label}</td>
                    <td className="px-4 py-3 align-middle whitespace-nowrap font-mono text-[12px] text-text-secondary">{s.departmentKey}</td>
                    <td className="px-4 py-3 align-middle whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => handleToggleActive(s)}
                        disabled={togglingId === s.id}
                        className={`text-[11px] px-2 py-0.5 rounded-full border transition-colors disabled:opacity-40 ${
                          s.isActive
                            ? 'border-success-border bg-success-bg text-success-text'
                            : 'border-border-strong bg-surface text-text-muted'
                        }`}
                      >
                        {s.isActive ? 'ON' : 'OFF'}
                      </button>
                    </td>
                    <td className="px-4 py-3 align-middle whitespace-nowrap text-[12px] tabular-nums text-text-secondary">
                      <div className="flex items-center gap-1.5">
                        {s.lastPushError ? (
                          <AlertCircle className="h-3.5 w-3.5 text-danger-text" />
                        ) : s.lastPushAt ? (
                          <CheckCircle2 className="h-3.5 w-3.5 text-success-text" />
                        ) : null}
                        <span>{fmtDateTime(s.lastPushAt)}</span>
                      </div>
                      {s.lastPushError && (
                        <p className="text-[11px] text-danger-text mt-0.5 whitespace-normal">{s.lastPushError}</p>
                      )}
                    </td>
                    <td className="px-4 py-3 align-middle text-center tabular-nums">{s.cachedDates}</td>
                    <td className="px-4 py-3 align-middle text-center tabular-nums">{s.mappedTeams}</td>
                    <td className="px-4 py-3 align-middle text-center">
                      <div className="inline-flex items-center gap-1">
                        <button
                          onClick={() => openEditForm(s)}
                          className="text-text-muted hover:text-primary-600 p-1 transition-colors"
                          title="수정"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => handleDelete(s)}
                          disabled={togglingId === s.id}
                          className="text-text-muted hover:text-danger-text p-1 transition-colors disabled:opacity-40"
                          title="삭제"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 팀 매핑 */}
      <div className="bg-surface rounded-2xl border border-border shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-border bg-surface-muted">
          <h3 className="text-sm font-semibold text-text-primary">팀별 시트 매핑</h3>
          <p className="text-[12px] text-text-muted mt-1">
            팀의 sheet_source 드롭다운으로 선택 — 매핑 변경 즉시 저장. (Phase A 기준 read 측은 모든 source 합쳐서 표시. Mode 3 등 mode-aware 분기는 Phase B)
          </p>
        </div>
        {loading ? (
          <div className="py-8 text-center text-sm text-text-muted">불러오는 중...</div>
        ) : (
          <div className="divide-y divide-border">
            {divisions.map(div => {
              const divTeams = teamsByDivision.get(div.id) ?? []
              const divSources = sourcesByDivision.get(div.id) ?? []
              if (divTeams.length === 0) return null
              return (
                <div key={div.id} className="px-5 py-4">
                  <h4 className="text-sm font-semibold text-text-primary mb-3">{div.name}</h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                    {divTeams.map(team => (
                      <div key={team.id} className="flex items-center gap-2">
                        <span className="text-sm text-text-secondary min-w-[80px]">{team.name}</span>
                        <select
                          value={team.sheet_source_id ?? ''}
                          onChange={e => handleTeamMapping(team.id, e.target.value)}
                          disabled={divSources.length === 0}
                          className="flex-1 border border-border-strong rounded-md px-2 py-1 text-[12px] focus:outline-none focus:ring-1 focus:ring-primary-500 disabled:bg-surface-muted disabled:text-text-disabled"
                        >
                          <option value="">없음</option>
                          {divSources.map(s => (
                            <option key={s.id} value={s.id}>
                              {s.label}{!s.isActive ? ' (비활성)' : ''}
                            </option>
                          ))}
                        </select>
                      </div>
                    ))}
                  </div>
                  {divSources.length === 0 && (
                    <p className="text-[11px] text-text-muted mt-2">이 본부에 등록된 source 없음. 위에서 source부터 등록하세요.</p>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
