import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdmin } from '@/lib/admin-check'

const noticeCreateSchema = z.object({
  title: z.string().trim().min(1, '제목을 입력해주세요.').max(200, '제목은 200자 이하로 입력해주세요.'),
  content: z.string().trim().min(1, '내용을 입력해주세요.').max(5000, '내용은 5000자 이하로 입력해주세요.'),
  notice_type: z.string().max(50).optional(),
  is_pinned: z.boolean().optional(),
  is_active: z.boolean().optional(),
  starts_at: z.string().datetime({ offset: true }).nullable().optional(),
  ends_at: z.string().datetime({ offset: true }).nullable().optional(),
})

export async function GET() {
  try {
    const adminUser = await requireAdmin()
    if (!adminUser) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const adminClient = createAdminClient()
    const { data, error } = await adminClient
      .from('service_notices')
      .select('*')
      .order('created_at', { ascending: false })

    if (error) throw error

    return NextResponse.json(data)
  } catch (err: unknown) {
    console.error('Admin Notices GET Error:', err)
    return NextResponse.json({ error: '서버 에러가 발생했습니다.' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const adminUser = await requireAdmin()
    if (!adminUser) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const body = await request.json()
    const parsed = noticeCreateSchema.safeParse(body)
    if (!parsed.success) {
      const firstIssue = parsed.error.issues[0]
      return NextResponse.json({ error: firstIssue?.message ?? '입력값이 올바르지 않습니다.' }, { status: 400 })
    }
    const v = parsed.data

    const adminClient = createAdminClient()

    const { data, error } = await adminClient
      .from('service_notices')
      .insert({
        title: v.title,
        content: v.content,
        notice_type: v.notice_type || 'general',
        is_pinned: v.is_pinned ?? false,
        is_active: v.is_active ?? true,
        starts_at: v.starts_at ?? null,
        ends_at: v.ends_at ?? null,
        created_by: adminUser.email,
      })
      .select()
      .single()

    if (error) throw error

    return NextResponse.json(data)
  } catch (err: unknown) {
    console.error('Admin Notices POST Error:', err)
    return NextResponse.json({ error: '서버 에러가 발생했습니다.' }, { status: 500 })
  }
}
