import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireActiveUser } from '@/lib/admin-check'

// GET /api/org — 본부+팀 전체 구조 (활성 로그인 사용자 공통)
export async function GET() {
  try {
    const user = await requireActiveUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized or inactive account' }, { status: 403 })
    }

    const supabase = await createClient()

    const { data: divisions, error: divError } = await supabase
      .from('org_divisions')
      .select('id, name, sort_order')
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true })

    if (divError) throw divError

    const { data: teams, error: teamError } = await supabase
      .from('org_teams')
      .select('id, division_id, name, sort_order, use_check_in_complete')
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true })

    if (teamError) throw teamError

    // 본부별 팀 그룹화
    const result = (divisions ?? []).map(div => ({
      ...div,
      teams: (teams ?? []).filter(t => t.division_id === div.id),
    }))

    // 조직 구조는 거의 변경 없음 — 60초 캐시 + 24h stale-while-revalidate
    return NextResponse.json(result, {
      headers: {
        'Cache-Control': 'private, max-age=60, stale-while-revalidate=86400',
      },
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[/api/org GET]', message)
    return NextResponse.json({ error: '서버 에러가 발생했습니다.' }, { status: 500 })
  }
}
