import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdmin } from '@/lib/admin-check'

const noticePatchSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  content: z.string().trim().min(1).max(5000).optional(),
  notice_type: z.string().max(50).optional(),
  is_pinned: z.boolean().optional(),
  is_active: z.boolean().optional(),
  starts_at: z.string().datetime({ offset: true }).nullable().optional(),
  ends_at: z.string().datetime({ offset: true }).nullable().optional(),
})

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const adminUser = await requireAdmin()
    if (!adminUser) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const { id } = await params
    const body = await request.json()
    const parsed = noticePatchSchema.safeParse(body)
    if (!parsed.success) {
      const firstIssue = parsed.error.issues[0]
      return NextResponse.json({ error: firstIssue?.message ?? '입력값이 올바르지 않습니다.' }, { status: 400 })
    }
    const v = parsed.data
    const adminClient = createAdminClient()

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (v.title !== undefined) updates.title = v.title
    if (v.content !== undefined) updates.content = v.content
    if (v.notice_type !== undefined) updates.notice_type = v.notice_type
    if (v.is_pinned !== undefined) updates.is_pinned = v.is_pinned
    if (v.is_active !== undefined) updates.is_active = v.is_active
    if (v.starts_at !== undefined) updates.starts_at = v.starts_at
    if (v.ends_at !== undefined) updates.ends_at = v.ends_at

    const { data, error } = await adminClient
      .from('service_notices')
      .update(updates)
      .eq('id', id)
      .select()
      .single()

    if (error) throw error

    return NextResponse.json(data)
  } catch (err: unknown) {
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
  } catch (err: unknown) {
    console.error('Admin Notices DELETE Error:', err)
    return NextResponse.json({ error: '서버 에러가 발생했습니다.' }, { status: 500 })
  }
}
