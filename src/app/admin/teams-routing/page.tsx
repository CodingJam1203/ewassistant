'use client'

/**
 * Teams 라우팅 관리 페이지 (관리자 전용)
 *
 * 기능:
 *   - 전체 라우팅 row 표 표시 (본부/팀/보고유형/teamId/channelId/messageId/active/메모)
 *   - 인라인 편집 (각 row 우측 "수정" 버튼 → 모달)
 *   - 새 row 추가
 *   - 활성/비활성 토글
 *   - 삭제 (확인 모달)
 *
 * /admin 페이지에서 이 경로로 링크.
 */

import { useEffect, useState, useMemo } from 'react'
import { Pencil, Trash2, Plus, RefreshCw, Save, X, AlertTriangle } from 'lucide-react'

interface RoutingRow {
  id: string
  department: string
  team_name: string
  report_type: '출근보고' | '퇴근보고'
  team_id: string
  channel_id: string
  /** v1.50: NULL 허용 (채널 새 메시지 방식 라우팅은 thread root 미사용) */
  message_id: string | null
  /** v1.50: 라우팅별 webhook URL. NULL이면 default MAKE_WEBHOOK_URL 사용. */
  webhook_url: string | null
  is_active: boolean
  notes: string | null
  created_at: string
  updated_at: string
}

type FormState = Omit<RoutingRow, 'id' | 'created_at' | 'updated_at'>

const EMPTY_FORM: FormState = {
  department: '',
  team_name: '',
  report_type: '출근보고',
  team_id: '',
  channel_id: '',
  message_id: '',
  webhook_url: '',
  is_active: true,
  notes: null,
}

/**
 * v1.50: Webhook 분기 옵션.
 *
 * 보안 이력 (v1.53 hotfix, 2026-05-27):
 *   - 종전 preset에 Power Automate trigger URL을 직접 박아 두었으나 commit으로 노출되어
 *     GitGuardian에 감지됨. trigger URL은 `sig=` HMAC 서명을 포함하므로 노출되면 누구든
 *     워크플로우를 호출 가능. 따라서 코드에서 secret을 제거하고 admin이 매번 직접 입력하는
 *     방식으로 전환. preset은 동작 분기 안내(thread reply / new message) 용도로만 유지.
 *   - 노출됐던 URL은 Power Automate에서 trigger를 재생성해 무효화해야 함.
 *
 * 빈 값(value='') = default(env MAKE_WEBHOOK_URL) 사용 — 회귀 0.
 */
const WEBHOOK_PRESETS: Array<{ value: string; label: string; hint: string }> = [
  {
    value: '',
    label: 'default (Make / thread reply)',
    hint: 'env MAKE_WEBHOOK_URL 사용. Anchor Message ID 필요.',
  },
]
const WEBHOOK_CUSTOM_KEY = '__custom__'

interface OrgTeam { id: string; division_id: string; name: string }
interface OrgDivision { id: string; name: string; teams: OrgTeam[] }

