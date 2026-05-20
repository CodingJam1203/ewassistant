/**
 * /api/admin/tags/[id]
 *
 * PATCH  — tag 수정 (scope 안에서만)
 * DELETE — tag 삭제 (scope 안에서만)
 *
 * 권한: admin OR leader (requireLeaderOrAdmin), scope 검증은 대상 row의 division/team과 본인 scope 비교
 */

import { NextResponse } from 'next/server'
import { requireLeaderOrAdmin } from '@/lib/admin-check'
import { createAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface ResolvedScope {
  kind: 'admin' | 'division' | 'team'
  divisionId: string | null
  teamId: string | null
}

async function resolveScope(
  adminClient: ReturnType<typeof createAdminClient>,
  scope: { kind: 'admin' | 'division' | 'team' | null; division: string | null; team: string | null },
): Promise<ResolvedScope | null> {
  if (scope.kind === null) return null
  if (scope.kind === 'admin') return { kind: 'admin', divisionId: null, teamId: null }
  if (!scope.division) return null
  const { data: div } = await adminClient
    .from('org_divisions')
    .select('id')
    .eq('name', scope.division)
    .maybeSingle()
  if (!div) return null
  if (scope.kind === 'division') return { kind: 'division', divisionId: div.id, teamId: null }
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

function isWritable(
  row: { division_id: string; team_id: string | null },
  scope: ResolvedScope,
): boolean {
  if (scope.kind === 'admin') return true
  if (row.division_id !== scope.divisionId) return false
  if (scope.kind === 'division') return true
  return row.team_id === scope.teamId  // team leader는 본인 팀 row만
}

interface PatchBody {
  label?: string
  teamId?: string | null
  aliasPatterns?: string[]
  memberEmails?: string[]
  isActive?: boolean
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireLeaderOrAdmin()
  if (!auth) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await context.params
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const admin = createAdminClient()
  const resolved = await resolveScope(admin, auth.scope)
  if (!resolved) return NextResponse.json({ error: 'Forbidden — scope unresolved' }, { status: 403 })

  const { data: existing } = await admin
    .from('org_tags')
    .select('id, division_id, team_id')
    .eq('id', id)
    .maybeSingle()
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!isWritable(existing, resolved)) {
    return NextResponse.json({ error: 'Forbidden — scope mismatch' }, { status: 403 })
  }

  const body: PatchBody = await request.json().catch(() => ({}))
  const updates: Record<string, unknown> = {}

  if (typeof body.label === 'string') {
    const v = body.label.trim()
    if (!v) return NextResponse.json({ error: 'label cannot be empty' }, { status: 400 })
    updates.label = v
  }
  if ('teamId' in body) {
    const v = body.teamId ? body.teamId.trim() : null
    // team leader는 본인 팀에서 벗어나 다른 team_id로 이동 불가
    if (resolved.kind === 'team' && v !== resolved.teamId) {
      return NextResponse.json({ error: 'team leader는 team_id 이동 불가' }, { status: 403 })
    }
    updates.team_id = v
  }
  if (Array.isArray(body.aliasPatterns)) {
    const arr = Array.from(new Set(body.aliasPatterns.map(s => (s ?? '').trim()).filter(Boolean)))
    if (arr.length === 0) return NextResponse.json({ error: 'alias_patterns 1개 이상 필요' }, { status: 400 })
    updates.alias_patterns = arr
  }
  if (Array.isArray(body.memberEmails)) {
    const arr = Array.from(new Set(body.memberEmails.map(s => (s ?? '').toLowerCase().trim()).filter(Boolean)))
    if (arr.length === 0) return NextResponse.json({ error: 'member_emails 1개 이상 필요' }, { status: 400 })
    updates.member_emails = arr
  }
  if (typeof body.isActive === 'boolean') updates.is_active = body.isActive

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'no fields to update' }, { status: 400 })
  }

  const { data, error } = await admin
    .from('org_tags')
    .update(updates)
    .eq('id', id)
    .select('id, division_id, team_id, label, alias_patterns, member_emails, is_active, updated_at')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ tag: { ...data, canEdit: true } })
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireLeaderOrAdmin()
  if (!auth) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await context.params
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const admin = createAdminClient()
  const resolved = await resolveScope(admin, auth.scope)
  if (!resolved) return NextResponse.json({ error: 'Forbidden — scope unresolved' }, { status: 403 })

  const { data: existing } = await admin
    .from('org_tags')
    .select('id, division_id, team_id')
    .eq('id', id)
    .maybeSingle()
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!isWritable(existing, resolved)) {
    return NextResponse.json({ error: 'Forbidden — scope mismatch' }, { status: 403 })
  }

  const { error } = await admin.from('org_tags').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
