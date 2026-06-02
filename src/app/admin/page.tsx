'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import {
  Lock, Unlock, RefreshCw, UserPlus, Trash2,
  ChevronDown, ChevronRight, Plus, X, Pencil, Loader2, Building2, Users
} from 'lucide-react'
import { format } from 'date-fns'
import Link from 'next/link'
import { Badge } from '@/components/ui'
import BulkRegisterForm from '@/components/admin/BulkRegisterForm'

// ─── 타입 ────────────────────────────────────────────────────────────────────

interface OrgTeam {
  id: string
  division_id: string
  name: string
  use_check_in_complete?: boolean
  /** v1.51: 팀별 cron 알림 ON/OFF (default true) */
  notify_morning_07?: boolean
  notify_reminder_20?: boolean
  notify_reminder_22?: boolean
  /** v1.73: 리더 관리 뷰 사용 여부 (default false) */
  use_leader_review?: boolean
}
interface OrgDivision {
  id: string
  name: string
  teams: OrgTeam[]
  /** v1.50: 본부별 사전등록 알림 정책. true면 planned_* 첫 등록 시점에 Teams 알림 발송. */
  notify_on_advance_checkin?: boolean
}

interface UserProfile {
  email: string
  id: string | null
  display_name: string | null
  division: string | null
  team: string | null
  /** 본부 직속(team 없음) 인원의 알림 라우팅 대상 팀명. team이 있으면 무시. */
  notify_team: string | null
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
  // fetchOrg가 async라 Promise<void> 반환 — 각 핸들러에서 await으로 list 갱신 완료까지 busy 상태 유지.
  onOrgChange: () => Promise<void> | void
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
    await onOrgChange()
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
    await onOrgChange()
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
    await onOrgChange()
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
    await onOrgChange()
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
    await onOrgChange()
    setBusy(false)
  }

  const deleteTeam = async (team: OrgTeam) => {
    if (!confirm(`"${team.name}" 팀을 삭제하시겠습니까?`)) return
    setBusy(true)
    const res = await fetch(`/api/admin/org/teams/${team.id}`, { method: 'DELETE' })
    const data = await res.json()
    if (!res.ok) { alert(data.error); setBusy(false); return }
    await onOrgChange()
    setBusy(false)
  }

  /** 본부의 notify_on_advance_checkin 토글 (v1.50) */
  const toggleDivisionAdvanceNotify = async (div: OrgDivision) => {
    const current = div.notify_on_advance_checkin ?? false
    const next = !current
    const msg = next
      ? `"${div.name}" 본부는 앞으로 사용자가 출근 예정시간을 처음 등록하는 순간 Teams 알림이 발송됩니다.\n(당일/D+1/미래 무관, 출근완료 알림과 별개로 추가 발송)\n\n계속하시겠습니까?`
      : `"${div.name}" 본부는 앞으로 출근 등록 즉시 알림을 발송하지 않습니다.\n(기존 출근완료/수정 알림은 그대로 유지)\n\n계속하시겠습니까?`
    if (!confirm(msg)) return
    setBusy(true)
    const res = await fetch(`/api/admin/org/divisions/${div.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notify_on_advance_checkin: next }),
    })
    const data = await res.json()
    if (!res.ok) { alert(data.error ?? '설정 변경 실패'); setBusy(false); return }
    await onOrgChange()
    setBusy(false)
  }

  /** v1.51 — 팀의 cron 알림 ON/OFF 토글 (3종 중 하나) */
  const toggleTeamCronFlag = async (
    team: OrgTeam,
    flagKey: 'notify_morning_07' | 'notify_reminder_20' | 'notify_reminder_22',
    label: string,
  ) => {
    const current = team[flagKey] ?? true
    const next = !current
    if (!confirm(`"${team.name}" 팀의 ${label} 알림을 ${next ? 'ON' : 'OFF'}로 변경하시겠습니까?`)) return
    setBusy(true)
    const res = await fetch(`/api/admin/org/teams/${team.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [flagKey]: next }),
    })
    const data = await res.json()
    if (!res.ok) { alert(data.error ?? '설정 변경 실패'); setBusy(false); return }
    await onOrgChange()
    setBusy(false)
  }

  /** 팀의 use_check_in_complete 토글 */
  const toggleTeamCheckInComplete = async (team: OrgTeam) => {
    const current = team.use_check_in_complete ?? true
    const next = !current
    const msg = next
      ? `"${team.name}" 팀은 앞으로 [출근 완료] 버튼 단계를 사용합니다.\n출근보고 후 [출근 완료] 클릭 시점이 실제 출근시각으로 기록됩니다.`
      : `"${team.name}" 팀은 앞으로 [출근 완료] 버튼 단계를 사용하지 않습니다.\n출근보고 제출 시점에 예정 출근시각(예: 09:00)이 자동으로 실제 출근시각으로 기록됩니다.\n지각/조기출근은 본인이 출근보고 수정으로 변경합니다.\n\n계속하시겠습니까?`
    if (!confirm(msg)) return
    setBusy(true)
    const res = await fetch(`/api/admin/org/teams/${team.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ use_check_in_complete: next }),
    })
    const data = await res.json()
    if (!res.ok) { alert(data.error ?? '설정 변경 실패'); setBusy(false); return }
    await onOrgChange()
    setBusy(false)
  }

  /** v1.73: 팀의 use_leader_review 토글 */
  const toggleTeamLeaderReview = async (team: OrgTeam) => {
    const current = team.use_leader_review ?? false
    const next = !current
    const msg = next
      ? `"${team.name}" 팀의 리더에게 [제출내역 → 리더 관리] 탭을 노출합니다.\n리더가 팀원 보고에 체크완료/EW미상신/EW오상신 피드백을 박을 수 있습니다.`
      : `"${team.name}" 팀의 리더 관리 탭을 숨깁니다.\n기존에 박힌 피드백 데이터는 보존됩니다.\n\n계속하시겠습니까?`
    if (!confirm(msg)) return
    setBusy(true)
    const res = await fetch(`/api/admin/org/teams/${team.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ use_leader_review: next }),
    })
    const data = await res.json()
    if (!res.ok) { alert(data.error ?? '설정 변경 실패'); setBusy(false); return }
    await onOrgChange()
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
                    {/* v1.50 — 본부별 사전등록 알림 토글 */}
                    <button
                      onClick={() => toggleDivisionAdvanceNotify(div)}
                      disabled={busy}
                      className={
                        'text-[10px] px-1.5 py-0.5 rounded-full border transition-colors mr-1 ' +
                        ((div.notify_on_advance_checkin ?? false)
                          ? 'border-primary-200 bg-primary-50 text-primary-700 hover:bg-primary-100'
                          : 'border-border bg-surface-muted text-text-muted hover:text-text-primary')
                      }
                      title={
                        (div.notify_on_advance_checkin ?? false)
                          ? '출근 등록 즉시 알림 ON (클릭해서 OFF)'
                          : '출근 등록 즉시 알림 OFF (클릭해서 ON)'
                      }
                    >
                      {(div.notify_on_advance_checkin ?? false) ? '출근등록 알림 ON' : '출근등록 알림 OFF'}
                    </button>
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
                            onClick={() => toggleTeamCheckInComplete(team)}
                            disabled={busy}
                            className={
                              'text-[10px] px-1.5 py-0.5 rounded-full border transition-colors ' +
                              ((team.use_check_in_complete ?? true)
                                ? 'border-primary-200 bg-primary-50 text-primary-700 hover:bg-primary-100'
                                : 'border-warning-border bg-warning-bg text-warning-text hover:opacity-80')
                            }
                            title={
                              (team.use_check_in_complete ?? true)
                                ? '출근 완료 단계 사용 중 (클릭해서 미사용으로 변경)'
                                : '출근 완료 단계 미사용 (클릭해서 사용으로 변경)'
                            }
                          >
                            {(team.use_check_in_complete ?? true) ? '출근완료 ON' : '출근완료 OFF'}
                          </button>
                          {/* v1.51 — 팀별 cron 알림 ON/OFF 토글 3종 */}
                          {([
                            { key: 'notify_morning_07'  as const, label: '07', desc: '07시 아침요약' },
                            { key: 'notify_reminder_20' as const, label: '20', desc: '20시 리마인더' },
                            { key: 'notify_reminder_22' as const, label: '22', desc: '22시 리마인더' },
                          ]).map(({ key, label, desc }) => {
                            const on = team[key] ?? true
                            return (
                              <button
                                key={key}
                                onClick={() => toggleTeamCronFlag(team, key, desc)}
                                disabled={busy}
                                className={
                                  'text-[10px] px-1.5 py-0.5 rounded-full border transition-colors ' +
                                  (on
                                    ? 'border-primary-200 bg-primary-50 text-primary-700 hover:bg-primary-100'
                                    : 'border-border bg-surface-muted text-text-muted hover:text-text-primary line-through')
                                }
                                title={`${desc} 알림 ${on ? 'ON' : 'OFF'} (클릭해서 변경)`}
                              >
                                {label}시
                              </button>
                            )
                          })}
                          {/* v1.73 — 리더 관리 뷰 사용 토글 */}
                          <button
                            onClick={() => toggleTeamLeaderReview(team)}
                            disabled={busy}
                            className={
                              'text-[10px] px-1.5 py-0.5 rounded-full border transition-colors ' +
                              ((team.use_leader_review ?? false)
                                ? 'border-primary-200 bg-primary-50 text-primary-700 hover:bg-primary-100'
                                : 'border-border bg-surface-muted text-text-muted hover:text-text-primary')
                            }
                            title={
                              (team.use_leader_review ?? false)
                                ? '리더 관리 뷰 ON (클릭해서 OFF로 변경)'
                                : '리더 관리 뷰 OFF (클릭해서 ON으로 변경)'
                            }
                          >
                            {(team.use_leader_review ?? false) ? '리더관리 ON' : '리더관리 OFF'}
                          </button>
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
    notify_team: user.notify_team ?? '',
    role: user.role,
    is_active: user.is_active,
    display_order: user.display_order ?? 999,
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const set = (k: string, v: string | boolean) => setForm(p => ({ ...p, [k]: v }))

  // 선택된 본부의 팀 목록
  const availableTeams = org.find(d => d.name === form.division)?.teams ?? []

  // 본부 변경 시 팀·알림팀 초기화
  const handleDivisionChange = (divName: string) => {
    setForm(p => ({ ...p, division: divName, team: '', notify_team: '' }))
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
      // display_order 정정 (ABC-194):
      //   기존: Number(form.display_order) || 999 — 빈 input·0 모두 falsy라 999 reset.
      //   PROD에서 사용자 form 열고 다른 컬럼만 수정해도 display_order가 999로 박히는 버그.
      //   수정: 유효한 양수만 새 값으로 보내고, 그 외엔 기존 값 유지(payload에서 빼면 서버가 안 건드림).
      const inputOrder = Number(form.display_order)
      const sanitizedOrder = Number.isFinite(inputOrder) && inputOrder > 0 ? inputOrder : user.display_order

      const res = await fetch(`/api/admin/users/${encodeURIComponent(user.email)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: form.email.trim().toLowerCase(),
          display_name: form.display_name.trim() || null,
          // 빈 값은 빈 문자열로 전송 — 서버 PATCH는 typeof === 'string'일 때만 갱신하므로
          // null을 보내면 "변경 안 함"으로 간주돼 기존 값이 유지됨(팀 비우기 불가 버그). 빈 문자열 → 서버에서 null로 정리.
          division: form.division,
          team: form.team,
          // 본부 직속(팀 없음)일 때만 의미 — 팀이 있으면 빈 문자열로 정리(서버에서 null)
          notify_team: form.team ? '' : form.notify_team,
          role: form.role,
          is_active: form.is_active,
          display_order: sanitizedOrder,
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

          {/* 본부 직속(팀 없음) — 알림 받을 팀 지정 */}
          {form.division && !form.team && (
            <div className="rounded-lg border border-warning-border bg-warning-bg/30 px-3 py-2.5">
              <label className="block text-xs font-medium text-text-secondary mb-1">
                알림 받을 팀 <span className="text-warning-text">(본부 직속)</span>
              </label>
              <select
                value={form.notify_team}
                onChange={e => set('notify_team', e.target.value)}
                disabled={availableTeams.length === 0}
                className="w-full border border-border-strong rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:bg-surface-muted disabled:text-text-muted"
              >
                <option value="">선택 안 함 (알림 발송 안 됨)</option>
                {availableTeams.map(t => (
                  <option key={t.id} value={t.name}>{t.name}</option>
                ))}
              </select>
              <p className="mt-1 text-[11px] text-text-muted leading-snug">
                팀이 없는 본부 직속 인원입니다. 출/퇴근 보고·미보고 알림이 여기서 고른 팀의 Teams 채널로 전송됩니다. 미지정 시 알림이 발송되지 않습니다.
              </p>
            </div>
          )}

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
  const [form, setForm] = useState({ email: '', display_name: '', division: '', team: '', notify_team: '', role: 'user' })
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
        // 팀이 있으면 notify_team은 무의미 → 비움
        body: JSON.stringify({ ...form, notify_team: form.team ? '' : form.notify_team }),
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
            onChange={e => setForm(p => ({ ...p, division: e.target.value, team: '', notify_team: '' }))}
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
        {form.division && !form.team && (
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">
              알림 팀 <span className="text-warning-text">(본부 직속)</span>
            </label>
            <select value={form.notify_team} onChange={e => set('notify_team', e.target.value)}
              disabled={availableTeams.length === 0}
              className="w-full border border-border-strong rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary-500 disabled:bg-surface-muted">
              <option value="">선택 안 함</option>
              {availableTeams.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
            </select>
          </div>
        )}
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
  const [showBulkRegister, setShowBulkRegister] = useState(false)
  const [editingUser, setEditingUser] = useState<UserProfile | null>(null)
  const [togglingEmail, setTogglingEmail] = useState<string | null>(null)

  // ?highlight=email — 신규 가입 알림 메일 링크에서 진입 시 해당 row 강조 + 자동 스크롤
  // useSearchParams 대신 window.location 사용 (Next.js 16 prerender Suspense 회피)
  const [highlightEmail, setHighlightEmail] = useState('')
  const [highlightActive, setHighlightActive] = useState(false)
  const highlightRowRef = useRef<HTMLTableRowElement | null>(null)

  // 본부/팀 필터 + 컬럼 정렬
  const [filterDiv, setFilterDiv] = useState('')
  const [filterTeam, setFilterTeam] = useState('')
  type SortKey = 'email' | 'display_name' | 'division' | 'team' | 'role' | 'is_active' | 'display_order' | 'last_login_at' | 'last_submitted_at'
  const [sortKey, setSortKey] = useState<SortKey>('display_order')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

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

  // 필터된 + 정렬된 사용자 목록
  const displayedUsers = useMemo(() => {
    const cmpStr = (a: string | null | undefined, b: string | null | undefined) => {
      const aa = (a ?? '').trim()
      const bb = (b ?? '').trim()
      return aa < bb ? -1 : aa > bb ? 1 : 0
    }
    const cmpNum = (a: number | null | undefined, b: number | null | undefined) => {
      const aa = typeof a === 'number' ? a : Number.MAX_SAFE_INTEGER
      const bb = typeof b === 'number' ? b : Number.MAX_SAFE_INTEGER
      return aa - bb
    }
    const roleOrder = (r: string | null | undefined) =>
      r === 'admin' ? 0 : r === 'leader' ? 1 : r === 'user' ? 2 : 3

    const filtered = users.filter(u => {
      if (filterDiv && (u.division ?? '') !== filterDiv) return false
      if (filterTeam && (u.team ?? '') !== filterTeam) return false
      return true
    })
    const sorted = [...filtered].sort((a, b) => {
      let cmp = 0
      switch (sortKey) {
        case 'email':            cmp = cmpStr(a.email, b.email); break
        case 'display_name':     cmp = cmpStr(a.display_name, b.display_name); break
        case 'division':         cmp = cmpStr(a.division, b.division); break
        case 'team':             cmp = cmpStr(a.team, b.team); break
        case 'role':             cmp = roleOrder(a.role) - roleOrder(b.role); break
        case 'is_active':        cmp = (a.is_active ? 0 : 1) - (b.is_active ? 0 : 1); break
        case 'display_order':    cmp = cmpNum(a.display_order, b.display_order); break
        case 'last_login_at':    cmp = cmpStr(a.last_login_at, b.last_login_at); break
        case 'last_submitted_at': cmp = cmpStr(a.last_submitted_at, b.last_submitted_at); break
      }
      return sortDir === 'asc' ? cmp : -cmp
    })
    return sorted
  }, [users, filterDiv, filterTeam, sortKey, sortDir])

  // 필터 옵션 — 본부는 org에서, 팀은 선택된 본부의 팀
  const divisionOptions = useMemo(() => org.map(d => d.name), [org])
  const teamOptions = useMemo(() => {
    if (!filterDiv) return Array.from(new Set(org.flatMap(d => d.teams.map(t => t.name)))).sort()
    return (org.find(d => d.name === filterDiv)?.teams ?? []).map(t => t.name)
  }, [org, filterDiv])

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
            href="/calendar"
            className="inline-flex items-center gap-1.5 h-10 px-4 text-sm font-medium rounded-[10px] bg-surface text-text-primary border border-border-strong hover:bg-surface-muted transition-colors"
          >
            일정관리 (캘린더)
          </Link>
          <Link
            href="/admin/calendars"
            className="inline-flex items-center gap-1.5 h-10 px-4 text-sm font-medium rounded-[10px] bg-surface text-text-primary border border-border-strong hover:bg-surface-muted transition-colors"
          >
            본부 캘린더 관리
          </Link>
          <Link
            href="/admin/sheet-sources"
            className="inline-flex items-center gap-1.5 h-10 px-4 text-sm font-medium rounded-[10px] bg-surface text-text-primary border border-border-strong hover:bg-surface-muted transition-colors"
          >
            외부 시트 source 관리
          </Link>
          <Link
            href="/admin/tags"
            className="inline-flex items-center gap-1.5 h-10 px-4 text-sm font-medium rounded-[10px] bg-surface text-text-primary border border-border-strong hover:bg-surface-muted transition-colors"
          >
            태그 관리
          </Link>
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

      {/* 사전 등록 폼 (단건) */}
      {showRegister && (
        <RegisterForm
          org={org}
          onDone={() => { setShowRegister(false); fetchUsers() }}
        />
      )}

      {/* 사전 등록 폼 (일괄) */}
      {showBulkRegister && (
        <BulkRegisterForm
          onDone={() => { setShowBulkRegister(false); fetchUsers() }}
        />
      )}

      {/* 툴바 */}
      <div className="flex flex-wrap justify-between items-center gap-3">
        <div className="flex items-center gap-3 flex-wrap">
          <p className="text-sm text-text-secondary">
            총 <span className="font-semibold text-text-primary tabular-nums">{displayedUsers.length}</span>
            {displayedUsers.length !== users.length && (
              <span className="text-text-muted"> / {users.length}</span>
            )}명
          </p>
          {/* 본부 필터 */}
          <select
            value={filterDiv}
            onChange={e => { setFilterDiv(e.target.value); setFilterTeam('') }}
            className="h-9 px-3 rounded-[10px] border border-border-strong bg-surface text-sm focus:outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20"
          >
            <option value="">전체 본부</option>
            {divisionOptions.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
          {/* 팀 필터 */}
          <select
            value={filterTeam}
            onChange={e => setFilterTeam(e.target.value)}
            className="h-9 px-3 rounded-[10px] border border-border-strong bg-surface text-sm focus:outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20"
          >
            <option value="">전체 팀</option>
            {teamOptions.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          {(filterDiv || filterTeam) && (
            <button
              type="button"
              onClick={() => { setFilterDiv(''); setFilterTeam('') }}
              className="text-[12px] text-text-muted hover:text-text-primary underline"
            >
              필터 초기화
            </button>
          )}
        </div>
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
            onClick={() => { setShowBulkRegister(v => !v); if (!showBulkRegister) setShowRegister(false) }}
            className="inline-flex items-center gap-1.5 h-10 px-4 text-sm font-medium rounded-[10px] border border-border-strong bg-surface text-text-primary hover:bg-surface-muted transition-colors"
          >
            <Users className="h-4 w-4" aria-hidden />
            일괄 등록
          </button>
          <button
            type="button"
            onClick={() => { setShowRegister(v => !v); if (!showRegister) setShowBulkRegister(false) }}
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
                  {([
                    { key: 'email', label: '이메일' },
                    { key: 'display_name', label: '이름' },
                    { key: 'division', label: '본부' },
                    { key: 'team', label: '팀' },
                    { key: 'role', label: '권한' },
                    { key: 'is_active', label: '상태' },
                    { key: 'display_order', label: '순서' },
                    { key: 'last_login_at', label: '최근 로그인' },
                    { key: 'last_submitted_at', label: '최근 제출' },
                  ] as { key: SortKey; label: string }[]).map(({ key, label }) => {
                    const active = sortKey === key
                    return (
                      <th
                        key={key}
                        onClick={() => toggleSort(key)}
                        className={`bg-background border-b border-border px-4 py-3 text-left text-[12px] font-semibold whitespace-nowrap cursor-pointer select-none transition-colors hover:bg-surface-muted ${active ? 'text-primary-700' : 'text-text-secondary'}`}
                        title="클릭하여 정렬"
                      >
                        <span className="inline-flex items-center gap-1">
                          {label}
                          <span className={`text-[10px] ${active ? 'opacity-100' : 'opacity-30'}`}>
                            {active && sortDir === 'desc' ? '▼' : '▲'}
                          </span>
                        </span>
                      </th>
                    )
                  })}
                  {['편집','잠금','삭제'].map(h => (
                    <th key={h} className="bg-background border-b border-border px-4 py-3 text-center text-[12px] font-semibold text-text-secondary whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {displayedUsers.map(user => {
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
