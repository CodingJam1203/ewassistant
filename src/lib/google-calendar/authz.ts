/**
 * Phase 4.2 권한 매핑 helper.
 *
 * 정책: 모든 활성 사용자는 본인 본부 안의 캘린더 events를 등록/수정/삭제 가능.
 *   - 다른 본부 read는 가능 (RLS로 SELECT 전부 허용)
 *   - 다른 본부 write는 차단 — 본 helper로 검증
 *   - admin은 모든 본부 write 가능
 */

import { createAdminClient } from '@/lib/supabase/admin'

export interface UserAuthzInfo {
  userId: string
  email: string
  isAdmin: boolean
  divisionId: string | null  // user_profiles.division 이름 → org_divisions.id 매핑 결과
  teamId: string | null      // 동일 매핑
}

/**
 * 사용자의 본부/팀 매핑 + admin 여부 조회.
 * 본부/팀 매핑 실패(이름 매칭 안 됨)면 divisionId/teamId가 null — write 작업 차단됨.
 */
export async function resolveUserAuthz(
  adminClient: ReturnType<typeof createAdminClient>,
  userId: string,
  email: string,
): Promise<UserAuthzInfo | null> {
  const { data: profile } = await adminClient
    .from('user_profiles')
    .select('role, division, team')
    .eq('id', userId)
    .single()
  if (!profile) return null

  const isAdmin = profile.role === 'admin'

  let divisionId: string | null = null
  let teamId: string | null = null

  if (profile.division) {
    const { data: div } = await adminClient
      .from('org_divisions')
      .select('id')
      .eq('name', profile.division)
      .maybeSingle()
    if (div) {
      divisionId = div.id
      if (profile.team) {
        const { data: team } = await adminClient
          .from('org_teams')
          .select('id')
          .eq('division_id', div.id)
          .eq('name', profile.team)
          .maybeSingle()
        if (team) teamId = team.id
      }
    }
  }

  return { userId, email, isAdmin, divisionId, teamId }
}

/**
 * 사용자가 특정 캘린더에 write 가능한지.
 * admin이면 항상 true. 그 외엔 캘린더.division_id 와 본인 divisionId 일치 시 true.
 */
export function canWriteToCalendar(
  authz: UserAuthzInfo,
  calendarDivisionId: string,
): boolean {
  if (authz.isAdmin) return true
  if (!authz.divisionId) return false
  return calendarDivisionId === authz.divisionId
}
