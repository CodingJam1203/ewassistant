import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdmin } from '@/lib/admin-check'

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const adminUser = await requireAdmin()
    if (!adminUser) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const { id } = await params
    const body = await request.json()
    const adminClient = createAdminClient()

    const updates: Record<string, any> = { updated_at: new Date().toISOString() }
    if (body.title !== undefined) updates.title = body.title
    if (body.content !== undefined) updates.content = body.content
    if (body.notice_type !== undefined) updates.notice_type = body.notice_type
    if (body.is_pinned !== undefined) updates.is_pinned = body.is_pinned
    if (body.is_active !== undefined) updates.is_active = body.is_active
    if (body.starts_at !== undefined) updates.starts_at = body.starts_at
    if (body.ends_at !== undefined) updates.ends_at = body.ends_at

    const { data, error } = await adminClient
      .from('service_notices')
      .update(updates)
      .eq('id', id)
      .select()
      .single()

    if (error) throw error

    return NextResponse.json(data)
  } catch (err: any) {
    console.error('Admin Notices PATCH Error:', err)
    return NextResponse.json({ error: '서버 에러가 발생했습니다.' }, { status: 500 })
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const adminUser = await requireAdmin()
    if (!adminUser) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const { id } = await params
    const adminClient = createAdminClient()

    const { error } = await adminClient
      .from('service_notices')
      .delete()
      .eq('id', id)

    if (error) throw error

    return NextResponse.json({ success: true })
  } catch (err: any) {
    console.error('Admin Notices DELETE Error:', err)
    return NextResponse.json({ error: '서버 에러가 발생했습니다.' }, { status: 500 })
  }
}
