import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-check'
import { createAdminClient } from '@/lib/supabase/admin'

// PATCH /api/admin/org/divisions/[id] — 본부명 수정 + 알림 정책 토글 + 외부 캘린더 모드 토글
// body: { name?: string, notify_on_advance_checkin?: boolean, read_only_calendar?: boolean }
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const adminUser = await requireAdmin()
  if (!adminUser) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const body = await request.json()

  const updates: Record<string, unknown> = {}

  if (body.name !== undefined) {
    if (typeof body.name !== 'string' || !body.name.trim()) {
      return NextResponse.json({ error: '본부명을 입력해주세요.' }, { status: 400 })
    }
    if (body.name.trim().length > 100) {
      return NextResponse.json({ error: '본부명은 100자 이하로 입력해주세요.' }, { status: 400 })
    }
    updates.name = body.name.trim()
  }

  // v1.50 — 본부별 사전등록 알림 정책 토글
  if (body.notify_on_advance_checkin !== undefined) {
    if (typeof body.notify_on_advance_checkin !== 'boolean') {
      return NextResponse.json({ error: 'notify_on_advance_checkin은 boolean이어야 합니다.' }, { status: 400 })
    }
    updates.notify_on_advance_checkin = body.notify_on_advance_checkin
  }

  // v1.77 — 외부 캘린더 모드(read-only) 토글. true면 휴가/시트 일정 외부 시스템으로 redirect.
  if (body.read_only_calendar !== undefined) {
    if (typeof body.read_only_calendar !== 'boolean') {
      return NextResponse.json({ error: 'read_only_calendar는 boolean이어야 합니다.' }, { status: 400 })
    }
    updates.read_only_calendar = body.read_only_calendar
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: '변경 항목이 없습니다.' }, { status: 400 })
  }

  const adminClient = createAdminClient()
  const { data, error } = await adminClient
    .from('org_divisions')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) {
    if (error.code === '23505') return NextResponse.json({ error: '이미 존재하는 본부명입니다.' }, { status: 409 })
    console.error('[admin/org/divisions PATCH] error:', error)
    return NextResponse.json({ error: '본부 수정에 실패했습니다.' }, { status: 500 })
  }
  return NextResponse.json(data)
}

// DELETE /api/admin/org/divisions/[id] — 본부 삭제 (하위 팀 모두 삭제됨)
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const adminUser = await requireAdmin()
  if (!adminUser) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const adminClient = createAdminClient()

  const { error } = await adminClient.from('org_divisions').delete().eq('id', id)
  if (error) {
    console.error('[admin/org/divisions DELETE] error:', error)
    return NextResponse.json({ error: '본부 삭제에 실패했습니다.' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
