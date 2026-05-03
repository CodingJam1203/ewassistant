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
  if (!name?.trim()) return NextResponse.json({ error: '팀명을 입력해주세요.' }, { status: 400 })

  const adminClient = createAdminClient()
  const { data, error } = await adminClient
    .from('org_teams')
    .update({ name: name.trim() })
    .eq('id', id)
    .select()
    .single()

  if (error) {
    if (error.code === '23505') return NextResponse.json({ error: '이미 존재하는 팀명입니다.' }, { status: 409 })
    return NextResponse.json({ error: error.message }, { status: 500 })
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
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true })
}