export default function TeamsRoutingAdminPage() {
  const [rows, setRows] = useState<RoutingRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editingRow, setEditingRow] = useState<RoutingRow | null>(null)
  const [creating, setCreating] = useState(false)

  const fetchRows = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/teams-routing')
      const json = await res.json()
      if (!res.ok) {
        setError(json.error ?? '조회 실패')
        return
      }
      setRows(json.rows ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : '네트워크 오류')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchRows() }, [])

  const grouped = useMemo(() => {
    const map = new Map<string, RoutingRow[]>()
    for (const r of rows) {
      const key = `${r.department}__${r.report_type}`
      const arr = map.get(key) ?? []
      arr.push(r)
      map.set(key, arr)
    }
    return map
  }, [rows])

  const handleDelete = async (row: RoutingRow) => {
    if (!confirm(
      `정말 삭제하시겠습니까?\n\n` +
      `${row.department} / ${row.team_name} / ${row.report_type}`
    )) return
    try {
      const res = await fetch(`/api/admin/teams-routing/${row.id}`, { method: 'DELETE' })
      const json = await res.json()
      if (!res.ok) {
        alert('삭제 실패: ' + (json.error ?? ''))
        return
      }
      setRows(prev => prev.filter(r => r.id !== row.id))
    } catch (err) {
      alert('오류: ' + (err instanceof Error ? err.message : ''))
    }
  }

  const handleToggleActive = async (row: RoutingRow) => {
    try {
      const res = await fetch(`/api/admin/teams-routing/${row.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: !row.is_active }),
      })
      const json = await res.json()
      if (!res.ok) {
        alert('변경 실패: ' + (json.error ?? ''))
        return
      }
      setRows(prev => prev.map(r => r.id === row.id ? json.row : r))
    } catch (err) {
      alert('오류: ' + (err instanceof Error ? err.message : ''))
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold text-text-primary">Teams 알림 라우팅 관리</h2>
          <p className="text-xs text-text-secondary mt-1">
            본부/팀/보고유형 별로 Teams 채널 anchor 메시지를 매핑합니다. 변경은 60초 캐시 후 반영됩니다.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchRows}
            className="inline-flex items-center gap-1 text-sm text-primary-600 hover:text-primary-700 px-3 py-1.5 border border-primary-200 rounded"
          >
            <RefreshCw className="h-4 w-4" />
            새로고침
          </button>
          <button
            onClick={() => setCreating(true)}
            className="inline-flex items-center gap-1 text-sm text-white bg-primary-600 hover:bg-primary-700 px-3 py-1.5 rounded"
          >
            <Plus className="h-4 w-4" />
            새 라우팅 추가
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-md bg-danger-bg border border-danger-border p-3 text-sm text-danger-text flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="space-y-2">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-12 bg-surface-muted rounded animate-pulse" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="bg-surface rounded-lg border border-border p-12 text-center text-sm text-text-secondary">
          등록된 라우팅이 없습니다. <span className="text-primary-600">"새 라우팅 추가"</span> 버튼으로 시작하세요.
        </div>
      ) : (
        <div className="bg-surface rounded-lg border border-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-surface-muted">
                <tr>
                  <Th>본부</Th>
                  <Th>팀</Th>
                  <Th>보고유형</Th>
                  <Th>Team ID</Th>
                  <Th>Channel ID</Th>
                  <Th>Message ID</Th>
                  <Th className="text-center">활성</Th>
                  <Th>메모</Th>
                  <Th className="text-center">작업</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map(row => (
                  <tr key={row.id} className={`hover:bg-surface-muted ${!row.is_active ? 'opacity-50' : ''}`}>
                    <Td>{row.department}</Td>
                    <Td>{row.team_name}</Td>
                    <Td>
                      <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${
                        row.report_type === '출근보고' ? 'bg-primary-50 text-primary-700' : 'bg-warning-bg text-warning-text'
                      }`}>
                        {row.report_type}
                      </span>
                    </Td>
                    <Td><Mono>{row.team_id}</Mono></Td>
                    <Td><Mono>{row.channel_id}</Mono></Td>
                    <Td><Mono>{row.message_id || <span className="text-text-muted">(빈 값 — webhook 방식)</span>}</Mono></Td>
                    <Td className="text-center">
                      <button
                        onClick={() => handleToggleActive(row)}
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium transition-colors ${
                          row.is_active
                            ? 'bg-success-bg text-success-text border border-success-border hover:bg-success-bg/60'
                            : 'bg-surface-muted text-text-secondary border border-border hover:bg-border'
                        }`}
                      >
                        {row.is_active ? '활성' : '비활성'}
                      </button>
                    </Td>
                    <Td>
                      <span className="text-xs text-text-secondary">{row.notes || '-'}</span>
                    </Td>
                    <Td className="text-center">
                      <div className="flex items-center justify-center gap-2">
                        <button
                          onClick={() => setEditingRow(row)}
                          className="text-text-muted hover:text-primary-600"
                          title="수정"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => handleDelete(row)}
                          className="text-text-muted hover:text-danger-text"
                          title="삭제"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-3 border-t border-border text-xs text-text-secondary">
            총 <span className="font-semibold text-text-primary">{rows.length}</span>건
            {' · '}
            본부 {new Set(rows.map(r => r.department)).size}개
            {' · '}
            활성 {rows.filter(r => r.is_active).length} / 비활성 {rows.filter(r => !r.is_active).length}
          </div>
        </div>
      )}

      {/* 편집/생성 모달 */}
      {(editingRow || creating) && (
        <RoutingFormModal
          row={editingRow}
          onClose={() => {
            setEditingRow(null)
            setCreating(false)
          }}
          onSaved={(saved) => {
            if (editingRow) {
              setRows(prev => prev.map(r => r.id === saved.id ? saved : r))
            } else {
              setRows(prev => [...prev, saved])
            }
            setEditingRow(null)
            setCreating(false)
          }}
        />
      )}

      {/* 도움말 */}
      <details className="bg-primary-50 rounded-lg border border-primary-200 p-3 text-xs text-text-primary">
        <summary className="font-medium text-primary-700 cursor-pointer">
          📘 messageId / channelId 어디서 가져오나요?
        </summary>
        <div className="mt-2 space-y-1 leading-relaxed">
          <p>1. Make.com에서 새 Teams Channel에 anchor 메시지 1건 발송 (예: "출근보고 시작합니다 — 회신 thread")</p>
          <p>2. Teams 웹/앱에서 해당 메시지 우클릭 → <strong>링크 복사</strong></p>
          <p>3. 복사한 URL에서:</p>
          <p className="ml-4">
            <code className="bg-surface px-1 rounded">
              https://teams.microsoft.com/l/message/&lt;channelId&gt;/&lt;messageId&gt;?...&groupId=&lt;teamId&gt;
            </code>
          </p>
          <p className="ml-4">groupId → Team ID, channelId의 19:xxx@thread.tacv2 → Channel ID, 끝의 숫자 → Message ID</p>
          <p>4. 위에 매핑해서 "새 라우팅 추가" — 같은 본부/팀에 출근/퇴근 각 1건씩</p>
        </div>
      </details>
    </div>
  )
}

// ─── 편집/생성 모달 ──────────────────────────────────────────────────────────

function RoutingFormModal({
  row, onClose, onSaved,
}: {
  row: RoutingRow | null
  onClose: () => void
  onSaved: (saved: RoutingRow) => void
}) {
  const isEdit = !!row
  const [form, setForm] = useState<FormState>(
    row
      ? {
          department: row.department,
          team_name: row.team_name,
          report_type: row.report_type,
          team_id: row.team_id,
          channel_id: row.channel_id,
          message_id: row.message_id ?? '',
          webhook_url: row.webhook_url ?? '',
          is_active: row.is_active,
          notes: row.notes,
        }
      : EMPTY_FORM
  )
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // v1.50: 본부/팀 드롭다운 — /api/org에서 가져옴.
  const [org, setOrg] = useState<OrgDivision[]>([])
  useEffect(() => {
    fetch('/api/org').then(r => r.ok ? r.json() : []).then(setOrg).catch(() => {})
  }, [])
  const availableTeams = useMemo(
    () => org.find(d => d.name === form.department)?.teams ?? [],
    [org, form.department],
  )

  // v1.50: webhook preset 선택 상태. 'custom'이면 직접 입력 mode.
  const initialPresetKey = (() => {
    const matched = WEBHOOK_PRESETS.find(p => p.value === (row?.webhook_url ?? ''))
    return matched ? matched.value : WEBHOOK_CUSTOM_KEY
  })()
  const [webhookPresetKey, setWebhookPresetKey] = useState<string>(initialPresetKey)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setErr(null)
    try {
      const url = isEdit ? `/api/admin/teams-routing/${row!.id}` : '/api/admin/teams-routing'
      const method = isEdit ? 'PATCH' : 'POST'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const json = await res.json()
      if (!res.ok) {
        setErr(json.error ?? '저장 실패')
        return
      }
      onSaved(json.row)
    } catch (er) {
      setErr(er instanceof Error ? er.message : '오류')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 overflow-y-auto py-6"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl bg-surface rounded-lg shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <h3 className="text-lg font-semibold text-text-primary">
            {isEdit ? 'Teams 라우팅 수정' : '새 Teams 라우팅 추가'}
          </h3>
          <button onClick={onClose} className="text-text-muted hover:text-text-secondary">
            <X className="h-5 w-5" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label="본부 *">
              <select
                required
                value={form.department}
                onChange={e => setForm({ ...form, department: e.target.value, team_name: '' })}
                className={inputCls}
              >
                <option value="">선택…</option>
                {org.map(d => (
                  <option key={d.id} value={d.name}>{d.name}</option>
                ))}
              </select>
            </Field>
            <Field label="팀 *" hint={form.department ? undefined : '본부 먼저 선택'}>
              <select
                required
                value={form.team_name}
                onChange={e => setForm({ ...form, team_name: e.target.value })}
                disabled={!form.department || availableTeams.length === 0}
                className={inputCls}
              >
                <option value="">{form.department && availableTeams.length === 0 ? '(이 본부에 팀 없음)' : '선택…'}</option>
                {availableTeams.map(t => (
                  <option key={t.id} value={t.name}>{t.name}</option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="보고유형 *">
            <select
              value={form.report_type}
              onChange={e => setForm({ ...form, report_type: e.target.value as '출근보고' | '퇴근보고' })}
              className={inputCls}
            >
              <option value="출근보고">출근보고</option>
              <option value="퇴근보고">퇴근보고</option>
            </select>
          </Field>
          <Field label="Team ID *" hint="Microsoft Teams 팀 그룹 GUID (groupId=)">
            <input
              type="text"
              required
              value={form.team_id}
              onChange={e => setForm({ ...form, team_id: e.target.value })}
              placeholder="c2dcd308-5ef9-4c2f-a038-2db41410180e"
              className={`${inputCls} font-mono text-xs`}
            />
          </Field>
          <Field label="Channel ID *" hint="19:xxx@thread.tacv2">
            <input
              type="text"
              required
              value={form.channel_id}
              onChange={e => setForm({ ...form, channel_id: e.target.value })}
              placeholder="19:d70449b5ffec46338662a94f06d1e9be@thread.tacv2"
              className={`${inputCls} font-mono text-xs`}
            />
          </Field>
          <Field label="Anchor Message ID" hint="Thread reply 방식 라우팅만 필요. 채널 새 메시지(Power Automate) 방식이면 비워두세요. (v1.50)">
            <input
              type="text"
              value={form.message_id ?? ''}
              onChange={e => setForm({ ...form, message_id: e.target.value })}
              placeholder="1767335177747 (또는 빈 값)"
              className={`${inputCls} font-mono text-xs`}
            />
          </Field>
          <Field
            label="Webhook URL (v1.50)"
            hint={
              WEBHOOK_PRESETS.find(p => p.value === webhookPresetKey)?.hint
              ?? '직접 입력 mode — 아래에 URL을 직접 붙여넣기'
            }
          >
            <select
              value={webhookPresetKey}
              onChange={e => {
                const k = e.target.value
                setWebhookPresetKey(k)
                if (k !== WEBHOOK_CUSTOM_KEY) {
                  setForm({ ...form, webhook_url: k })
                }
              }}
              className={inputCls}
            >
              {WEBHOOK_PRESETS.map(p => (
                <option key={p.value || '__default__'} value={p.value}>{p.label}</option>
              ))}
              <option value={WEBHOOK_CUSTOM_KEY}>직접 입력…</option>
            </select>
            {webhookPresetKey === WEBHOOK_CUSTOM_KEY && (
              <input
                type="text"
                value={form.webhook_url ?? ''}
                onChange={e => setForm({ ...form, webhook_url: e.target.value })}
                placeholder="https://...powerplatform.com/.../triggers/manual/paths/invoke?..."
                className={`${inputCls} font-mono text-[11px] mt-2`}
              />
            )}
          </Field>
          <Field label="메모 (선택)">
            <input
              type="text"
              value={form.notes ?? ''}
              onChange={e => setForm({ ...form, notes: e.target.value || null })}
              placeholder="예: 2026-05 신설"
              className={inputCls}
              maxLength={500}
            />
          </Field>
          <Field>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.is_active}
                onChange={e => setForm({ ...form, is_active: e.target.checked })}
                className="h-4 w-4 rounded border-border-strong text-primary-600 focus:ring-blue-500"
              />
              활성 (체크 해제 시 해당 라우팅으로 알림 안 감)
            </label>
          </Field>

          {err && (
            <div className="rounded bg-danger-bg border border-danger-border p-2 text-xs text-danger-text">
              {err}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2 border-t">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-1.5 text-sm text-text-primary bg-surface border border-border-strong rounded hover:bg-surface-muted"
            >
              취소
            </button>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-1 px-4 py-1.5 text-sm text-white bg-primary-600 hover:bg-primary-700 rounded disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              {saving ? '저장 중...' : isEdit ? '수정 저장' : '추가'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── 작은 부품들 ────────────────────────────────────────────────────────────

const inputCls =
  'mt-1 block w-full rounded-md border-border-strong shadow-sm focus:border-primary-500 focus:ring-primary-500 ' +
  'sm:text-sm px-3 py-1.5 border'

function Field({
  label, children, hint,
}: { label?: string; children: React.ReactNode; hint?: string }) {
  return (
    <div>
      {label && <label className="block text-xs font-medium text-text-primary">{label}</label>}
      {children}
      {hint && <p className="mt-1 text-xs text-text-muted">{hint}</p>}
    </div>
  )
}

function Th({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <th className={`px-3 py-2 text-left text-xs font-medium text-text-secondary uppercase tracking-wider whitespace-nowrap ${className}`}>
      {children}
    </th>
  )
}

function Td({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <td className={`px-3 py-2 text-text-primary whitespace-nowrap ${className}`}>{children}</td>
  )
}

function Mono({ children }: { children: React.ReactNode }) {
  return (
    <span className="font-mono text-xs text-text-secondary truncate max-w-[280px] inline-block align-middle"
          title={typeof children === 'string' ? children : ''}>
      {children}
    </span>
  )
}
