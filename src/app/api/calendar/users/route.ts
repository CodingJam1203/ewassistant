/**
 * GET /api/calendar/users
 *
 * 캘린더 매트릭스 뷰의 행(rows) 구성을 위한 사용자 목록.
 *
 * 주의: user_profiles.division/team은 text 컬럼(이름 기반, FK 아님).
 *   → org_divisions / org_teams 별도 fetch 후 JS에서 name으로 join + sort_order lookup.
 *
 * 정렬: division.sort_order → team.sort_order → user.display_order → display_name
 *
 * 응답:
 *   { users: [{ email, displayName, divisionId, divisionName, teamId, teamName, role }] }
 */
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface DivisionRow { id: string; name: string; sort_order: number }
interface TeamRow     { id: string; name: string; sort_order: number; division_id: string }

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()

  // 4개 fetch 병렬 — users(active) + 모든 division/team + currentUser 본인 정보
  const [usersRes, divsRes, teamsRes, meRes] = await Promise.all([
    admin.from('user_profiles')
      .select('email, display_name, role, division, team, display_order')
      .eq('is_active', true),
    admin.from('org_divisions').select('id, name, sort_order'),
    admin.from('org_teams').select('id, name, sort_order, division_id'),
    admin.from('user_profiles')
      .select('division, team')
      .eq('email', user.email!)
      .maybeSingle(),
  ])

  if (usersRes.error) {
    console.error('[calendar/users] user_profiles error:', usersRes.error.message)
    return NextResponse.json({ error: usersRes.error.message }, { status: 500 })
  }
  if (divsRes.error) {
    console.error('[calendar/users] org_divisions error:', divsRes.error.message)
    return NextResponse.json({ error: divsRes.error.message }, { status: 500 })
  }
  if (teamsRes.error) {
    console.error('[calendar/users] org_teams error:', teamsRes.error.message)
    return NextResponse.json({ error: teamsRes.error.message }, { status: 500 })
  }

  // 이름 기반 lookup
  const divByName = new Map<string, DivisionRow>()
  for (const d of divsRes.data ?? []) {
    divByName.set(d.name, d as DivisionRow)
  }
  // team은 (division_id, name) 조합으로 unique (같은 이름 팀이 다른 본부에 있을 수 있어)
  const teamByDivAndName = new Map<string, TeamRow>()
  for (const t of teamsRes.data ?? []) {
    teamByDivAndName.set(`${t.division_id}::${t.name}`, t as TeamRow)
  }

  interface UserRow {
    email: string
    display_name: string | null
    role: string | null
    division: string | null
    team: string | null
    display_order: number | null
  }

  const userRows = (usersRes.data ?? []) as UserRow[]
  const users = userRows
    .map(u => {
      const divName = u.division ?? ''
      const div = divName ? divByName.get(divName) : undefined
      const teamName = u.team ?? ''
      const tm = (div && teamName) ? teamByDivAndName.get(`${div.id}::${teamName}`) : undefined
      return {
        email: u.email,
        displayName: u.display_name ?? u.email.split('@')[0],
        divisionId: div?.id ?? '',
        divisionName: divName || '(미배정)',
        divisionSort: div?.sort_order ?? 999,
        teamId: tm?.id ?? null,
        teamName: teamName || null,
        teamSort: tm?.sort_order ?? 999,
        role: u.role ?? 'user',
        displayOrder: u.display_order ?? 999,
      }
    })
    .sort((a, b) => {
      if (a.divisionSort !== b.divisionSort) return a.divisionSort - b.divisionSort
      if (a.teamSort     !== b.teamSort)     return a.teamSort - b.teamSort
      if (a.displayOrder !== b.displayOrder) return a.displayOrder - b.displayOrder
      return a.displayName.localeCompare(b.displayName, 'ko')
    })

  // 본부 dropdown 옵션 목록 — sort_order 정렬
  const divisions = (divsRes.data ?? [])
    .slice()
    .sort((a, b) => (a.sort_order ?? 999) - (b.sort_order ?? 999))
    .map(d => ({ id: d.id, name: d.name, sortOrder: d.sort_order ?? 999 }))

  // 현재 사용자의 본부 id
  const myDivisionName = meRes.data?.division ?? null
  const myDivisionId = myDivisionName ? (divByName.get(myDivisionName)?.id ?? null) : null

  return NextResponse.json({
    users,
    divisions,
    userEmail: user.email,
    myDivisionId,
    myDivisionName,
    myTeamName: meRes.data?.team ?? null,
  })
}
