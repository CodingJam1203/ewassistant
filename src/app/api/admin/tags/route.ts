/**
 * /api/admin/tags
 *
 * GET  — 현재 사용자가 관리 가능한 org_tags 목록 + form용 lookup(divisions/teams/users) + myScope
 * POST — 새 tag 생성 (scope 안에서만)
 *
 * 권한: admin OR leader (requireLeaderOrAdmin)
 *   - admin: 모든 본부의 tag
 *   - leader(division): 본인 본부의 tag (팀별 + 본부 공용)
 *   - leader(team): 본인 팀의 tag + 본부 공용(read-only, 본인 division 한정)
 *
 * scope 매핑: user_profiles.division/team(텍스트) → org_divisions/org_teams.id 변환은 본 라우트에서.
 */

import { NextResponse } from 'next/server'
import { requireLeaderOrAdmin } from '@/lib/admin-check'
import { createAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

interface ResolvedScope {
  kind: 'admin' | 'division' | 'team'
  divisionId: string | null  // 본인 본부 (admin이면 null = 전체)
  teamId: string | null      // 본인 팀 (admin/division leader면 null)
}

/**
 * leader scope의 division/team 이름을 id로 변환.
 * admin은 변환 없이 kind=admin 반환.
 * 실패 시(이름 매칭 안 됨) null — 호출자가 403 처리.
 */
async function resolveScope(
  adminClient: ReturnType<typeof createAdminClient>,
  scope: { kind: 'admin' | 'division' | 'team' | null; division: string | null; team: string | null },
): Promise<ResolvedScope | null> {
  if (scope.kind === null) return null
  if (scope.kind === 'admin') {
    return { kind: 'admin', divisionId: null, teamId: null }
  }

  if (!scope.division) return null
  const { data: div } = await adminClient
    .from('org_divisions')
    .select('id')
    .eq('name', scope.division)
    .maybeSingle()
  if (!div) return null

  if (scope.kind === 'division') {
    return { kind: 'division', divisionId: div.id, teamId: null }
  }

  if (!scope.team) return null
  const { data: team } = await adminClient
    .from('org_teams')
    .select('id')
    .eq('division_id', div.id)
    .eq('name', scope.team)
    .maybeSingle()
  if (!team) return null

  return { kind: 'team', divisionId: div.id, teamId: team.id }
}

/** 어떤 org_tags row가 현재 scope에서 가시(read)인지 */
function isVisibleToScope(
  row: { division_id: string; team_id: string | null },
  scope: ResolvedScope,
): boolean {
  if (scope.kind === 'admin') return true
  if (row.division_id !== scope.divisionId) return false
  if (scope.kind === 'division') return true
  // team scope — 본인 팀 또는 본부 공용(team_id null)만
  return row.team_id === scope.teamId || row.team_id === null
}

/** 어떤 org_tags row가 현재 scope에서 편집(write) 가능인지 */
function isWritableToScope(
  row: { division_id: string; team_id: string | null },
  scope: ResolvedScope,
): boolean {
  if (scope.kind === 'admin') return true
  if (row.division_id !== scope.divisionId) return false
  if (scope.kind === 'division') return true
  // team leader — 본인 팀 row만 write. 본부 공용은 read-only.
  return row.team_id === scope.teamId
}

export async function GET() {
  const auth = await requireLeaderOrAdmin()
  if (!auth) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const admin = createAdminClient()
  const resolved = await resolveScope(admin, auth.scope)
  if (!resolved) return NextResponse.json({ error: 'Forbidden — scope unresolved' }, { status: 403 })

  // 1) tags — scope에 맞게 사전 필터 (admin은 전체, leader는 본인 division 한정)
  let tagsQuery = admin
    .from('org_tags')
    .select('id, division_id, team_id, label, alias_patterns, member_emails, is_active, updated_at')
    .order('division_id', { ascending: true })
    .order('team_id', { ascending: true, nullsFirst: true })
    .order('label', { ascending: true })
  if (resolved.kind !== 'admin' && resolved.divisionId) {
    tagsQuery = tagsQuery.eq('division_id', resolved.divisionId)
  }
  const { data: tagsRaw, error: tagsErr } = await tagsQuery
  if (tagsErr) return NextResponse.json({ error: tagsErr.message }, { status: 500 })

  // team scope면 본인 팀 + 본부 공용만 노출
  const tags = (tagsRaw ?? []).filter(t => isVisibleToScope(t, resolved)).map(t => ({
    ...t,
    canEdit: isWritableToScope(t, resolved),
  }))

  // 2) form lookup — divisions, teams, users.
  //    admin: 전체. leader: 본인 division만 표시 (다른 본부 선택 차단).
  const [divisionsRes, teamsRes, usersRes] = await Promise.all([
    resolved.kind === 'admin'
      ? admin.from('org_divisions').select('id, name, sort_order').order('sort_order')
      : admin.from('org_divisions').select('id, name, sort_order').eq('id', resolved.divisionId!),
    resolved.kind === 'admin'
      ? admin.from('org_teams').select('id, name, division_id, sort_order').order('sort_order')
      : admin.from('org_teams').select('id, name, division_id, sort_order').eq('division_id', resolved.divisionId!).order('sort_order'),
    admin.from('user_profiles').select('email, display_name, division, team').eq('is_active', true).order('display_name'),
  ])

  return NextResponse.json({
    tags,
    divisions: divisionsRes.data ?? [],
    teams: teamsRes.data ?? [],
    users: usersRes.data ?? [],
    myScope: resolved,
  })
}

interface CreateBody {
  divisionId?: string
  teamId?: string | null
  label?: string
  aliasPatterns?: string[]
  memberEmails?: string[]
  isActive?: boolean
}

export async function POST(request: Request) {
  const auth = await requireLeaderOrAdmin()
  if (!auth) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const admin = createAdminClient()
  const resolved = await resolveScope(admin, auth.scope)
  if (!resolved) return NextResponse.json({ error: 'Forbidden — scope unresolved' }, { status: 403 })

  const body: CreateBody = await request.json().catch(() => ({}))
  const label = (body.label ?? '').trim()
  const divisionId = (body.divisionId ?? '').trim()
  const teamId = body.teamId ? body.teamId.trim() : null
  const aliasPatterns = Array.isArray(body.aliasPatterns)
    ? Array.from(new Set(body.aliasPatterns.map(s => (s ?? '').trim()).filter(Boolean)))
    : []
  const memberEmails = Array.isArray(body.memberEmails)
    ? Array.from(new Set(body.memberEmails.map(s => (s ?? '').toLowerCase().trim()).filter(Boolean)))
    : []
  const isActive = body.isActive !== false  // default true

  if (!label) return NextResponse.json({ error: 'label required' }, { status: 400 })
  if (!divisionId) return NextResponse.json({ error: 'divisionId required' }, { status: 400 })
  if (aliasPatterns.length === 0) return NextResponse.json({ error: 'alias_patterns 1개 이상 필요' }, { status: 400 })
  if (memberEmails.length === 0) return NextResponse.json({ error: 'member_emails 1개 이상 필요' }, { status: 400 })

  // scope 검증 — leader는 본인 division 강제
  if (resolved.kind !== 'admin' && divisionId !== resolved.divisionId) {
    return NextResponse.json({ error: 'Forbidden — division 권한 없음' }, { status: 403 })
  }
  if (resolved.kind === 'team' && teamId !== resolved.teamId) {
    return NextResponse.json({ error: 'Forbidden — team 권한 없음 (본인 팀 tag만 생성 가능)' }, { status: 403 })
  }

  const { data, error } = await admin
    .from('org_tags')
    .insert({
      division_id: divisionId,
      team_id: teamId,
      label,
      alias_patterns: aliasPatterns,
      member_emails: memberEmails,
      is_active: isActive,
    })
    .select('id, division_id, team_id, label, alias_patterns, member_emails, is_active, updated_at')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ tag: { ...data, canEdit: true } })
}
