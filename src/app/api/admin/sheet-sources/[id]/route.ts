/**
 * /api/admin/sheet-sources/[id]
 *   PATCH: label / department_key / is_active 부분 갱신
 *   DELETE: 시트 source 삭제 — 매핑된 팀의 sheet_source_id는 ON DELETE SET NULL로 자동 정리됨
 *
 * 권한: admin only
 */
import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-check'
import { createAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface UpdatePayload {
  label?: string
  department_key?: string
  is_active?: boolean
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const body = await request.json().catch(() => ({}))

  const updates: UpdatePayload = {}
  if ('label' in body) {
    if (typeof body.label !== 'string' || !body.label.trim()) {
      return NextResponse.json({ error: '라벨을 입력해주세요.' }, { status: 400 })
    }
    updates.label = body.label.trim()
  }
  if ('department_key' in body) {
    if (typeof body.department_key !== 'string' || !body.department_key.trim()) {
      return NextResponse.json({ error: 'Apps Script payload key를 입력해주세요.' }, { status: 400 })
    }
    updates.department_key = body.department_key.trim()
  }
  if ('is_active' in body) {
    if (typeof body.is_active !== 'boolean') {
      return NextResponse.json({ error: 'is_active must be boolean' }, { status: 400 })
    }
    updates.is_active = body.is_active
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: '변경할 항목이 없습니다.' }, { status: 400 })
  }

  const client = createAdminClient()
  const { data, error } = await client
    .from('org_sheet_sources')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) {
    if (error.code === '23505') return NextResponse.json({ error: '같은 본부에 동일한 key가 이미 있습니다.' }, { status: 409 })
    console.error('[admin/sheet-sources PATCH] error:', error)
    return NextResponse.json({ error: '시트 source 수정에 실패했습니다.' }, { status: 500 })
  }
  return NextResponse.json(data)
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const client = createAdminClient()

  // 매핑된 팀의 sheet_source_id는 FK ON DELETE SET NULL로 자동 처리.
  // leave_calendar_cache의 source-keyed row는 자연 TTL 만료 — 별도 정리 X.
  const { error } = await client
    .from('org_sheet_sources')
    .delete()
    .eq('id', id)

  if (error) {
    console.error('[admin/sheet-sources DELETE] error:', error)
    return NextResponse.json({ error: '시트 source 삭제에 실패했습니다.' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
