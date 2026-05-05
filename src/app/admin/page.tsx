'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Lock, Unlock, RefreshCw, UserPlus, Trash2,
  ChevronDown, ChevronRight, Plus, X, Pencil, Loader2, Building2
} from 'lucide-react'
import { format } from 'date-fns'
import Link from 'next/link'

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
    <div className="bg-white border border-gray-200 rounded-lg shadow-sm">
      {/* 헤더 (토글) */}
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-50 transition-colors rounded-lg"
      >
        <div className="flex items-center gap-2 text-sm font-semibold text-gray-700">
          <Building2 className="h-4 w-4 text-blue-600" />
          조직 구조 관리
          <span className="text-xs font-normal text-gray-400 ml-1">
            ({org.length}개 본부 / {org.reduce((s, d) => s + d.teams.length, 0)}개 팀)
          </span>
        </div>
        {expanded
          ? <ChevronDown className="h-4 w-4 text-gray-400" />
          : <ChevronRight className="h-4 w-4 text-gray-400" />}
      </button>

      {expanded && (
        <div className="border-t border-gray-100 px-5 py-4 space-y-3">
          {org.map(div => (
            <div key={div.id} className="border border-gray-200 rounded-lg overflow-hidden">
              {/* 본부 행 */}
              <div className="flex items-center gap-2 px-4 py-2.5 bg-gray-50">
                <button onClick={() => toggleDiv(div.id)} className="text-gray-400 hover:text-gray-600">
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
                      className="flex-1 border border-blue-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                      autoFocus
                    />
                    <button onClick={() => saveDivName(div.id)} disabled={busy}
                      className="text-xs px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700">저장</button>
                    <button onClick={() => setEditingDiv(null)}
                      className="text-xs px-2 py-1 text-gray-500 hover:text-gray-700">취소</button>
                  </div>
                ) : (
                  <span className="flex-1 font-medium text-gray-800 text-sm">
                    {div.name}
                    <span className="ml-2 text-xs text-gray-400">({div.teams.length}개 팀)</span>
                  </span>
                )}

                {editingDiv !== div.id && (
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => { setEditingDiv(div.id); setEditDivName(div.name) }}
                      className="text-gray-400 hover:text-blue-600 transition-colors p-1"
                      title="본부명 수정"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => deleteDivision(div)}
                      disabled={busy}
                      className="text-gray-300 hover:text-red-500 transition-colors p-1"
                      title="본부 삭제"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
              </div>

              {/* 팀 목록 */}
              {expandedDivs.has(div.id) && (
                <div className="px-4 py-2 space-y-1.5 bg-white">
                  {div.teams.map(team => (
                    <div key={team.id} className="flex items-center gap-2 group">
                      <span className="text-gray-400 text-xs">└</span>
                      {editingTeam === team.id ? (
                        <div className="flex items-center gap-1 flex-1">
                          <input
                            value={editTeamName}
                            onChange={e => setEditTeamName(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') saveTeamName(team.id); if (e.key === 'Escape') setEditingTeam(null) }}
                            className="flex-1 border border-blue-300 rounded px-2 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                            autoFocus
                          />
                          <button onClick={() => saveTeamName(team.id)} disabled={busy}
                            className="text-xs px-2 py-0.5 bg-blue-600 text-white rounded hover:bg-blue-700">저장</button>
                          <button onClick={() => setEditingTeam(null)}
                            className="text-xs px-2 py-0.5 text-gray-500 hover:text-gray-700">취소</button>
                        </div>
                      ) : (
                        <>
                          <span className="flex-1 text-sm text-gray-700">{team.name}</span>
                          <button
                            onClick={() => { setEditingTeam(team.id); setEditTeamName(team.name) }}
                            className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-blue-500 p-0.5 transition-all"
                            title="팀명 수정"
                          >
                            <Pencil className="h-3 w-3" />
                          </button>
                          <button
                            onClick={() => deleteTeam(team)}
                            disabled={busy}
                            className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-500 p-0.5 transition-all"
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
                    <span className="text-gray-300 text-xs">└</span>
                    <input
                      value={newTeamName[div.id] ?? ''}
                      onChange={e => setNewTeamName(prev => ({ ...prev, [div.id]: e.target.value }))}
                      onKeyDown={e => { if (e.key === 'Enter') addTeam(div.id) }}
                      placeholder="팀명 입력 후 Enter"
                      className="flex-1 border border-dashed border-gray-300 rounded px-2 py-1 text-xs text-gray-500 focus:outline-none focus:border-blue-400 focus:text-gray-900"
                    />
                    <button
                      onClick={() => addTeam(div.id)}
                      disabled={busy || !newTeamName[div.id]?.trim()}
                      className="text-xs px-2 py-1 text-blue-600 border border-blue-300 rounded hover:bg-blue-50 disabled:opacity-40 transition-colors"
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
                className="flex-1 border border-blue-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                autoFocus
              />
              <button onClick={addDivision} disabled={busy || !newDivName.trim()}
                className="px-3 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">추가</button>
              <button onClick={() => { setAddingDiv(false); setNewDivName('') }}
                className="px-3 py-2 text-sm text-gray-500 border border-gray-300 rounded-lg hover:bg-gray-50">취소</button>
            </div>
          ) : (
            <button
              onClick={() => setAddingDiv(true)}
              className="flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-800 font-medium"
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
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h3 className="text-base font-semibold text-gray-900">계정 편집</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          {/* 이메일 */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">이메일 *</label>
            <input
              type="email"
              value={form.email}
              onChange={e => set('email', e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {form.email.toLowerCase() !== user.email && user.id !== null && (
              <p className="mt-1 text-xs text-amber-600">⚠ 이메일 변경 시 사용자는 새 이메일로 재로그인해야 합니다.</p>
            )}
          </div>

          {/* 이름 */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">이름</label>
            <input
              type="text"
              value={form.display_name}
              onChange={e => set('display_name', e.target.value)}
              placeholder="홍길동"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* 본부 + 팀 */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">본부</label>
              <select
                value={form.division}
                onChange={e => handleDivisionChange(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">선택 안 함</option>
                {org.map(d => (
                  <option key={d.id} value={d.name}>{d.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">팀</label>
              <select
                value={form.team}
                onChange={e => set('team', e.target.value)}
                disabled={!form.division || availableTeams.length === 0}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-400"
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
              <label className="block text-xs font-medium text-gray-600 mb-1">권한</label>
              <select
                value={form.role}
                onChange={e => set('role', e.target.value)}
                disabled={user.email === 'hrb.main@gmail.com'}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-400"
              >
                <option value="user">일반</option>
                <option value="admin">관리자</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">계정 상태</label>
              <select
                value={form.is_active ? 'active' : 'inactive'}
                onChange={e => set('is_active', e.target.value === 'active')}
                disabled={user.role === 'admin'}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-400"
              >
                <option value="active">활성</option>
                <option value="inactive">비활성</option>
              </select>
            </div>
          </div>

          {/* 표시 순서 */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              표시 순서
              <span className="ml-1 font-normal text-gray-400">(숫자가 작을수록 앞에 표시, 기본 999)</span>
            </label>
            <input
              type="number"
              min={1}
              max={9999}
              value={form.display_order}
              onChange={e => setForm(p => ({ ...p, display_order: Number(e.target.value) }))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
          )}

          <div className="flex justify-end gap-3 pt-1">
            <button type="button" onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50">
              취소
            </button>
            <button type="submit" disabled={saving}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50">
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
    <div className="bg-blue-50 border border-blue-200 rounded-lg p-5">
      <h3 className="text-sm font-semibold text-blue-800 mb-4">새 계정 사전 등록</h3>
      <form onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">이메일 *</label>
          <input type="email" value={form.email} onChange={e => set('email', e.target.value)}
            placeholder="name@company.com"
            className="w-full border border-gray-300 rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">이름</label>
          <input type="text" value={form.display_name} onChange={e => set('display_name', e.target.value)}
            placeholder="홍길동"
            className="w-full border border-gray-300 rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">본부</label>
          <select value={form.division}
            onChange={e => setForm(p => ({ ...p, division: e.target.value, team: '' }))}
            className="w-full border border-gray-300 rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500">
            <option value="">선택 안 함</option>
            {org.map(d => <option key={d.id} value={d.name}>{d.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">팀</label>
          <select value={form.team} onChange={e => set('team', e.target.value)}
            disabled={!form.division || availableTeams.length === 0}
            className="w-full border border-gray-300 rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-50">
            <option value="">선택 안 함</option>
            {availableTeams.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">권한</label>
          <select value={form.role} onChange={e => set('role', e.target.value)}
            className="w-full border border-gray-300 rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500">
            <option value="user">일반</option>
            <option value="admin">관리자</option>
          </select>
        </div>
        <div className="flex items-end gap-2">
          <button type="submit" disabled={saving}
            className="flex-1 bg-blue-600 text-white rounded-md px-3 py-1.5 text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
            {saving ? '등록 중...' : '등록'}
          </button>
          <button type="button" onClick={onDone}
            className="px-3 py-1.5 border border-gray-300 rounded-md text-sm text-gray-600 hover:bg-gray-50">
            취소
          </button>
        </div>
      </form>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
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
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-gray-900">관리자 — 계정 관리</h2>
        <Link href="/admin/notifications" className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors border border-blue-200">
          알림 발송 내역 보기
        </Link>
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
        <p className="text-sm text-gray-500">총 {users.length}명</p>
        <div className="flex items-center gap-3">
          <button onClick={fetchUsers}
            className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800">
            <RefreshCw className="h-4 w-4" /> 새로고침
          </button>
          <button
            onClick={() => setShowRegister(v => !v)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
          >
            <UserPlus className="h-4 w-4" />
            새 계정 등록
          </button>
        </div>
      </div>

      {/* 계정 테이블 */}
      {loading ? (
        <div className="py-16 text-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-4 border-gray-200 border-t-blue-600" />
          <p className="mt-2 text-sm text-gray-500">불러오는 중...</p>
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase whitespace-nowrap">이메일</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase whitespace-nowrap">이름</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase whitespace-nowrap">본부</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase whitespace-nowrap">팀</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase whitespace-nowrap">권한</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase whitespace-nowrap">상태</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase whitespace-nowrap">순서</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase whitespace-nowrap">최근 로그인</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase whitespace-nowrap">최근 제출</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase whitespace-nowrap">편집</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase whitespace-nowrap">잠금</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase whitespace-nowrap">삭제</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-100">
                {users.map(user => (
                  <tr key={user.email}
                    className={`hover:bg-gray-50 transition-colors ${!user.is_active ? 'opacity-50' : ''}`}>
                    {/* 이메일 */}
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="text-xs text-gray-700">{user.email}</span>
                      {!user.id && (
                        <span className="ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded text-xs bg-yellow-100 text-yellow-700">
                          미접속
                        </span>
                      )}
                    </td>
                    {/* 이름 */}
                    <td className="px-4 py-3 whitespace-nowrap text-gray-900 font-medium">
                      {user.display_name ?? <span className="text-gray-400 font-normal">-</span>}
                    </td>
                    {/* 본부 */}
                    <td className="px-4 py-3 whitespace-nowrap text-gray-600 text-xs">
                      {user.division ?? <span className="text-gray-300">-</span>}
                    </td>
                    {/* 팀 */}
                    <td className="px-4 py-3 whitespace-nowrap text-gray-600 text-xs">
                      {user.team ?? <span className="text-gray-300">-</span>}
                    </td>
                    {/* 권한 */}
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium
                        ${user.role === 'admin'
                          ? 'bg-purple-100 text-purple-700'
                          : 'bg-gray-100 text-gray-600'}`}>
                        {user.role === 'admin' ? '관리자' : '일반'}
                      </span>
                    </td>
                    {/* 상태 */}
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium
                        ${user.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
                        {user.is_active ? '활성' : '비활성'}
                      </span>
                    </td>
                    {/* 표시 순서 */}
                    <td className="px-4 py-3 text-gray-400 whitespace-nowrap text-xs text-center">
                      {user.display_order ?? 999}
                    </td>
                    {/* 최근 로그인 */}
                    <td className="px-4 py-3 text-gray-400 whitespace-nowrap text-xs">{fmt(user.last_login_at)}</td>
                    {/* 최근 제출 */}
                    <td className="px-4 py-3 text-gray-400 whitespace-nowrap text-xs">{fmt(user.last_submitted_at)}</td>
                    {/* 편집 */}
                    <td className="px-4 py-3 text-center">
                      <button
                        onClick={() => setEditingUser(user)}
                        className="text-gray-400 hover:text-blue-600 transition-colors"
                        title="편집"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                    </td>
                    {/* 잠금/해제 */}
                    <td className="px-4 py-3 text-center">
                      {user.role !== 'admin' ? (
                        <button
                          onClick={() => toggleActive(user)}
                          disabled={togglingEmail === user.email}
                          className={`transition-colors disabled:opacity-40
                            ${user.is_active ? 'text-gray-400 hover:text-red-600' : 'text-red-400 hover:text-green-600'}`}
                          title={user.is_active ? '비활성화' : '활성화'}
                        >
                          {user.is_active ? <Lock className="h-4 w-4" /> : <Unlock className="h-4 w-4" />}
                        </button>
                      ) : (
                        <span className="text-xs text-gray-300">보호됨</span>
                      )}
                    </td>
                    {/* 삭제 */}
                    <td className="px-4 py-3 text-center">
                      {user.role !== 'admin' ? (
                        <button
                          onClick={() => deleteUser(user)}
                          disabled={togglingEmail === user.email}
                          className="text-gray-300 hover:text-red-500 transition-colors disabled:opacity-40"
                          title={user.id !== null ? '계정 완전 삭제' : '사전 등록 삭제'}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      ) : (
                        <span className="text-xs text-gray-200">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {users.length === 0 && (
              <div className="py-12 text-center text-sm text-gray-500">계정이 없습니다.</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
