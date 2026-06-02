/**
 * v1.73 Phase 2 — 리더 관리 뷰 API.
 *
 * GET  /api/leader-reviews?from=YYYY-MM-DD&to=YYYY-MM-DD&division=&team=
 *   - 리더 권한 범위 내 사용자의 work_logs + leader_review LEFT join 결과
 *   - 응답: { rows: [...], reviewableTeams: [{division, team}] (use_leader_review=true 팀) }
 *
 * PATCH /api/leader-reviews
 *   - body: { work_log_id, status: 'checked'|'missing'|'wrong'|null, note?: string|null }
 *   - status=null이면 review row 삭제, 그 외 upsert (UNIQUE work_log_id 활용)
 *   - 권한: 대상 work_log의 user가 본인 권한 범위 안인지 검증
 *
 * 권한:
 *   - admin: 전체
 *   - leader (team): 본인 팀 멤버 (본부 직속이면 notify_team으로 흡수)
 *   - leader (division): 본부 멤버
 */

import { NextResponse } from 'next/server'
import { requireLeaderOrAdmin } from '@/lib/admin-check'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveRoutingTeam } from '@/lib/org'

export const maxDuration = 30

type ReviewStatus = 'checked' | 'missing' | 'wrong'

interface UserProfileRow {
  email: string
  display_name: string | null
  division: string | null
  team: string | null
  notify_team: string | null
  is_active: boolean
}

// ─── 권한 범위 → 대상 user_email 목록 ──────────────────────────────────────────
async function loadInScopeProfiles(
  adminClient: ReturnType<typeof createAdminClient>,
  scope: { kind: 'admin' | 'team' | 'division' | null; division: string | null; team: string | null },
): Promise<UserProfileRow[]> {
  const base = adminClient
    .from('user_profiles')
    .select('email, display_name, division, team, notify_team, is_active')
    .eq('is_active', true)

  if (scope.kind === 'admin') {
    const { data } = await base
    return (data ?? []) as UserProfileRow[]
  }
  if (scope.kind === 'division') {
    const { data } = await base.eq('division', scope.division)
    return (data ?? []) as UserProfileRow[]
  }
  if (scope.kind === 'team') {
    // 일반 팀 멤버 + 본부 직속(team NULL + notify_team=scope.team) 포함
    const { data } = await base.eq('division', scope.division)
    const filtered = (data ?? []).filter((p) => {
      const eff = resolveRoutingTeam(p.team ?? null, p.notify_team ?? null)
      return eff === scope.team
    })
    return filtered as UserProfileRow[]
  }
  return []
}

// ─── 리더 관리 ON 팀 목록 (UI tab 표시 가드용) ─────────────────────────────────
async function loadReviewableTeams(
  adminClient: ReturnType<typeof createAdminClient>,
): Promise<Array<{ division: string; team: string }>> {
  const { data } = await adminClient
    .from('org_teams')
    .select('name, division_id, use_leader_review, org_divisions!inner(name)')
    .eq('use_leader_review', true)
  type Row = { name: string; org_divisions: { name: string } | null }
  return ((data ?? []) as unknown as Row[]).map((t) => ({
    division: t.org_divisions?.name ?? '',
    team: t.name,
  })).filter((t) => t.division && t.team)
}

// ─── GET ───────────────────────────────────────────────────────────────────────
export async function GET(request: Request) {
  const auth = await requireLeaderOrAdmin()
  if (!auth) {
    return NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 })
  }
  const { scope } = auth

  const url = new URL(request.url)
  const from = (url.searchParams.get('from') ?? '').trim()
  const to = (url.searchParams.get('to') ?? '').trim()
  const divisionFilter = (url.searchParams.get('division') ?? '').trim()
  const teamFilter = (url.searchParams.get('team') ?? '').trim()

  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return NextResponse.json({ error: 'from/to 형식 오류 (YYYY-MM-DD)' }, { status: 400 })
  }

  const adminClient = createAdminClient()

  // 1) 권한 범위 사용자들 (use_leader_review=true 팀 한정)
  const reviewableTeams = await loadReviewableTeams(adminClient)
  const reviewableSet = new Set(reviewableTeams.map((t) => `${t.division}::${t.team}`))

  const allProfiles = await loadInScopeProfiles(adminClient, scope)
  // 토글 ON 팀 멤버만 (본부 직속은 notify_team 기준)
  const profiles = allProfiles.filter((p) => {
    const eff = resolveRoutingTeam(p.team ?? null, p.notify_team ?? null)
    if (!p.division || !eff) return false
    return reviewableSet.has(`${p.division}::${eff}`)
  })
  // URL 추가 필터 (UI 본부/팀 드롭다운)
  const filteredProfiles = profiles.filter((p) => {
    if (divisionFilter && p.division !== divisionFilter) return false
    if (teamFilter) {
      const eff = resolveRoutingTeam(p.team ?? null, p.notify_team ?? null)
      if (eff !== teamFilter) return false
    }
    return true
  })

  if (filteredProfiles.length === 0) {
    return NextResponse.json({ rows: [], reviewableTeams })
  }

  const emails = filteredProfiles.map((p) => p.email)

  // 2) work_logs 조회 (날짜 범위)
  const { data: workLogs } = await adminClient
    .from('work_logs')
    .select(
      'id, user_email, leave_date, planned_start_time, planned_end_time, actual_start_time, actual_end_time, start_time, end_time, work_location, work_content',
    )
    .in('user_email', emails)
    .gte('leave_date', from)
    .lte('leave_date', to)
    .eq('is_deleted', false)
    .order('leave_date', { ascending: false })

  const wlRows = workLogs ?? []
  if (wlRows.length === 0) {
    return NextResponse.json({ rows: [], reviewableTeams })
  }

  // 3) leader_reviews 조회
  const workLogIds = wlRows.map((w) => w.id as string)
  const { data: reviews } = await adminClient
    .from('work_log_leader_reviews')
    .select('work_log_id, status, note, reviewer_email, reviewed_at')
    .in('work_log_id', workLogIds)
  const reviewByWlId = new Map<string, { status: ReviewStatus; note: string | null; reviewer_email: string; reviewed_at: string }>()
  for (const r of reviews ?? []) {
    reviewByWlId.set(r.work_log_id as string, {
      status: r.status as ReviewStatus,
      note: r.note as string | null,
      reviewer_email: r.reviewer_email as string,
      reviewed_at: r.reviewed_at as string,
    })
  }

  // 4) profile by email
  const profileByEmail = new Map(filteredProfiles.map((p) => [p.email, p]))

  // 5) 응답 빌드 — 한 row = 한 work_log
  const rows = wlRows.map((w) => {
    const p = profileByEmail.get(w.user_email as string)
    const r = reviewByWlId.get(w.id as string)
    return {
      work_log_id: w.id as string,
      user_email: w.user_email as string,
      display_name: p?.display_name ?? null,
      division: p?.division ?? null,
      team: p?.team ?? null,
      effective_team: resolveRoutingTeam(p?.team ?? null, p?.notify_team ?? null),
      target_date: w.leave_date as string,
      planned_start_time: (w.planned_start_time as string | null) ?? null,
      planned_end_time: (w.planned_end_time as string | null) ?? null,
      actual_start_time: (w.actual_start_time as string | null) ?? null,
      actual_end_time: (w.actual_end_time as string | null) ?? null,
      start_time: (w.start_time as string | null) ?? null,
      end_time: (w.end_time as string | null) ?? null,
      work_location: (w.work_location as string | null) ?? null,
      work_content: (w.work_content as string | null) ?? null,
      review_status: r?.status ?? null,
      review_note: r?.note ?? null,
      reviewer_email: r?.reviewer_email ?? null,
      reviewed_at: r?.reviewed_at ?? null,
    }
  })

  return NextResponse.json({ rows, reviewableTeams })
}

