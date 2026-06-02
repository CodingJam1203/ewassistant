/**
 * v1.73 Phase 2 + v1.74 — 리더 관리 뷰 API (가상 review 지원).
 *
 * GET  /api/leader-reviews?from=YYYY-MM-DD&to=YYYY-MM-DD&division=&team=
 *   응답:
 *     {
 *       rows: [...]                  // work_log 있는 케이스 (테이블뷰)
 *       virtualReviews: [...]        // v1.74 — work_log 없는데 review 박힌 (가상)
 *       reviewableUsers: [...]       // v1.74 — 매트릭스 user 목록
 *       reviewableTeams: [...]
 *     }
 *
 * PATCH /api/leader-reviews
 *   body: { target_user_email, target_date, work_log_id?, status, note? }
 *       OR { work_log_id, status, note? }  (기존 호환 — work_log 조회해서 target 자동 추출)
 *   - status=null이면 row 삭제
 *   - upsert 키: (target_user_email, target_date) — UNIQUE
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
    const { data } = await base.eq('division', scope.division)
    const filtered = (data ?? []).filter((p) => {
      const eff = resolveRoutingTeam(p.team ?? null, p.notify_team ?? null)
      return eff === scope.team
    })
    return filtered as UserProfileRow[]
  }
  return []
}

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

  const reviewableTeams = await loadReviewableTeams(adminClient)
  const reviewableSet = new Set(reviewableTeams.map((t) => `${t.division}::${t.team}`))

  const allProfiles = await loadInScopeProfiles(adminClient, scope)
  const profiles = allProfiles.filter((p) => {
    const eff = resolveRoutingTeam(p.team ?? null, p.notify_team ?? null)
    if (!p.division || !eff) return false
    return reviewableSet.has(`${p.division}::${eff}`)
  })
  const filteredProfiles = profiles.filter((p) => {
    if (divisionFilter && p.division !== divisionFilter) return false
    if (teamFilter) {
      const eff = resolveRoutingTeam(p.team ?? null, p.notify_team ?? null)
      if (eff !== teamFilter) return false
    }
    return true
  })

  // v1.74 — 매트릭스용 user 목록 (보고 없어도 row 표시)
  const reviewableUsers = filteredProfiles.map((p) => ({
    email: p.email,
    display_name: p.display_name ?? null,
    division: p.division ?? null,
    team: p.team ?? null,
    effective_team: resolveRoutingTeam(p.team ?? null, p.notify_team ?? null),
  }))

  if (filteredProfiles.length === 0) {
    return NextResponse.json({ rows: [], virtualReviews: [], reviewableUsers, reviewableTeams })
  }

  const emails = filteredProfiles.map((p) => p.email)

  // work_logs 조회
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

  // leader_reviews 조회 (work_log 있든 없든) — target_user_email + target_date 기준
  const { data: reviews } = await adminClient
    .from('work_log_leader_reviews')
    .select('work_log_id, target_user_email, target_date, status, note, reviewer_email, reviewed_at')
    .in('target_user_email', emails)
    .gte('target_date', from)
    .lte('target_date', to)

  const reviewByTarget = new Map<string, {
    status: ReviewStatus; note: string | null; reviewer_email: string; reviewed_at: string; work_log_id: string | null;
  }>()
  for (const r of reviews ?? []) {
    const key = `${r.target_user_email}|${r.target_date}`
    reviewByTarget.set(key, {
      status: r.status as ReviewStatus,
      note: r.note as string | null,
      reviewer_email: r.reviewer_email as string,
      reviewed_at: r.reviewed_at as string,
      work_log_id: (r.work_log_id as string | null) ?? null,
    })
  }

  const profileByEmail = new Map(filteredProfiles.map((p) => [p.email, p]))

  // rows: work_log 단위 (테이블뷰)
  const wlKeys = new Set<string>()
  const rows = wlRows.map((w) => {
    const email = w.user_email as string
    const date = w.leave_date as string
    const p = profileByEmail.get(email)
    const key = `${email}|${date}`
    wlKeys.add(key)
    const r = reviewByTarget.get(key)
    return {
      work_log_id: w.id as string,
      user_email: email,
      display_name: p?.display_name ?? null,
      division: p?.division ?? null,
      team: p?.team ?? null,
      effective_team: resolveRoutingTeam(p?.team ?? null, p?.notify_team ?? null),
      target_date: date,
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

  // v1.74 — virtualReviews: work_log 없는데 review만 박힌 케이스
  const virtualReviews: Array<{
    user_email: string; target_date: string; review_status: ReviewStatus;
    review_note: string | null; reviewer_email: string | null; reviewed_at: string | null;
  }> = []
  for (const r of reviews ?? []) {
    const key = `${r.target_user_email}|${r.target_date}`
    if (wlKeys.has(key)) continue  // work_log 있는 케이스는 rows에 포함됨
    virtualReviews.push({
      user_email: r.target_user_email as string,
      target_date: r.target_date as string,
      review_status: r.status as ReviewStatus,
      review_note: (r.note as string | null) ?? null,
      reviewer_email: (r.reviewer_email as string | null) ?? null,
      reviewed_at: (r.reviewed_at as string | null) ?? null,
    })
  }

  return NextResponse.json({ rows, virtualReviews, reviewableUsers, reviewableTeams })
}

// ─── PATCH ─────────────────────────────────────────────────────────────────────
export async function PATCH(request: Request) {
  const auth = await requireLeaderOrAdmin()
  if (!auth) {
    return NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 })
  }
  const { user: reviewer, scope } = auth

  let body: {
    work_log_id?: string | null
    target_user_email?: string
    target_date?: string
    status?: string | null
    note?: string | null
  } | null = null
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const workLogId = (body?.work_log_id ?? '').trim() || null
  const rawStatus = body?.status
  const note = typeof body?.note === 'string' ? body.note.trim() || null : null

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

  // target 추출 — work_log_id 있으면 work_logs 조회로 자동 채움. 없으면 body에서 받음.
  let targetEmail = (body?.target_user_email ?? '').trim().toLowerCase()
  let targetDate = (body?.target_date ?? '').trim()
  if (workLogId) {
    const { data: wl } = await adminClient
      .from('work_logs')
      .select('user_email, leave_date, is_deleted')
      .eq('id', workLogId)
      .maybeSingle()
    if (!wl || wl.is_deleted) {
      return NextResponse.json({ error: '대상 보고를 찾을 수 없습니다.' }, { status: 404 })
    }
    targetEmail = (wl.user_email as string).toLowerCase()
    targetDate = wl.leave_date as string
  }
  if (!targetEmail || !/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
    return NextResponse.json({ error: 'target_user_email + target_date 또는 work_log_id 필요' }, { status: 400 })
  }

  // 대상자 profile 권한 검증
  const { data: targetProfile } = await adminClient
    .from('user_profiles')
    .select('email, division, team, notify_team')
    .eq('email', targetEmail)
    .maybeSingle()
  if (!targetProfile) {
    return NextResponse.json({ error: '대상자 프로필 없음' }, { status: 404 })
  }
  const targetDivision = (targetProfile.division ?? '').trim()
  const targetEffectiveTeam = resolveRoutingTeam(
    targetProfile.team ?? null,
    targetProfile.notify_team ?? null,
  )
  if (scope.kind === 'team' && targetEffectiveTeam !== scope.team) {
    return NextResponse.json({ error: '본인 팀 멤버만 수정 가능합니다.' }, { status: 403 })
  }
  if (scope.kind === 'division' && targetDivision !== scope.division) {
    return NextResponse.json({ error: '본인 본부 멤버만 수정 가능합니다.' }, { status: 403 })
  }

  // delete
  if (status === null) {
    const { error } = await adminClient
      .from('work_log_leader_reviews')
      .delete()
      .eq('target_user_email', targetEmail)
      .eq('target_date', targetDate)
    if (error) {
      console.error('[leader-reviews PATCH] delete error:', error)
      return NextResponse.json({ error: '삭제 실패' }, { status: 500 })
    }
    return NextResponse.json({ ok: true, status: null })
  }

  // upsert (UNIQUE target_user_email + target_date)
  const reviewerEmail = (reviewer?.email ?? '').toLowerCase()
  const { error: upsertErr } = await adminClient
    .from('work_log_leader_reviews')
    .upsert(
      {
        work_log_id: workLogId,  // 있으면 채우고, 없으면 NULL
        target_user_email: targetEmail,
        target_date: targetDate,
        reviewer_email: reviewerEmail,
        status,
        note,
        reviewed_at: new Date().toISOString(),
      },
      { onConflict: 'target_user_email,target_date' },
    )
  if (upsertErr) {
    console.error('[leader-reviews PATCH] upsert error:', upsertErr)
    return NextResponse.json({ error: '저장 실패' }, { status: 500 })
  }
  return NextResponse.json({ ok: true, status, note, reviewer_email: reviewerEmail, target_user_email: targetEmail, target_date: targetDate })
}
