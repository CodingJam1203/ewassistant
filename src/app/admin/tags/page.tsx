'use client'

/**
 * /admin/tags — org_tags(본부별 alias 매핑) 관리 페이지.
 *
 * 권한 (middleware): admin OR leader 진입 가능. 실제 CRUD scope는 API에서 검증.
 *   - admin: 모든 본부 read/write
 *   - division leader: 본인 본부 read/write (팀 + 본부 공용)
 *   - team leader: 본인 팀 read/write + 본부 공용 read-only
 *
 * UI 요약:
 *   - 상단: 페이지 제목 · 필터 dropdown(본부) · "새 태그" 버튼
 *   - 목록: 본부 → 팀별 그룹 카드. 각 행 label, alias chips, member chips, is_active, edit/delete
 *   - 추가/편집 form은 모달 — alias_patterns는 textarea(콤마/줄바꿈 분리), member_emails는 multi-select
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Plus, Pencil, Trash2, Loader2, X, Check } from 'lucide-react'
import CustomDropdown from '@/components/ui/CustomDropdown'

interface Tag {
  id: string
  division_id: string
  team_id: string | null
  label: string
  alias_patterns: string[]
  member_emails: string[]
  is_active: boolean
  updated_at: string
  canEdit: boolean
}

interface Division { id: string; name: string; sort_order: number }
interface Team { id: string; name: string; division_id: string; sort_order: number }
interface User { email: string; display_name: string; division: string | null; team: string | null }

interface MyScope {
  kind: 'admin' | 'division' | 'team'
  divisionId: string | null
  teamId: string | null
}

interface ApiPayload {
  tags: Tag[]
  divisions: Division[]
  teams: Team[]
  users: User[]
  myScope: MyScope
}

const ALL_DIVISIONS = '__ALL__'
const COMMON_TEAM = '__COMMON__'  // 본부 공용 (team_id null) form 표현용

export default function AdminTagsPage() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<ApiPayload | null>(null)

  const [filterDivisionId, setFilterDivisionId] = useState<string>(ALL_DIVISIONS)
  const [editing, setEditing] = useState<Tag | null>(null)
  const [creating, setCreating] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/tags', { cache: 'no-store' })
      if (!res.ok) {
        const t = await res.text()
        throw new Error(`HTTP ${res.status}: ${t}`)
      }
      const json = (await res.json()) as ApiPayload
      setData(json)
      // leader는 본인 본부 강제 — 사용자가 굳이 선택할 필요 없음
      if (json.myScope.kind !== 'admin' && json.myScope.divisionId) {
        setFilterDivisionId(json.myScope.divisionId)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const divisionsById = useMemo(() => {
    const m = new Map<string, Division>()
    for (const d of data?.divisions ?? []) m.set(d.id, d)
    return m
  }, [data])

  const teamsById = useMemo(() => {
    const m = new Map<string, Team>()
    for (const t of data?.teams ?? []) m.set(t.id, t)
    return m
  }, [data])

  const userByEmail = useMemo(() => {
    const m = new Map<string, User>()
    for (const u of data?.users ?? []) m.set(u.email.toLowerCase(), u)
    return m
  }, [data])

  // 필터 적용된 tag 목록 — 본부별 → 팀별 그룹으로 정렬
  const groupedTags = useMemo(() => {
    if (!data) return []
    const filtered = filterDivisionId === ALL_DIVISIONS
      ? data.tags
      : data.tags.filter(t => t.division_id === filterDivisionId)

    // division → team → tags 정렬
    const byDivTeam = new Map<string, Map<string | '__null__', Tag[]>>()
    for (const t of filtered) {
      if (!byDivTeam.has(t.division_id)) byDivTeam.set(t.division_id, new Map())
      const teamMap = byDivTeam.get(t.division_id)!
      const tKey = t.team_id ?? '__null__'
      const list = teamMap.get(tKey) ?? []
      list.push(t)
      teamMap.set(tKey, list)
    }

    const result: Array<{
      divisionId: string
      divisionName: string
      teams: Array<{ teamId: string | null; teamName: string; tags: Tag[] }>
    }> = []
    const divEntries = Array.from(byDivTeam.entries()).sort(([a], [b]) => {
      const sa = divisionsById.get(a)?.sort_order ?? 999
      const sb = divisionsById.get(b)?.sort_order ?? 999
      return sa - sb
    })
    for (const [divId, teamMap] of divEntries) {
      const teams: Array<{ teamId: string | null; teamName: string; tags: Tag[] }> = []
      const teamEntries = Array.from(teamMap.entries()).sort(([a], [b]) => {
        // 본부 공용(null)을 가장 위로
        if (a === '__null__') return -1
        if (b === '__null__') return 1
        const sa = teamsById.get(a)?.sort_order ?? 999
        const sb = teamsById.get(b)?.sort_order ?? 999
        return sa - sb
      })
      for (const [tKey, tags] of teamEntries) {
        const teamId = tKey === '__null__' ? null : tKey
        teams.push({
          teamId,
          teamName: teamId ? (teamsById.get(teamId)?.name ?? '?') : '본부 공용',
          tags: tags.sort((a, b) => a.label.localeCompare(b.label, 'ko')),
        })
      }
      result.push({
        divisionId: divId,
        divisionName: divisionsById.get(divId)?.name ?? '?',
        teams,
      })
    }
    return result
  }, [data, filterDivisionId, divisionsById, teamsById])

  const handleSaved = useCallback((updated: Tag, isCreate: boolean) => {
    setData(prev => {
      if (!prev) return prev
      const next = isCreate
        ? [...prev.tags, updated]
        : prev.tags.map(t => (t.id === updated.id ? updated : t))
      return { ...prev, tags: next }
    })
    setEditing(null)
    setCreating(false)
  }, [])

  const handleDelete = useCallback(async (tag: Tag) => {
    if (!confirm(`태그 "${tag.label}" 을(를) 삭제하시겠습니까?`)) return
    try {
      const res = await fetch(`/api/admin/tags/${tag.id}`, { method: 'DELETE', cache: 'no-store' })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        alert(`삭제 실패: ${j.error ?? res.status}`)
        return
      }
      setData(prev => prev ? { ...prev, tags: prev.tags.filter(t => t.id !== tag.id) } : prev)
    } catch (err) {
      alert(`삭제 실패: ${err instanceof Error ? err.message : String(err)}`)
    }
  }, [])

  if (loading) {
    return (
      <div className="max-w-[80rem] mx-auto p-4">
        <div className="rounded-[10px] border border-border bg-surface p-8 text-center text-sm text-text-muted">
          <Loader2 className="h-5 w-5 animate-spin inline mr-2" /> 불러오는 중…
        </div>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="max-w-[80rem] mx-auto p-4">
        <div className="rounded-[10px] border border-danger-border bg-danger-bg p-4 text-sm text-danger-text">
          {error ?? '데이터 없음'}
        </div>
      </div>
    )
  }

  const myScope = data.myScope
  const canFilterByDivision = myScope.kind === 'admin'  // leader는 본인 본부 고정
  const canCreate = myScope.kind !== 'team' || true  // team leader도 본인 팀 tag 생성 가능

  return (
    <div className="max-w-[80rem] mx-auto p-3 sm:p-4 space-y-3">
      <div className="flex items-center gap-3">
        <Link href="/home" className="inline-flex items-center gap-1 text-sm text-text-secondary hover:text-text-primary">
          <ArrowLeft className="h-4 w-4" /> 홈
        </Link>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold text-text-primary">캘린더 태그 관리</h1>
          <span className="text-xs text-text-muted">
            본부별 alias 매핑 — "[A파트]", "[MICE팀]" 등을 멤버 그룹으로 자동 expand
          </span>
        </div>
        {canCreate && (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="inline-flex items-center gap-1 h-9 px-3 rounded-[10px] bg-primary-600 text-white text-sm font-medium hover:bg-primary-700"
          >
            <Plus className="h-4 w-4" /> 새 태그
          </button>
        )}
      </div>

      {/* 본부 필터 — admin만 노출 */}
      {canFilterByDivision && (
        <div className="w-56">
          <CustomDropdown
            value={filterDivisionId}
            onChange={setFilterDivisionId}
            ariaLabel="본부 필터"
            options={[
              { value: ALL_DIVISIONS, label: '전체 본부' },
              ...data.divisions.map(d => ({ value: d.id, label: d.name })),
            ]}
          />
        </div>
      )}

      {/* 본부별 그룹 카드 */}
      {groupedTags.length === 0 ? (
        <div className="rounded-[10px] border border-border bg-surface p-8 text-center text-sm text-text-muted">
          등록된 태그가 없습니다. "새 태그"로 추가하세요.
        </div>
      ) : (
        <div className="space-y-4">
          {groupedTags.map(grp => (
            <div key={grp.divisionId} className="rounded-[10px] border border-border bg-surface overflow-hidden">
              <div className="bg-surface-muted px-3 py-2 text-sm font-semibold text-text-primary border-b border-border">
                {grp.divisionName}
              </div>
              <div className="divide-y divide-border">
                {grp.teams.map(team => (
                  <div key={`${grp.divisionId}-${team.teamId ?? 'common'}`}>
                    <div className="bg-surface px-3 py-1.5 text-xs font-medium text-text-secondary border-b border-border">
                      {team.teamName}
                    </div>
                    {team.tags.map(tag => (
                      <TagRow
                        key={tag.id}
                        tag={tag}
                        userByEmail={userByEmail}
                        onEdit={() => setEditing(tag)}
                        onDelete={() => handleDelete(tag)}
                      />
                    ))}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="text-xs text-text-muted px-1">
        내 권한: {myScope.kind === 'admin' ? '관리자(전체 본부)' :
                  myScope.kind === 'division' ? '본부장(본인 본부)' :
                                                '팀장(본인 팀 + 본부 공용 read)'}
      </div>

      {(creating || editing) && (
        <TagFormModal
          tag={editing}
          isCreate={creating}
          data={data}
          onClose={() => { setEditing(null); setCreating(false) }}
          onSaved={handleSaved}
        />
      )}
    </div>
  )
}

interface TagRowProps {
  tag: Tag
  userByEmail: Map<string, User>
  onEdit: () => void
  onDelete: () => void
}

function TagRow({ tag, userByEmail, onEdit, onDelete }: TagRowProps) {
  return (
    <div className={`px-3 py-3 grid grid-cols-1 md:grid-cols-[14rem_1fr_1fr_5rem_5rem] gap-3 items-start ${tag.is_active ? '' : 'opacity-50'}`}>
      <div>
        <div className="font-medium text-text-primary text-sm">{tag.label}</div>
        {!tag.is_active && <div className="text-[10px] text-text-muted">비활성</div>}
      </div>
      <div className="flex flex-wrap gap-1">
        {tag.alias_patterns.map(a => (
          <span key={a} className="inline-block px-1.5 py-0.5 text-[11px] rounded bg-primary-50 text-primary-700 border border-primary-100">
            {a}
          </span>
        ))}
      </div>
      <div className="flex flex-wrap gap-1">
        {tag.member_emails.map(em => {
          const u = userByEmail.get(em.toLowerCase())
          return (
            <span key={em} className="inline-block px-1.5 py-0.5 text-[11px] rounded bg-surface-muted text-text-secondary" title={em}>
              {u?.display_name ?? em}
            </span>
          )
        })}
      </div>
      <div className="text-[11px] text-text-muted tabular-nums self-center">
        {tag.member_emails.length}명
      </div>
      <div className="flex items-center gap-1 justify-end">
        {tag.canEdit ? (
          <>
            <button
              type="button"
              onClick={onEdit}
              className="inline-flex items-center justify-center h-7 w-7 rounded border border-border-strong bg-surface hover:bg-surface-muted"
              aria-label="편집"
              title="편집"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={onDelete}
              className="inline-flex items-center justify-center h-7 w-7 rounded border border-danger-border bg-surface hover:bg-danger-bg text-danger-text"
              aria-label="삭제"
              title="삭제"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </>
        ) : (
          <span className="text-[10px] text-text-muted">읽기 전용</span>
        )}
      </div>
    </div>
  )
}

interface TagFormModalProps {
  tag: Tag | null
  isCreate: boolean
  data: ApiPayload
  onClose: () => void
  onSaved: (updated: Tag, isCreate: boolean) => void
}

function TagFormModal({ tag, isCreate, data, onClose, onSaved }: TagFormModalProps) {
  const initialDivisionId = tag?.division_id
    ?? data.myScope.divisionId
    ?? data.divisions[0]?.id
    ?? ''
  const initialTeamId = tag
    ? (tag.team_id ?? COMMON_TEAM)
    : (data.myScope.kind === 'team' ? data.myScope.teamId ?? COMMON_TEAM : COMMON_TEAM)

  const [label, setLabel] = useState(tag?.label ?? '')
  const [divisionId, setDivisionId] = useState(initialDivisionId)
  const [teamId, setTeamId] = useState<string>(initialTeamId)
  const [aliasText, setAliasText] = useState((tag?.alias_patterns ?? []).join(', '))
  const [selectedEmails, setSelectedEmails] = useState<string[]>(tag?.member_emails ?? [])
  const [isActive, setIsActive] = useState(tag?.is_active ?? true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [memberFilter, setMemberFilter] = useState('')

  // scope에 따른 제약
  const lockedDivision = data.myScope.kind !== 'admin'
  const lockedTeam = data.myScope.kind === 'team'

  // 본부에 해당하는 팀 리스트만 노출
  const teamOptions = useMemo(() => {
    const teams = data.teams.filter(t => t.division_id === divisionId)
    return [
      { value: COMMON_TEAM, label: '본부 공용' },
      ...teams.map(t => ({ value: t.id, label: t.name })),
    ]
  }, [data.teams, divisionId])

  // 사용자 후보 — 본부 안 또는 전체. multi-select 검색 + checkbox
  const candidateUsers = useMemo(() => {
    const divName = data.divisions.find(d => d.id === divisionId)?.name ?? ''
    // 본부 안 사용자 우선, 그 외 사용자도 검색은 가능
    const ranked = data.users.map(u => ({
      ...u,
      inDivision: u.division === divName,
    }))
    return ranked.sort((a, b) => {
      if (a.inDivision !== b.inDivision) return a.inDivision ? -1 : 1
      return (a.display_name ?? '').localeCompare(b.display_name ?? '', 'ko')
    })
  }, [data.users, data.divisions, divisionId])

  const filteredUsers = useMemo(() => {
    const q = memberFilter.trim().toLowerCase()
    if (!q) return candidateUsers
    return candidateUsers.filter(u =>
      (u.display_name ?? '').toLowerCase().includes(q) ||
      u.email.toLowerCase().includes(q),
    )
  }, [candidateUsers, memberFilter])

  const toggleEmail = (email: string) => {
    setSelectedEmails(prev => prev.includes(email) ? prev.filter(e => e !== email) : [...prev, email])
  }

  const handleSubmit = async () => {
    setError(null)
    const aliases = Array.from(new Set(
      aliasText.split(/[,\n]/).map(s => s.trim()).filter(Boolean),
    ))
    if (!label.trim()) return setError('label은 필수')
    if (aliases.length === 0) return setError('alias 패턴 1개 이상 필요')
    if (selectedEmails.length === 0) return setError('멤버 1명 이상 선택 필요')

    setSaving(true)
    try {
      const body = {
        label: label.trim(),
        ...(isCreate
          ? { divisionId, teamId: teamId === COMMON_TEAM ? null : teamId, isActive }
          : { teamId: teamId === COMMON_TEAM ? null : teamId, isActive }),
        aliasPatterns: aliases,
        memberEmails: selectedEmails,
      }
      const url = isCreate ? '/api/admin/tags' : `/api/admin/tags/${tag!.id}`
      const method = isCreate ? 'POST' : 'PATCH'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        cache: 'no-store',
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`)
      onSaved(j.tag, isCreate)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-3" onClick={onClose}>
      <div className="bg-surface rounded-[10px] shadow-xl max-w-2xl w-full max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <h2 className="text-base font-semibold text-text-primary">
            {isCreate ? '새 태그 추가' : `태그 편집 — ${tag?.label}`}
          </h2>
          <button type="button" onClick={onClose} className="text-text-secondary hover:text-text-primary" aria-label="닫기">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {/* 본부 (admin만 변경 가능) */}
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">본부</label>
            {lockedDivision ? (
              <div className="h-10 px-3 flex items-center text-sm rounded-[10px] border border-border bg-surface-muted text-text-secondary">
                {data.divisions.find(d => d.id === divisionId)?.name ?? '-'}
              </div>
            ) : (
              <CustomDropdown
                value={divisionId}
                onChange={(v) => { setDivisionId(v); setTeamId(COMMON_TEAM) }}
                options={data.divisions.map(d => ({ value: d.id, label: d.name }))}
                disabled={!isCreate}  // 생성 후엔 본부 이동 막음 (재생성 권장)
              />
            )}
          </div>

          {/* 팀 (team leader는 변경 불가) */}
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">팀</label>
            {lockedTeam ? (
              <div className="h-10 px-3 flex items-center text-sm rounded-[10px] border border-border bg-surface-muted text-text-secondary">
                {teamOptions.find(o => o.value === teamId)?.label ?? '-'}
              </div>
            ) : (
              <CustomDropdown
                value={teamId}
                onChange={setTeamId}
                options={teamOptions}
              />
            )}
            <div className="text-[10px] text-text-muted mt-1">
              "본부 공용"이면 그 본부의 모든 캘린더에 alias 적용. 팀을 지정하면 그 팀 캘린더에서만 매칭.
            </div>
          </div>

          {/* label */}
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">레이블 (사람이 보는 이름)</label>
            <input
              type="text"
              value={label}
              onChange={e => setLabel(e.target.value)}
              placeholder="예: 마이스팀 A파트(승현팟)"
              className="block w-full h-10 px-3 rounded-[10px] border border-border-strong bg-surface text-sm focus:outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20"
            />
          </div>

          {/* alias_patterns */}
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">
              Alias 패턴 (콤마 또는 줄바꿈으로 구분)
            </label>
            <textarea
              value={aliasText}
              onChange={e => setAliasText(e.target.value)}
              placeholder="A파트, A팟, 승현팟, 승현파트"
              rows={3}
              className="block w-full px-3 py-2 rounded-[10px] border border-border-strong bg-surface text-sm focus:outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20"
            />
            <div className="text-[10px] text-text-muted mt-1">
              캘린더 제목 대괄호 안 토큰과 case-sensitive 정확 일치 매칭 ("[A파트]" 같은 패턴)
            </div>
          </div>

          {/* member_emails */}
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">
              멤버 ({selectedEmails.length}명 선택)
            </label>
            {selectedEmails.length > 0 && (
              <div className="flex flex-wrap gap-1 mb-2 p-2 rounded-[10px] border border-border bg-surface-muted">
                {selectedEmails.map(em => {
                  const u = data.users.find(x => x.email.toLowerCase() === em.toLowerCase())
                  return (
                    <span key={em} className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded bg-primary-50 text-primary-700 border border-primary-200">
                      {u?.display_name ?? em}
                      <button
                        type="button"
                        onClick={() => toggleEmail(em)}
                        className="hover:text-primary-900"
                        aria-label="제거"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  )
                })}
              </div>
            )}
            <input
              type="text"
              value={memberFilter}
              onChange={e => setMemberFilter(e.target.value)}
              placeholder="이름·이메일 검색"
              className="block w-full h-9 px-3 rounded-[10px] border border-border-strong bg-surface text-sm focus:outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20"
            />
            <div className="mt-2 max-h-56 overflow-y-auto rounded-[10px] border border-border">
              {filteredUsers.slice(0, 50).map(u => {
                const checked = selectedEmails.includes(u.email)
                return (
                  <button
                    key={u.email}
                    type="button"
                    onClick={() => toggleEmail(u.email)}
                    className={`w-full px-3 py-1.5 text-left text-sm flex items-center gap-2 border-b border-border last:border-b-0 hover:bg-primary-50 ${checked ? 'bg-primary-50/50' : 'bg-surface'}`}
                  >
                    <span className={`inline-flex items-center justify-center w-4 h-4 rounded border ${checked ? 'bg-primary-600 border-primary-600 text-white' : 'border-border-strong bg-surface'}`}>
                      {checked && <Check className="h-3 w-3" />}
                    </span>
                    <span className="font-medium text-text-primary">{u.display_name}</span>
                    <span className="text-text-muted text-xs">{u.email}</span>
                    {u.team && <span className="ml-auto text-[10px] text-text-muted">{u.team}</span>}
                  </button>
                )
              })}
              {filteredUsers.length > 50 && (
                <div className="px-3 py-2 text-[11px] text-text-muted">상위 50명만 표시 — 검색으로 좁히세요</div>
              )}
            </div>
          </div>

          {/* is_active */}
          <div className="flex items-center gap-2">
            <input
              id="tag-is-active"
              type="checkbox"
              checked={isActive}
              onChange={e => setIsActive(e.target.checked)}
              className="h-4 w-4 rounded border-border-strong"
            />
            <label htmlFor="tag-is-active" className="text-sm text-text-primary">활성</label>
          </div>

          {error && (
            <div className="rounded-[10px] border border-danger-border bg-danger-bg p-3 text-sm text-danger-text">
              {error}
            </div>
          )}
        </div>

        <div className="px-4 py-3 border-t border-border flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="h-9 px-3 text-sm rounded-[10px] border border-border-strong bg-surface text-text-secondary hover:bg-surface-muted disabled:opacity-50"
          >
            취소
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={saving}
            className="h-9 px-4 text-sm font-medium rounded-[10px] bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50 inline-flex items-center gap-1"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {isCreate ? '추가' : '저장'}
          </button>
        </div>
      </div>
    </div>
  )
}
