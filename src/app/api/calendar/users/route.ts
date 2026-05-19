/**
 * GET /api/calendar/users
 *
 * 캘린더 매트릭스 뷰의 행(rows) 구성을 위한 사용자 목록.
 * - 활성 사용자만
 * - division.sort_order → team.sort_order → user.display_order → display_name
 *
 * 응답:
 *   { users: [{ email, displayName, divisionId, divisionName, teamId, teamName, role }] }
 */
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()

  const { data, error } = await admin
    .from('user_profiles')
    .select(`
      email, display_name, role, display_order,
      division:org_divisions(id, name, sort_order),
      team:org_teams(id, name, sort_order)
    `)
    .eq('is_active', true)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  interface DivisionShape { id: string; name: string; sort_order: number }
  interface TeamShape { id: string; name: string; sort_order: number }
  interface Row {
    email: string
    display_name: string | null
    role: string | null
    display_order: number | null
    division: DivisionShape | DivisionShape[] | null
    team: TeamShape | TeamShape[] | null
  }

  const rows = (data ?? []) as unknown as Row[]
  const users = rows
    .map(r => {
      const div = Array.isArray(r.division) ? (r.division[0] ?? null) : r.division
      const tm  = Array.isArray(r.team)     ? (r.team[0]     ?? null) : r.team
      return {
        email: r.email,
        displayName: r.display_name ?? r.email.split('@')[0],
        divisionId: div?.id ?? '',
        divisionName: div?.name ?? '(미배정)',
        divisionSort: div?.sort_order ?? 999,
        teamId: tm?.id ?? null,
        teamName: tm?.name ?? null,
        teamSort: tm?.sort_order ?? 999,
        role: r.role ?? 'user',
        displayOrder: r.display_order ?? 999,
      }
    })
    .sort((a, b) => {
      if (a.divisionSort !== b.divisionSort) return a.divisionSort - b.divisionSort
      if (a.teamSort     !== b.teamSort)     return a.teamSort - b.teamSort
      if (a.displayOrder !== b.displayOrder) return a.displayOrder - b.displayOrder
      return a.displayName.localeCompare(b.displayName, 'ko')
    })

  return NextResponse.json({ users, userEmail: user.email })
}
