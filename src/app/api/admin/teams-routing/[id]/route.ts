/**
 * /api/admin/teams-routing/[id]
 *
 *   PATCH  : 1건 수정 (전체 또는 일부 필드)
 *   DELETE : 1건 삭제
 *
 * 권한: admin only
 */

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdmin } from '@/lib/admin-check'
import { createAdminClient } from '@/lib/supabase/admin'
import { invalidateRoutingCache } from '@/lib/notifications/teams-routing'

const ROUTING_PATCH = z.object({
  department:  z.string().trim().min(1).max(64).optional(),
  team_name:   z.string().trim().min(1).max(64).optional(),
  report_type: z.enum(['출근보고', '퇴근보고']).optional(),
  team_id:     z.string().trim().min(1).max(128).optional(),
  channel_id:  z.string().trim().min(1).max(256).optional(),
  message_id:  z.string().trim().min(1).max(64).optional(),
  is_active:   z.boolean().optional(),
  notes:       z.string().trim().max(500).optional().nullable(),
})

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await requireAdmin()
  if (!admin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const { id } = await params
  if (!id) return NextResponse.json({ error: 'id 필요' }, { status: 400 })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: '잘못된 요청 본문' }, { status: 400 })
  }

  const parsed = ROUTING_PATCH.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: '입력값 검증 실패: ' + parsed.error.issues.map(i => i.message).join(', ') },
      { status: 400 }
    )
  }
  if (Object.keys(parsed.data).length === 0) {
    return NextResponse.json({ error: '변경할 필드가 없습니다.' }, { status: 400 })
  }

  const client = createAdminClient()
  const { data, error } = await client
    .from('teams_routing')
    .update({ ...parsed.data, updated_by: admin.id })
    .eq('id', id)
    .select()
    .single()

  if (error) {
    console.error('[/api/admin/teams-routing PATCH]', error.message)
    if (error.code === '23505') {
      return NextResponse.json(
        { error: '같은 (본부, 팀, 보고유형) 조합이 이미 존재합니다.' },
        { status: 409 }
      )
    }
    return NextResponse.json({ error: '수정 실패' }, { status: 500 })
  }

  invalidateRoutingCache()
  return NextResponse.json({ row: data })
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await requireAdmin()
  if (!admin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const { id } = await params
  if (!id) return NextResponse.json({ error: 'id 필요' }, { status: 400 })

  const client = createAdminClient()
  const { error } = await client.from('teams_routing').delete().eq('id', id)
  if (error) {
    console.error('[/api/admin/teams-routing DELETE]', error.message)
    return NextResponse.json({ error: '삭제 실패' }, { status: 500 })
  }

  invalidateRoutingCache()
  return NextResponse.json({ ok: true })
}
