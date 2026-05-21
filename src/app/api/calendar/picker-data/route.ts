/**
 * GET /api/calendar/picker-data
 *
 * EventEditModal(MultiTagPicker 포함)이 마운트 시 호출하는 일회성 lookup endpoint.
 * - users         : 활성 사용자 (display_name·email·division·team)
 * - tags          : 활성 org_tags (label·aliases·members·division_id·team_id)
 * - divisions     : org_divisions (id·name·sort_order)
 * - teams         : org_teams (id·name·division_id·sort_order)
 * - calendars     : active org_calendars (id·label·calendar_type·division_id·team_id)
 * - myProfile     : { userId, email, displayName, divisionId, teamId, isAdmin }
 *
 * 권한: 인증된 사용자.
 * 권한 검증은 실제 POST /api/calendar/events에서 본부 scope으로 처리. 본 endpoint는 read-only.
 */
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()

  const [usersRes, tagsRes, divisionsRes, teamsRes, calendarsRes, profileRes] = await Promise.all([
    admin.from('user_profiles')
      .select('email, display_name, division, team')
      .eq('is_active', true)
      .order('display_name'),
    admin.from('org_tags')
      .select('id, label, alias_patterns, member_emails, division_id, team_id')
      .eq('is_active', true)
      .order('label'),
    admin.from('org_divisions').select('id, name, sort_order').order('sort_order'),
    admin.from('org_teams').select('id, name, division_id, sort_order').order('sort_order'),
    admin.from('org_calendars')
      .select('id, label, calendar_type, division_id, team_id, event_classification')
      .eq('is_active', true)
      .order('division_id')
      .order('team_id', { nullsFirst: true })
      .order('label'),
    admin.from('user_profiles')
      .select('display_name, role, division, team')
      .eq('id', user.id)
      .maybeSingle(),
  ])

  // authz(본부/팀 매핑·admin 여부)를 별도 순차 쿼리 없이 위 병렬 배치 결과로 계산.
  // resolveUserAuthz와 동일 로직 — 이미 가져온 divisions/teams 배열에서 이름→id 매핑.
  const divisions = divisionsRes.data ?? []
  const teams = teamsRes.data ?? []
  const profile = profileRes.data
  const isAdmin = profile?.role === 'admin'
  let divisionId: string | null = null
  let teamId: string | null = null
  if (profile?.division) {
    const div = divisions.find(d => d.name === profile.division)
    if (div) {
      divisionId = div.id
      if (profile.team) {
        const team = teams.find(t => t.division_id === div.id && t.name === profile.team)
        if (team) teamId = team.id
      }
    }
  }

  return NextResponse.json({
    users:     usersRes.data ?? [],
    tags:      tagsRes.data ?? [],
    divisions,
    teams,
    calendars: calendarsRes.data ?? [],
    myProfile: {
      userId:      user.id,
      email:       user.email,
      displayName: profile?.display_name ?? null,
      divisionId,
      teamId,
      isAdmin,
    },
  })
}
