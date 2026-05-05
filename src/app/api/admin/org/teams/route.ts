import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-check'
import { createAdminClient } from '@/lib/supabase/admin'

// POST /api/admin/org/teams — 팀 추가
export async function POST(request: Request) {
  const adminUser = await requireAdmin()
  if (!adminUser) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { division_id, name } = await request.json()
  if (!division_id) return NextResponse.json({ error: '본부를 선택해주세요.' }, { status: 400 })
  if (typeof name !== 'string' || !name.trim()) {
    return NextResponse.json({ error: '팀명을 입력해주세요.' }, { status: 400 })
  }
  if (name.trim().length > 100) {
    return NextResponse.json({ error: '팀명은 100자 이하로 입력해주세요.' }, { status: 400 })
  }

  const adminClient = createAdminClient()
  const { data, error } = await adminClient
    .from('org_teams')
    .insert({ division_id, name: name.trim() })
    .select()
    .single()

  if (error) {
    if (error.code === '23505') return NextResponse.json({ error: '이미 존재하는 팀명입니다.' }, { status: 409 })
    console.error('[admin/org/teams POST] error:', error)
    return NextResponse.json({ error: '팀 추가에 실패했습니다.' }, { status: 500 })
  }
  return NextResponse.json(data, { status: 201 })
}
