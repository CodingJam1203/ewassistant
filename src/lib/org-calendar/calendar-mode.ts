/**
 * Phase B — 사용자 캘린더 운영 mode 조회 + 쓰기 가드.
 *
 * mode 정의:
 *   - gcal_only        : Google Calendar 1:1 양방향 (현행 default 다수 팀)
 *   - gcal_plus_sheet  : GCal + 시트 read-only 합산
 *   - sheet_only       : 시트만 SoT. 일정 등록·수정·삭제 차단, chip read-only
 *   - none             : 캘린더 기능 미사용. 일정/휴가 모두 차단
 *
 * mode 결정:
 *   - 팀 멤버: user_profiles의 (division, team) → org_teams.calendar_mode
 *   - 본부 직속(team NULL): 같은 본부의 active 팀(sort_order 최상위) mode 적용 (fallback).
 *     활성 팀 없으면 'none'.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export type CalendarMode = 'gcal_only' | 'gcal_plus_sheet' | 'sheet_only' | 'none'

interface UserProfileRow {
  division: string | null
  team: string | null
}

interface TeamModeRow {
  calendar_mode: CalendarMode
}

interface DivisionTeamModeRow {
  calendar_mode: CalendarMode
  sort_order: number
}

/**
 * 사용자 email로 mode 조회. 정책서 §16 v1.46 / Phase B.1 backfill 결과 기반.
 *
 * @returns 매칭 안 되거나 본부/팀 정보 없으면 'none' (안전 default — write 차단)
 */
export async function getUserCalendarMode(
  adminClient: SupabaseClient,
  userEmail: string,
): Promise<CalendarMode> {
  const email = (userEmail ?? '').toLowerCase().trim()
  if (!email) return 'none'

  const userResult = await adminClient
    .from('user_profiles')
    .select('division, team')
    .eq('email', email)
    .maybeSingle()

  const user = userResult.data as UserProfileRow | null
  if (!user || !user.division) return 'none'

  // 팀 멤버: 그 팀의 mode
  if (user.team) {
    const teamResult = await adminClient
      .from('org_teams')
      .select('calendar_mode, org_divisions!inner(name)')
      .eq('name', user.team)
      .eq('org_divisions.name', user.division)
      .maybeSingle()
    const team = teamResult.data as TeamModeRow | null
    return team?.calendar_mode ?? 'none'
  }

  // 본부 직속(team NULL) — 같은 본부의 active 팀 중 sort_order 최상위 mode (fallback)
  const divResult = await adminClient
    .from('org_teams')
    .select('calendar_mode, sort_order, org_divisions!inner(name)')
    .eq('org_divisions.name', user.division)
    .neq('calendar_mode', 'none')
    .order('sort_order', { ascending: true })
    .limit(1)
  const rows = divResult.data as DivisionTeamModeRow[] | null
  return rows?.[0]?.calendar_mode ?? 'none'
}

/**
 * mode가 일정 쓰기(등록·수정·삭제) 차단 대상인지 판정.
 * sheet_only / none → 차단. gcal_only / gcal_plus_sheet → 허용.
 */
export function modeBlocksEventWrite(mode: CalendarMode): { blocked: boolean; reason?: string } {
  if (mode === 'sheet_only') {
    return {
      blocked: true,
      reason: '시트 운영 팀은 N-Click에서 일정 등록·수정·삭제할 수 없습니다. 시트에 직접 작성해주세요.',
    }
  }
  if (mode === 'none') {
    return {
      blocked: true,
      reason: '이 팀은 캘린더 기능이 비활성 상태입니다. 관리자에게 문의해주세요.',
    }
  }
  return { blocked: false }
}

/**
 * mode가 휴가 등록 시 GCal로 push할지 결정.
 * gcal_only / gcal_plus_sheet → push 수행
 * sheet_only / none → push skip (N-Click 내부만 저장)
 */
export function modePushesLeaveToGCal(mode: CalendarMode): boolean {
  return mode === 'gcal_only' || mode === 'gcal_plus_sheet'
}
