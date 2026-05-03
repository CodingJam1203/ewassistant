import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// GET /api/org — 본부+팀 전체 구조 (로그인 사용자 공통)
export async function GET() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: divisions, error: divError } = await supabase
      .from('org_divisions')
      .select('id, name, sort_order')
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true })

    if (divError) throw divError

    const { data: teams, error: teamError } = await supabase
      .from('org_teams')
      .select('id, division_id, name, sort_order')
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true })

    if (teamError) throw teamError

    // 본부별 팀 그룹화
    const result = (divisions ?? []).map(div => ({
      ...div,
      teams: (teams ?? []).filter(t => t.division_id === div.id),
    }))

    return NextResponse.json(result)
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
