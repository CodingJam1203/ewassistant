/**
 * GET /api/work-hours?year=YYYY&month=MM&division=...&team=...&name=...
 *
 * 응답: { baselines, users[], teamSummaries[], overall }
 *
 * 권한:
 *   admin   → 전체 조직 (필터로 좁힐 수 있음)
 *   leader  → 본인 팀(또는 본부장이면 본인 본부)으로 자동 제한
 *   user    → 본인 1명만
 *
 * 데이터 정책:
 *   - 인정 근로시간 = 실근로 (work_logs.actual_work_time) 합
 *   - 휴가 시간 = leave_timeline의 차감분 합 (참고 표시용)
 *   - 기록 없는 사용자도 인원에는 포함 (recognizedHours = 0)
 */

import { NextResponse } from 'next/server'
import { requireActiveUser, requireLeaderOrAdmin } from '@/lib/admin-check'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  getMonthBaselines,
  summarizeUser,
  summarizeByTeam,
  summarizeOverall,
  intervalToMinutes,
  type UserMonthInputRow,
  type UserMonthSummary,
} from '@/lib/utils/work-hours'
import type { LeaveTimeline } from '@/types/leave-timeline'
import { totalLeaveRoundedMinutes } from '@/lib/leave-timeline'

interface ProfileRow {
  email: string
  display_name: string | null
  division: string | null
  team: string | null
  is_active: boolean | null
}

interface WorkLogRow {
  user_email: string
  actual_work_time: string | null
  leave_timeline: LeaveTimeline | null
  is_deleted: boolean | null
}

export async function GET(request: Request) {
  try {
    const user = await requireActiveUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized or inactive account' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const now = new Date()
    const year  = Number(searchParams.get('year') || now.getFullYear())
    const month = Number(searchParams.get('month') || (now.getMonth() + 1))
    const filterDivision = (searchParams.get('division') || '').trim()
    const filterTeam     = (searchParams.get('team')     || '').trim()
    const filterName     = (searchParams.get('name')     || '').trim()
    const filterRisk     = (searchParams.get('risk')     || '').trim()  // 'normal'|'caution'|'danger'|'over'

    if (!Number.isFinite(year) || year < 2020 || year > 2100) {
      return NextResponse.json({ error: '연도가 올바르지 않습니다.' }, { status: 400 })
    }
    if (!Number.isFinite(month) || month < 1 || month > 12) {
      return NextResponse.json({ error: '월이 올바르지 않습니다.' }, { status: 400 })
    }

    const baselines = getMonthBaselines(year, month)
    const adminClient = createAdminClient()

    // ── 권한 판정 ─────────────────────────────────────────────────────────────
    const leaderScope = await requireLeaderOrAdmin()
    const isLeaderOrAdmin = !!leaderScope

    // ── 대상 프로필 조회 ─────────────────────────────────────────────────────
    let profileQuery = adminClient
      .from('user_profiles')
      .select('email, display_name, division, team, is_active')
      .eq('is_active', true)

    if (!isLeaderOrAdmin) {
      // 일반 user: 본인만
      profileQuery = profileQuery.eq('email', user.email!)
    } else if (leaderScope!.scope.kind === 'team') {
      // leader (팀): 본인 팀
      profileQuery = profileQuery.eq('team', leaderScope!.scope.team!)
      if (leaderScope!.scope.division) {
        profileQuery = profileQuery.eq('division', leaderScope!.scope.division)
      }
    } else if (leaderScope!.scope.kind === 'division') {
      // leader (본부장): 본인 본부 전체
      profileQuery = profileQuery.eq('division', leaderScope!.scope.division!)
    } else {
      // admin: 필터 적용
      if (filterDivision) profileQuery = profileQuery.eq('division', filterDivision)
      if (filterTeam)     profileQuery = profileQuery.eq('team',     filterTeam)
    }

    // leader도 추가 필터(division/team)는 권한 범위 안에서만 추가 적용
    if (leaderScope?.scope.kind === 'team' && filterDivision &&
        filterDivision !== leaderScope.scope.division) {
      // leader는 본인 division만 가능 — 다른 division 필터는 무시 (또는 빈 응답)
    }

    const { data: profilesData, error: profileErr } = await profileQuery
    if (profileErr) throw profileErr
    let profiles = (profilesData ?? []) as ProfileRow[]

    // 이름 필터 (클라이언트 측 후처리 — display_name LIKE)
    if (filterName) {
      const needle = filterName.toLowerCase()
      profiles = profiles.filter(p => (p.display_name ?? '').toLowerCase().includes(needle))
    }

    if (profiles.length === 0) {
      return NextResponse.json({
        baselines,
        users: [],
        teamSummaries: [],
        overall: { totalCount: 0, normalCount: 0, cautionCount: 0, dangerCount: 0, overCount: 0, avgRecognizedHours: 0 },
      })
    }

    // ── 해당 월 work_logs 조회 ────────────────────────────────────────────────
    const monthStart = `${year}-${String(month).padStart(2, '0')}-01`
    const lastDay = baselines.daysInMonth
    const monthEnd = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`

    const emails = profiles.map(p => p.email)

    const { data: workLogs, error: logErr } = await adminClient
      .from('work_logs')
      .select('user_email, actual_work_time, leave_timeline, is_deleted')
      .in('user_email', emails)
      .gte('leave_date', monthStart)
      .lte('leave_date', monthEnd)
      .eq('is_deleted', false)
    if (logErr) throw logErr

    const logsByEmail = new Map<string, UserMonthInputRow[]>()
    for (const row of (workLogs ?? []) as WorkLogRow[]) {
      const leaveMin = totalLeaveRoundedMinutes(row.leave_timeline ?? null)
      const arr = logsByEmail.get(row.user_email) ?? []
      arr.push({
        email: row.user_email,
        display_name: null,  // 사용 안 함 (summarizeUser가 profile 기준)
        division: null,
        team: null,
        actual_work_time: row.actual_work_time,
        leave_minutes_sum: leaveMin,
      })
      logsByEmail.set(row.user_email, arr)
    }

    // ── 사용자별 요약 ────────────────────────────────────────────────────────
    let users: UserMonthSummary[] = profiles.map(p =>
      summarizeUser(
        { email: p.email, display_name: p.display_name, division: p.division, team: p.team },
        logsByEmail.get(p.email) ?? [],
        baselines
      )
    )

    if (filterRisk && ['normal', 'caution', 'danger', 'over'].includes(filterRisk)) {
      users = users.filter(u => u.risk === filterRisk)
    }

    const teamSummaries = summarizeByTeam(users, baselines)
    const overall = summarizeOverall(users)

    return NextResponse.json({
      baselines,
      users,
      teamSummaries,
      overall,
      scope: leaderScope?.scope ?? { kind: null, division: null, team: null },
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[/api/work-hours]', message)
    return NextResponse.json({ error: '서버 에러가 발생했습니다.' }, { status: 500 })
  }
}

// 미사용 import 제거 (lint)
void intervalToMinutes
