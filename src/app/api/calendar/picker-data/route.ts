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
import { resolveUserAuthz } from '@/lib/google-calendar/authz'

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
      .select('id, label, calendar_type, division_id, team_id')
      .eq('is_active', true)
      .order('division_id')
      .order('team_id', { nullsFirst: true })
      .order('label'),
    admin.from('user_profiles')
      .select('display_name')
      .eq('id', user.id)
      .maybeSingle(),
  ])

  const authz = await resolveUserAuthz(admin, user.id, user.email)

  return NextResponse.json({
    users:     usersRes.data ?? [],
    tags:      tagsRes.data ?? [],
    divisions: divisionsRes.data ?? [],
    teams:     teamsRes.data ?? [],
    calendars: calendarsRes.data ?? [],
    myProfile: {
      userId:      user.id,
      email:       user.email,
      displayName: profileRes.data?.display_name ?? null,
      divisionId:  authz?.divisionId ?? null,
      teamId:      authz?.teamId ?? null,
      isAdmin:     authz?.isAdmin ?? false,
    },
  })
}
