import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdmin } from '@/lib/admin-check'

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
  } catch (err: any) {
    console.error('Admin Notices GET Error:', err)
    return NextResponse.json({ error: '서버 에러가 발생했습니다.' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const adminUser = await requireAdmin()
    if (!adminUser) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const body = await request.json()
    const adminClient = createAdminClient()

    const { data, error } = await adminClient
      .from('service_notices')
      .insert({
        title: body.title,
        content: body.content,
        notice_type: body.notice_type || 'general',
        is_pinned: body.is_pinned || false,
        is_active: body.is_active !== undefined ? body.is_active : true,
        starts_at: body.starts_at || null,
        ends_at: body.ends_at || null,
        created_by: adminUser.email,
      })
      .select()
      .single()

    if (error) throw error

    return NextResponse.json(data)
  } catch (err: any) {
    console.error('Admin Notices POST Error:', err)
    return NextResponse.json({ error: '서버 에러가 발생했습니다.' }, { status: 500 })
  }
}