// ─── PATCH ─────────────────────────────────────────────────────────────────────
export async function PATCH(request: Request) {
  const auth = await requireLeaderOrAdmin()
  if (!auth) {
    return NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 })
  }
  const { user: reviewer, scope } = auth

  let body: { work_log_id?: string; status?: string | null; note?: string | null } | null = null
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const workLogId = (body?.work_log_id ?? '').trim()
  const rawStatus = body?.status
  const note = typeof body?.note === 'string' ? body.note.trim() || null : null

  if (!workLogId) {
    return NextResponse.json({ error: 'work_log_id 누락' }, { status: 400 })
  }
  const status: ReviewStatus | null =
    rawStatus === 'checked' || rawStatus === 'missing' || rawStatus === 'wrong'
      ? rawStatus
      : rawStatus === null || rawStatus === undefined || rawStatus === ''
        ? null
        : 'INVALID' as unknown as ReviewStatus

  if (status === ('INVALID' as unknown as ReviewStatus)) {
    return NextResponse.json({ error: 'status 값 오류 (checked/missing/wrong/null)' }, { status: 400 })
  }

  const adminClient = createAdminClient()

  // 1) 대상 work_log + user profile 권한 검증
  const { data: wl } = await adminClient
    .from('work_logs')
    .select('id, user_email, leave_date')
    .eq('id', workLogId)
    .eq('is_deleted', false)
    .maybeSingle()
  if (!wl) {
    return NextResponse.json({ error: '대상 보고를 찾을 수 없습니다.' }, { status: 404 })
  }
  const { data: targetProfile } = await adminClient
    .from('user_profiles')
    .select('email, division, team, notify_team')
    .eq('email', wl.user_email)
    .maybeSingle()
  if (!targetProfile) {
    return NextResponse.json({ error: '대상자 프로필 없음' }, { status: 404 })
  }
  const targetDivision = (targetProfile.division ?? '').trim()
  const targetEffectiveTeam = resolveRoutingTeam(
    targetProfile.team ?? null,
    targetProfile.notify_team ?? null,
  )
  if (scope.kind === 'team') {
    if (targetEffectiveTeam !== scope.team) {
      return NextResponse.json({ error: '본인 팀 멤버만 수정 가능합니다.' }, { status: 403 })
    }
  } else if (scope.kind === 'division') {
    if (targetDivision !== scope.division) {
      return NextResponse.json({ error: '본인 본부 멤버만 수정 가능합니다.' }, { status: 403 })
    }
  }

  // 2) upsert or delete
  if (status === null) {
    const { error } = await adminClient
      .from('work_log_leader_reviews')
      .delete()
      .eq('work_log_id', workLogId)
    if (error) {
      console.error('[leader-reviews PATCH] delete error:', error)
      return NextResponse.json({ error: '삭제 실패' }, { status: 500 })
    }
    return NextResponse.json({ ok: true, status: null })
  }

  const reviewerEmail = (reviewer?.email ?? '').toLowerCase()
  const { error: upsertErr } = await adminClient
    .from('work_log_leader_reviews')
    .upsert(
      {
        work_log_id: workLogId,
        reviewer_email: reviewerEmail,
        status,
        note,
        reviewed_at: new Date().toISOString(),
      },
      { onConflict: 'work_log_id' },
    )
  if (upsertErr) {
    console.error('[leader-reviews PATCH] upsert error:', upsertErr)
    return NextResponse.json({ error: '저장 실패' }, { status: 500 })
  }
  return NextResponse.json({ ok: true, status, note, reviewer_email: reviewerEmail })
}
