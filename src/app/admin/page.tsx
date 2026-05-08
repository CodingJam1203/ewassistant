'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Lock, Unlock, RefreshCw, UserPlus, Trash2,
  ChevronDown, ChevronRight, Plus, X, Pencil, Loader2, Building2
} from 'lucide-react'
import { format } from 'date-fns'
import Link from 'next/link'
import { Badge } from '@/components/ui'

// ─── 타입 ────────────────────────────────────────────────────────────────────

interface OrgTeam { id: string; division_id: string; name: string }
interface OrgDivision { id: string; name: string; teams: OrgTeam[] }

interface UserProfile {
  email: string
  id: string | null
  display_name: string | null
  division: string | null
  team: string | null
  role: string
  is_active: boolean
  display_order: number
  created_at: string
  last_login_at: string | null
  last_submitted_at: string | null
}

// ─── 조직 구조 관리 섹션 ──────────────────────────────────────────────────────

function OrgManager({
  org, onOrgChange
}: {
  org: OrgDivision[]
  onOrgChange: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [expandedDivs, setExpandedDivs] = useState<Set<string>>(new Set())
  const [newDivName, setNewDivName] = useState('')
  const [addingDiv, setAddingDiv] = useState(false)
  const [newTeamName, setNewTeamName] = useState<Record<string, string>>({})
  const [editingDiv, setEditingDiv] = useState<string | null>(null)
  const [editDivName, setEditDivName] = useState('')
  const [editingTeam, setEditingTeam] = useState<string | null>(null)
  const [editTeamName, setEditTeamName] = useState('')
  const [busy, setBusy] = useState(false)

  const toggleDiv = (id: string) =>
    setExpandedDivs(prev => {
      const n = new Set(prev)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })

  const addDivision = async () => {
    if (!newDivName.trim()) return
    setBusy(true)
    const res = await fetch('/api/admin/org/divisions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newDivName.trim() }),
    })
    const data = await res.json()
    if (!res.ok) { alert(data.error); setBusy(false); return }
    setNewDivName('')
    setAddingDiv(false)
    onOrgChange()
    setBusy(false)
  }

  const saveDivName = async (id: string) => {
    if (!editDivName.trim()) return
    setBusy(true)
    const res = await fetch(`/api/admin/org/divisions/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: editDivName.trim() }),
    })
    const data = await res.json()
    if (!res.ok) { alert(data.error); setBusy(false); return }
    setEditingDiv(null)
    onOrgChange()
    setBusy(false)
  }

  const deleteDivision = async (div: OrgDivision) => {
    const msg = div.teams.length > 0
      ? `"${div.name}" 본부와 하위 팀 ${div.teams.length}개를 모두 삭제하시겠습니까?`
      : `"${div.name}" 본부를 삭제하시겠습니까?`
    if (!confirm(msg)) return
    setBusy(true)
    const res = await fetch(`/api/admin/org/divisions/${div.id}`, { method: 'DELETE' })
    const data = await res.json()
    if (!res.ok) { alert(data.error); setBusy(false); return }
    onOrgChange()
    setBusy(false)
  }

  const addTeam = async (divisionId: string) => {
    const name = newTeamName[divisionId]?.trim()
    if (!name) return
    setBusy(true)
    const res = await fetch('/api/admin/org/teams', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ division_id: divisionId, name }),
    })
    const data = await res.json()
    if (!res.ok) { alert(data.error); setBusy(false); return }
    setNewTeamName(prev => ({ ...prev, [divisionId]: '' }))
    onOrgChange()
    setBusy(false)
  }

  const saveTeamName = async (id: string) => {
    if (!editTeamName.trim()) return
    setBusy(true)
    const res = await fetch(`/api/admin/org/teams/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: editTeamName.trim() }),
    })
    const data = await res.json()
    if (!res.ok) { alert(data.error); setBusy(false); return }
    setEditingTeam(null)
    onOrgChange()
    setBusy(false)
  }

  const deleteTeam = async (team: OrgTeam) => {
    if (!confirm(`"${team.name}" 팀을 삭제하시겠습니까?`)) return
    setBusy(true)
    const res = await fetch(`/api/admin/org/teams/${team.id}`, { method: 'DELETE' })
    const data = await res.json()
    if (!res.ok) { alert(data.error); setBusy(false); return }
    onOrgChange()
    setBusy(false)
  }

  return (
    <div className="bg-surface border border-border rounded-lg shadow-sm">
      {/* 헤더 (토글) */}
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-surface-muted transition-colors rounded-lg"
      >
        <div className="flex items-center gap-2 text-sm font-semibold text-text-primary">
          <Building2 className="h-4 w-4 text-primary-600" />
          조직 구조 관리
          <span className="text-xs font-normal text-text-muted ml-1">
            ({org.length}개 본부 / {org.reduce((s, d) => s + d.teams.length, 0)}개 팀)
          </span>
        </div>
        {expanded
          ? <ChevronDown className="h-4 w-4 text-text-muted" />
          : <ChevronRight className="h-4 w-4 text-text-muted" />}
      </button>

      {expanded && (
        <div className="border-t border-border px-5 py-4 space-y-3">
          {org.map(div => (
            <div key={div.id} className="border border-border rounded-lg overflow-hidden">
              {/* 본부 행 */}
              <div className="flex items-center gap-2 px-4 py-2.5 bg-surface-muted">
                <button onClick={() => toggleDiv(div.id)} className="text-text-muted hover:text-text-secondary">
                  {expandedDivs.has(div.id)
                    ? <ChevronDown className="h-4 w-4" />
                    : <ChevronRight className="h-4 w-4" />}
                </button>

                {editingDiv === div.id ? (
                  <div className="flex items-center gap-1 flex-1">
                    <input
                      value={editDivName}
                      onChange={e => setEditDivName(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') saveDivName(div.id); if (e.key === 'Escape') setEditingDiv(null) }}
                      className="flex-1 border border-primary-200 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-primary-500"
                      autoFocus
                    />
                    <button onClick={() => saveDivName(div.id)} disabled={busy}
                      className="text-xs px-2 py-1 bg-primary-600 text-white rounded hover:bg-primary-700">저장</button>
                    <button onClick={() => setEditingDiv(null)}
                      className="text-xs px-2 py-1 text-text-secondary hover:text-text-primary">취소</button>
                  </div>
                ) : (
                  <span className="flex-1 font-medium text-text-primary text-sm">
                    {div.name}
                    <span className="ml-2 text-xs text-text-muted">({div.teams.length}개 팀)</span>
                  </span>
                )}

                {editingDiv !== div.id && (
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => { setEditingDiv(div.id); setEditDivName(div.name) }}
                      className="text-text-muted hover:text-primary-600 transition-colors p-1"
                      title="본부명 수정"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => deleteDivision(div)}
                      disabled={busy}
                      className="text-text-disabled hover:text-danger-text transition-colors p-1"
                      title="본부 삭제"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
              </div>

              {/* 팀 목록 */}
              {expandedDivs.has(div.id) && (
                <div className="px-4 py-2 space-y-1.5 bg-surface">
                  {div.teams.map(team => (
                    <div key={team.id} className="flex items-center gap-2 group">
                      <span className="text-text-muted text-xs">└</span>
                      {editingTeam === team.id ? (
                        <div className="flex items-center gap-1 flex-1">
                          <input
                            value={editTeamName}
                            onChange={e => setEditTeamName(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') saveTeamName(team.id); if (e.key === 'Escape') setEditingTeam(null) }}
                            className="flex-1 border border-primary-200 rounded px-2 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary-500"
                            autoFocus
                          />
                          <button onClick={() => saveTeamName(team.id)} disabled={busy}
                            className="text-xs px-2 py-0.5 bg-primary-600 text-white rounded hover:bg-primary-700">저장</button>
                          <button onClick={() => setEditingTeam(null)}
                            className="text-xs px-2 py-0.5 text-text-secondary hover:text-text-primary">취소</button>
                        </div>
                      ) : (
                        <>
                          <span className="flex-1 text-sm text-text-primary">{team.name}</span>
                          <button
                            onClick={() => { setEditingTeam(team.id); setEditTeamName(team.name) }}
                            className="opacity-0 group-hover:opacity-100 text-text-disabled hover:text-primary-600 p-0.5 transition-all"
                            title="팀명 수정"
                          >
                            <Pencil className="h-3 w-3" />
                          </button>
                          <button
                            onClick={() => deleteTeam(team)}
                            disabled={busy}
                            className="opacity-0 group-hover:opacity-100 text-text-disabled hover:text-danger-text p-0.5 transition-all"
                            title="팀 삭제"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </>
                      )}
                    </div>
                  ))}

                  {/* 팀 추가 입력 */}
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-text-disabled text-xs">└</span>
                    <input
                      value={newTeamName[div.id] ?? ''}
                      onChange={e => setNewTeamName(prev => ({ ...prev, [div.id]: e.target.value }))}
                      onKeyDown={e => { if (e.key === 'Enter') addTeam(div.id) }}
                      placeholder="팀명 입력 후 Enter"
                      className="flex-1 border border-dashed border-border-strong rounded px-2 py-1 text-xs text-text-secondary focus:outline-none focus:border-primary-500 focus:text-text-primary"
                    />
                    <button
                      onClick={() => addTeam(div.id)}
                      disabled={busy || !newTeamName[div.id]?.trim()}
                      className="text-xs px-2 py-1 text-primary-600 border border-primary-200 rounded hover:bg-primary-50 disabled:opacity-40 transition-colors"
                    >
                      <Plus className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}

          {/* 본부 추가 */}
          {addingDiv ? (
            <div className="flex items-center gap-2">
              <input
                value={newDivName}
                onChange={e => setNewDivName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') addDivision(); if (e.key === 'Escape') setAddingDiv(false) }}
                placeholder="새 본부명 입력"
                className="flex-1 border border-primary-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary-500"
                autoFocus
              />
              <button onClick={addDivision} disabled={busy || !newDivName.trim()}
                className="px-3 py-2 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50">추가</button>
              <button onClick={() => { setAddingDiv(false); setNewDivName('') }}
                className="px-3 py-2 text-sm text-text-secondary border border-border-strong rounded-lg hover:bg-surface-muted">취소</button>
            </div>
          ) : (
            <button
              onClick={() => setAddingDiv(true)}
              className="flex items-center gap-1.5 text-sm text-primary-600 hover:text-primary-700 font-medium"
            >
              <Plus className="h-4 w-4" /> 본부 추가
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ─── 유저 편집 모달 ───────────────────────────────────────────────────────────

function EditUserModal({
  user, org, onClose, onSave
}: {
  user: UserProfile
  org: OrgDivision[]
  onClose: () => void
  onSave: (updated: UserProfile, oldEmail: string) => void
}) {
  const [form, setForm] = useState({
    email: user.email,
    display_name: user.display_name ?? '',
    division: user.division ?? '',
    team: user.team ?? '',
    role: user.role,
    is_active: user.is_active,
    display_order: user.display_order ?? 999,
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const set = (k: string, v: string | boolean) => setForm(p => ({ ...p, [k]: v }))

  // 선택된 본부의 팀 목록
  const availableTeams = org.find(d => d.name === form.division)?.teams ?? []

  // 본부 변경 시 팀 초기화
  const handleDivisionChange = (divName: string) => {
    setForm(p => ({ ...p, division: divName, team: '' }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!form.email.trim() || !form.email.includes('@')) {
      return setError('유효한 이메일을 입력해주세요.')
    }

    // 이메일이 변경될 경우 경고
    if (form.email.trim().toLowerCase() !== user.email && user.id !== null) {
      if (!confirm(`이메일을 변경하면 해당 사용자는 새 이메일로 다시 로그인해야 합니다.\n\n계속하시겠습니까?`)) return
    }

    setSaving(true)
    try {
      const res = await fetch(`/api/admin/users/${encodeURIComponent(user.email)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: form.email.trim().toLowerCase(),
          display_name: form.display_name.trim() || null,
          division: form.division || null,
          team: form.team || null,
          role: form.role,
          is_active: form.is_active,
          display_order: Number(form.display_order) || 999,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? '저장에 실패했습니다.')
      } else {
        onSave(data as UserProfile, user.email)
      }
    } catch {
      setError('네트워크 오류가 발생했습니다.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
    >
      <div className="bg-surface rounded-xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h3 className="text-base font-semibold text-text-primary">계정 편집</h3>
          <button onClick={onClose} className="text-text-muted hover:text-text-secondary">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          {/* 이메일 */}
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">이메일 *</label>
            <input
              type="email"
              value={form.email}
              onChange={e => set('email', e.target.value)}
              className="w-full border border-border-strong rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
            {form.email.toLowerCase() !== user.email && user.id !== null && (
              <p className="mt-1 text-xs text-warning-text">⚠ 이메일 변경 시 사용자는 새 이메일로 재로그인해야 합니다.</p>
            )}
          </div>

          {/* 이름 */}
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">이름</label>
            <input
              type="text"
              value={form.display_name}
              onChange={e => set('display_name', e.target.value)}
              placeholder="홍길동"
              className="w-full border border-border-strong rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>

          {/* 본부 + 팀 */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1">본부</label>
              <select
                value={form.division}
                onChange={e => handleDivisionChange(e.target.value)}
                className="w-full border border-border-strong rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              >
                <option value="">선택 안 함</option>
                {org.map(d => (
                  <option key={d.id} value={d.name}>{d.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1">팀</label>
              <select
                value={form.team}
                onChange={e => set('team', e.target.value)}
                disabled={!form.division || availableTeams.length === 0}
                className="w-full border border-border-strong rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:bg-surface-muted disabled:text-text-muted"
              >
                <option value="">선택 안 함</option>
                {availableTeams.map(t => (
                  <option key={t.id} value={t.name}>{t.name}</option>
                ))}
              </select>
            </div>
          </div>

          {/* 권한 + 상태 */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1">권한</label>
              <select
                value={form.role}
                onChange={e => set('role', e.target.value)}
                disabled={user.email === 'hrb.main@gmail.com'}
                className="w-full border border-border-strong rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:bg-surface-muted disabled:text-text-muted"
              >
                <option value="user">일반</option>
                <option value="leader">리더 (본인 팀/본부)</option>
                <option value="admin">관리자</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1">계정 상태</label>
              <select
                value={form.is_active ? 'active' : 'inactive'}
                onChange={e => set('is_active', e.target.value === 'active')}
                disabled={user.role === 'admin'}
                className="w-full border border-border-strong rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:bg-surface-muted disabled:text-text-muted"
              >
                <option value="active">활성</option>
                <option value="inactive">비활성</option>
              </select>
            </div>
          </div>

          {/* 표시 순서 */}
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">
              표시 순서
              <span className="ml-1 font-normal text-text-muted">(숫자가 작을수록 앞에 표시, 기본 999)</span>
            </label>
            <input
              type="number"
              min={1}
              max={9999}
              value={form.display_order}
              onChange={e => setForm(p => ({ ...p, display_order: Number(e.target.value) }))}
              className="w-full border border-border-strong rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>

          {error && (
            <p className="text-sm text-danger-text bg-danger-bg border border-danger-border rounded-lg px-3 py-2">{error}</p>
          )}

          <div className="flex justify-end gap-3 pt-1">
            <button type="button" onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-text-primary bg-surface border border-border-strong rounded-lg hover:bg-surface-muted">
              취소
            </button>
            <button type="submit" disabled={saving}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700 disabled:opacity-50">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              저장
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── 사전 등록 폼 ─────────────────────────────────────────────────────────────

function RegisterForm({ org, onDone }: { org: OrgDivision[]; onDone: () => void }) {
  const [form, setForm] = useState({ email: '', display_name: '', division: '', team: '', role: 'user' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const set = (k: string, v: string) => setForm(p => ({ ...p, [k]: v }))
  const availableTeams = org.find(d => d.name === form.division)?.teams ?? []

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!form.email.trim()) return setError('이메일을 입력해주세요.')
    setSaving(true)
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await res.json()
      if (res.ok) onDone()
      else setError(data.error ?? '등록 실패')
    } catch {
      setError('네트워크 오류')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-info-bg border border-info-border rounded-lg p-5">
      <h3 className="text-sm font-semibold text-primary-700 mb-4">새 계정 사전 등록</h3>
      <form onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1">이메일 *</label>
          <input type="email" value={form.email} onChange={e => set('email', e.target.value)}
            placeholder="name@company.com"
            className="w-full border border-border-strong rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary-500" />
        </div>
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1">이름</label>
          <input type="text" value={form.display_name} onChange={e => set('display_name', e.target.value)}
            placeholder="홍길동"
            className="w-full border border-border-strong rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary-500" />
        </div>
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1">본부</label>
          <select value={form.division}
            onChange={e => setForm(p => ({ ...p, division: e.target.value, team: '' }))}
            className="w-full border border-border-strong rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary-500">
            <option value="">선택 안 함</option>
            {org.map(d => <option key={d.id} value={d.name}>{d.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1">팀</label>
          <select value={form.team} onChange={e => set('team', e.target.value)}
            disabled={!form.division || availableTeams.length === 0}
            className="w-full border border-border-strong rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary-500 disabled:bg-surface-muted">
            <option value="">선택 안 함</option>
            {availableTeams.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1">권한</label>
          <select value={form.role} onChange={e => set('role', e.target.value)}
            className="w-full border border-border-strong rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary-500">
            <option value="user">일반</option>
            <option value="leader">리더</option>
            <option value="admin">관리자</option>
          </select>
        </div>
        <div className="flex items-end gap-2">
          <button type="submit" disabled={saving}
            className="flex-1 bg-primary-600 text-white rounded-md px-3 py-1.5 text-sm font-medium hover:bg-primary-700 disabled:opacity-50">
            {saving ? '등록 중...' : '등록'}
          </button>
          <button type="button" onClick={onDone}
            className="px-3 py-1.5 border border-border-strong rounded-md text-sm text-text-secondary hover:bg-surface-muted">
            취소
          </button>
        </div>
      </form>
      {error && <p className="mt-2 text-xs text-danger-text">{error}</p>}
    </div>
  )
}

// ─── 메인 관리자 페이지 ───────────────────────────────────────────────────────

export default function AdminPage() {
  const [users, setUsers] = useState<UserProfile[]>([])
  const [org, setOrg] = useState<OrgDivision[]>([])
  const [loading, setLoading] = useState(true)
  const [showRegister, setShowRegister] = useState(false)
  const [editingUser, setEditingUser] = useState<UserProfile | null>(null)
  const [togglingEmail, setTogglingEmail] = useState<string | null>(null)

  // ?highlight=email — 신규 가입 알림 메일 링크에서 진입 시 해당 row 강조 + 자동 스크롤
  // useSearchParams 대신 window.location 사용 (Next.js 16 prerender Suspense 회피)
  const [highlightEmail, setHighlightEmail] = useState('')
  const [highlightActive, setHighlightActive] = useState(false)
  const highlightRowRef = useRef<HTMLTableRowElement | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    const v = (params.get('highlight') || '').toLowerCase().trim()
    if (v) setHighlightEmail(v)
  }, [])

  const fetchOrg = useCallback(async () => {
    try {
      const res = await fetch('/api/org')
      if (res.ok) setOrg(await res.json())
    } catch { /* ignore */ }
  }, [])

  const fetchUsers = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/users')
      const data = await res.json()
      if (res.ok) setUsers(data)
      else alert('불러오기 실패: ' + data.error)
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    Promise.all([fetchOrg(), fetchUsers()])
  }, [fetchOrg, fetchUsers])

  // highlight 처리 — users가 로드된 직후 한 번 스크롤 + 강조
  useEffect(() => {
    if (!highlightEmail || users.length === 0 || highlightActive) return
    const target = users.find(u => u.email.toLowerCase() === highlightEmail)
    if (!target) return
    setHighlightActive(true)
    // 다음 paint cycle에서 스크롤
    setTimeout(() => {
      highlightRowRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 100)
    // 6초 후 강조 해제
    const timer = setTimeout(() => setHighlightActive(false), 6000)
    return () => clearTimeout(timer)
  }, [highlightEmail, users, highlightActive])

  const fmt = (dt: string | null) => dt ? format(new Date(dt), 'MM/dd HH:mm') : '-'

  const handleUserSave = (updated: UserProfile, oldEmail: string) => {
    setUsers(prev => prev.map(u =>
      u.email === oldEmail ? { ...u, ...updated } : u
    ))
    setEditingUser(null)
  }

  const toggleActive = async (user: UserProfile) => {
    const action = user.is_active ? '비활성화' : '활성화'
    if (!confirm(`${user.email} 계정을 ${action}하시겠습니까?`)) return
    setTogglingEmail(user.email)
    try {
      const res = await fetch(`/api/admin/users/${encodeURIComponent(user.email)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: !user.is_active }),
      })
      const data = await res.json()
      if (res.ok) {
        setUsers(prev => prev.map(u => u.email === user.email ? { ...u, is_active: data.is_active } : u))
      } else {
        alert('변경 실패: ' + data.error)
      }
    } catch (err) {
      console.error(err)
    } finally {
      setTogglingEmail(null)
    }
  }

  const deleteUser = async (user: UserProfile) => {
    const msg = user.id !== null
      ? `"${user.email}" 계정을 완전히 삭제합니다.\n로그인 기록, 제출 내역 등 모든 데이터가 사라집니다.\n\n정말 삭제하시겠습니까?`
      : `"${user.email}" 사전 등록 계정을 삭제하시겠습니까?`
    if (!confirm(msg)) return
    setTogglingEmail(user.email)
    try {
      const res = await fetch(`/api/admin/users/${encodeURIComponent(user.email)}`, { method: 'DELETE' })
      const data = await res.json()
      if (res.ok) setUsers(prev => prev.filter(u => u.email !== user.email))
      else alert('삭제 실패: ' + data.error)
    } catch (err) {
      console.error(err)
    } finally {
      setTogglingEmail(null)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-6">
        <div>
          <h1 className="text-2xl sm:text-[28px] font-bold leading-tight tracking-tight text-text-primary">
            관리자 · 계정 관리
          </h1>
          <p className="mt-1.5 text-sm text-text-secondary">
            계정 권한, 조직 구조, 알림 라우팅을 관리합니다.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
          <Link
            href="/admin/teams-routing"
            className="inline-flex items-center gap-1.5 h-10 px-4 text-sm font-medium rounded-[10px] bg-surface text-text-primary border border-border-strong hover:bg-surface-muted transition-colors"
          >
            Teams 라우팅 관리
          </Link>
          <Link
            href="/admin/notifications"
            className="inline-flex items-center gap-1.5 h-10 px-4 text-sm font-medium rounded-[10px] bg-surface text-text-primary border border-border-strong hover:bg-surface-muted transition-colors"
          >
            알림 발송 내역 보기
          </Link>
        </div>
      </div>

      {/* 조직 구조 관리 */}
      <OrgManager org={org} onOrgChange={fetchOrg} />

      {/* 유저 편집 모달 */}
      {editingUser && (
        <EditUserModal
          user={editingUser}
          org={org}
          onClose={() => setEditingUser(null)}
          onSave={handleUserSave}
        />
      )}

      {/* 사전 등록 폼 */}
      {showRegister && (
        <RegisterForm
          org={org}
          onDone={() => { setShowRegister(false); fetchUsers() }}
        />
      )}

      {/* 툴바 */}
      <div className="flex justify-between items-center">
        <p className="text-sm text-text-secondary">총 <span className="font-semibold text-text-primary tabular-nums">{users.length}</span>명</p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={fetchUsers}
            className="inline-flex items-center gap-1.5 h-9 px-3 text-sm font-medium rounded-[10px] text-text-secondary hover:bg-surface-muted hover:text-text-primary transition-colors"
          >
            <RefreshCw className="h-4 w-4" aria-hidden /> 새로고침
          </button>
          <button
            type="button"
            onClick={() => setShowRegister(v => !v)}
            className="inline-flex items-center gap-1.5 h-10 px-4 text-sm font-medium rounded-[10px] text-white bg-primary-600 hover:bg-primary-700 transition-colors"
          >
            <UserPlus className="h-4 w-4" aria-hidden />
            새 계정 등록
          </button>
        </div>
      </div>

      {/* 계정 테이블 */}
      {loading ? (
        <div className="py-16 text-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-4 border-border border-t-primary-600" />
          <p className="mt-2 text-sm text-text-muted">불러오는 중...</p>
        </div>
      ) : (
        <div className="bg-surface rounded-2xl border border-border shadow-[var(--shadow-card)] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr>
                  {['이메일','이름','본부','팀','권한','상태','순서','최근 로그인','최근 제출'].map(h => (
                    <th key={h} className="bg-background border-b border-border px-4 py-3 text-left text-[12px] font-semibold text-text-secondary whitespace-nowrap">{h}</th>
                  ))}
                  {['편집','잠금','삭제'].map(h => (
                    <th key={h} className="bg-background border-b border-border px-4 py-3 text-center text-[12px] font-semibold text-text-secondary whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {users.map(user => {
                  const isHighlighted = highlightActive && user.email.toLowerCase() === highlightEmail
                  const roleBadge: { variant: 'primary' | 'info' | 'neutral'; label: string } =
                    user.role === 'admin'  ? { variant: 'primary', label: '관리자' }
                    : user.role === 'leader' ? { variant: 'info', label: '리더' }
                    : { variant: 'neutral', label: '일반' }
                  return (
                  <tr key={user.email}
                    ref={isHighlighted ? highlightRowRef : null}
                    className={`border-b border-border hover:bg-surface-muted transition-colors ${!user.is_active ? 'opacity-50' : ''} ${isHighlighted ? 'bg-warning-bg ring-2 ring-warning-border' : ''}`}>
                    {/* 이메일 */}
                    <td className="px-4 py-3 align-middle whitespace-nowrap">
                      <span className="text-[12px] text-text-secondary">{user.email}</span>
                      {!user.id && (
                        <span className="ml-1.5 inline-flex items-center h-5 px-2 rounded-full text-[11px] font-semibold bg-warning-bg text-warning-text border border-warning-border">
                          미접속
                        </span>
                      )}
                    </td>
                    {/* 이름 */}
                    <td className="px-4 py-3 align-middle whitespace-nowrap text-text-primary font-medium">
                      {user.display_name ?? <span className="text-text-muted font-normal">-</span>}
                    </td>
                    {/* 본부 */}
                    <td className="px-4 py-3 align-middle whitespace-nowrap text-text-secondary text-[12px]">
                      {user.division ?? <span className="text-text-disabled">-</span>}
                    </td>
                    {/* 팀 */}
                    <td className="px-4 py-3 align-middle whitespace-nowrap text-text-secondary text-[12px]">
                      {user.team ?? <span className="text-text-disabled">-</span>}
                    </td>
                    {/* 권한 */}
                    <td className="px-4 py-3 align-middle whitespace-nowrap">
                      <Badge variant={roleBadge.variant}>{roleBadge.label}</Badge>
                    </td>
                    {/* 상태 */}
                    <td className="px-4 py-3 align-middle whitespace-nowrap">
                      <Badge variant={user.is_active ? 'success' : 'neutral'} dot>
                        {user.is_active ? '활성' : '비활성'}
                      </Badge>
                    </td>
                    {/* 표시 순서 */}
                    <td className="px-4 py-3 align-middle text-text-muted whitespace-nowrap text-[12px] text-center tabular-nums">
                      {user.display_order ?? 999}
                    </td>
                    {/* 최근 로그인 */}
                    <td className="px-4 py-3 align-middle text-text-muted whitespace-nowrap text-[12px] tabular-nums">{fmt(user.last_login_at)}</td>
                    {/* 최근 제출 */}
                    <td className="px-4 py-3 align-middle text-text-muted whitespace-nowrap text-[12px] tabular-nums">{fmt(user.last_submitted_at)}</td>
                    {/* 편집 */}
                    <td className="px-4 py-3 align-middle text-center">
                      <button
                        onClick={() => setEditingUser(user)}
                        className="text-text-muted hover:text-primary-600 transition-colors"
                        title="편집"
                        aria-label="편집"
                      >
                        <Pencil className="h-4 w-4" aria-hidden />
                      </button>
                    </td>
                    {/* 잠금/해제 */}
                    <td className="px-4 py-3 align-middle text-center">
                      {user.role !== 'admin' ? (
                        <button
                          onClick={() => toggleActive(user)}
                          disabled={togglingEmail === user.email}
                          className={`transition-colors disabled:opacity-40
                            ${user.is_active ? 'text-text-muted hover:text-danger-text' : 'text-danger-text hover:text-success-text'}`}
                          title={user.is_active ? '비활성화' : '활성화'}
                          aria-label={user.is_active ? '비활성화' : '활성화'}
                        >
                          {togglingEmail === user.email
                            ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                            : user.is_active
                              ? <Unlock className="h-4 w-4" aria-hidden />
                              : <Lock className="h-4 w-4" aria-hidden />}
                        </button>
                      ) : (
                        <span className="text-[12px] text-text-disabled">—</span>
                      )}
                    </td>
                    {/* 삭제 */}
                    <td className="px-4 py-3 align-middle text-center">
                      {user.role !== 'admin' ? (
                        <button
                          onClick={() => deleteUser(user)}
                          disabled={togglingEmail === user.email}
                          className="text-text-muted hover:text-danger-text transition-colors disabled:opacity-40"
                          title="삭제"
                          aria-label="삭제"
                        >
                          <Trash2 className="h-4 w-4" aria-hidden />
                        </button>
                      ) : (
                        <span className="text-[12px] text-text-disabled">—</span>
                      )}
                    </td>
                  </tr>
                  )
                })}
              </tbody>
            </table>
            {users.length === 0 && (
              <div className="py-12 text-center text-sm text-text-secondary">계정이 없습니다.</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
