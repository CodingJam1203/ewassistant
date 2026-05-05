import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-check'
import { createAdminClient } from '@/lib/supabase/admin'

// PATCH /api/admin/org/teams/[id] — 팀명 수정
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const adminUser = await requireAdmin()
  if (!adminUser) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const { name } = await request.json()
  if (typeof name !== 'string' || !name.trim()) {
    return NextResponse.json({ error: '팀명을 입력해주세요.' }, { status: 400 })
  }
  if (name.trim().length > 100) {
    return NextResponse.json({ error: '팀명은 100자 이하로 입력해주세요.' }, { status: 400 })
  }

  const adminClient = createAdminClient()
  const { data, error } = await adminClient
    .from('org_teams')
    .update({ name: name.trim() })
    .eq('id', id)
    .select()
    .single()

  if (error) {
    if (error.code === '23505') return NextResponse.json({ error: '이미 존재하는 팀명입니다.' }, { status: 409 })
    console.error('[admin/org/teams PATCH] error:', error)
    return NextResponse.json({ error: '팀 수정에 실패했습니다.' }, { status: 500 })
  }
  return NextResponse.json(data)
}

// DELETE /api/admin/org/teams/[id] — 팀 삭제
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const adminUser = await requireAdmin()
  if (!adminUser) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const adminClient = createAdminClient()

  const { error } = await adminClient.from('org_teams').delete().eq('id', id)
  if (error) {
    console.error('[admin/org/teams DELETE] error:', error)
    return NextResponse.json({ error: '팀 삭제에 실패했습니다.' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
