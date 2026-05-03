import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-check'
import { createAdminClient } from '@/lib/supabase/admin'

// POST /api/admin/org/divisions — 본부 추가
export async function POST(request: Request) {
  const adminUser = await requireAdmin()
  if (!adminUser) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { name } = await request.json()
  if (!name?.trim()) return NextResponse.json({ error: '본부명을 입력해주세요.' }, { status: 400 })

  const adminClient = createAdminClient()
  const { data, error } = await adminClient
    .from('org_divisions')
    .insert({ name: name.trim() })
    .select()
    .single()

  if (error) {
    if (error.code === '23505') return NextResponse.json({ error: '이미 존재하는 본부명입니다.' }, { status: 409 })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json(data, { status: 201 })
}
