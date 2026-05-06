/**
 * /api/admin/teams-routing
 *
 *   GET    : 전체 라우팅 목록
 *   POST   : 새 라우팅 추가  (department, team_name, report_type, team_id, channel_id, message_id)
 *
 * 권한: admin only
 */

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdmin } from '@/lib/admin-check'
import { createAdminClient } from '@/lib/supabase/admin'
import { invalidateRoutingCache } from '@/lib/notifications/teams-routing'

const ROUTING_INPUT = z.object({
  department:  z.string().trim().min(1).max(64),
  team_name:   z.string().trim().min(1).max(64),
  report_type: z.enum(['출근보고', '퇴근보고']),
  team_id:     z.string().trim().min(1).max(128),
  channel_id:  z.string().trim().min(1).max(256),
  message_id:  z.string().trim().min(1).max(64),
  is_active:   z.boolean().optional(),
  notes:       z.string().trim().max(500).optional().nullable(),
})

export async function GET() {
  const admin = await requireAdmin()
  if (!admin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const client = createAdminClient()
  const { data, error } = await client
    .from('teams_routing')
    .select('*')
    .order('department', { ascending: true })
    .order('team_name', { ascending: true })
    .order('report_type', { ascending: true })
  if (error) {
    console.error('[/api/admin/teams-routing GET]', error.message)
    return NextResponse.json({ error: '조회 실패' }, { status: 500 })
  }
  return NextResponse.json({ rows: data ?? [] })
}

export async function POST(request: Request) {
  const admin = await requireAdmin()
  if (!admin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: '잘못된 요청 본문' }, { status: 400 })
  }

  const parsed = ROUTING_INPUT.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: '입력값 검증 실패: ' + parsed.error.issues.map(i => i.message).join(', ') },
      { status: 400 }
    )
  }

  const client = createAdminClient()
  const { data, error } = await client
    .from('teams_routing')
    .insert({
      ...parsed.data,
      updated_by: admin.id,
    })
    .select()
    .single()

  if (error) {
    console.error('[/api/admin/teams-routing POST]', error.message)
    if (error.code === '23505') {
      return NextResponse.json(
        { error: '같은 (본부, 팀, 보고유형)이 이미 존재합니다.' },
        { status: 409 }
      )
    }
    return NextResponse.json({ error: '저장 실패' }, { status: 500 })
  }

  invalidateRoutingCache()
  return NextResponse.json({ row: data }, { status: 201 })
}
