/**
 * /api/admin/calendars/[id]
 *   PATCH:  캘린더 부분 수정 (label / is_active / google_calendar_id / type / division / team)
 *   DELETE: 캘린더 + 동기화된 events 모두 제거 (cascade 명시적 처리)
 *
 * 권한: admin only
 */
import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-check'
import { createAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const VALID_CALENDAR_TYPES = ['meeting', 'vacation', 'birthday', 'other'] as const
type CalendarType = typeof VALID_CALENDAR_TYPES[number]

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const adminUser = await requireAdmin()
  if (!adminUser) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await ctx.params
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const body = await request.json().catch(() => ({}))
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() }

  if (typeof body.google_calendar_id === 'string') {
    const v = body.google_calendar_id.trim()
    if (!v) return NextResponse.json({ error: 'Google Calendar ID는 빈 값일 수 없습니다.' }, { status: 400 })
    update.google_calendar_id = v
  }
  if (typeof body.calendar_type === 'string') {
    const v = body.calendar_type.trim()
    if (!VALID_CALENDAR_TYPES.includes(v as CalendarType)) {
      return NextResponse.json({ error: `유효하지 않은 캘린더 유형입니다 (${VALID_CALENDAR_TYPES.join('/')})` }, { status: 400 })
    }
    update.calendar_type = v
  }
  if (typeof body.label === 'string') {
    const v = body.label.trim()
    if (!v) return NextResponse.json({ error: '라벨은 빈 값일 수 없습니다.' }, { status: 400 })
    update.label = v
  }
  if (typeof body.division_id === 'string') {
    update.division_id = body.division_id.trim()
  }
  if ('team_id' in body) {
    // null/빈 문자열 → null (본부 공용)
    const v = typeof body.team_id === 'string' && body.team_id.trim() ? body.team_id.trim() : null
    update.team_id = v
  }
  if (typeof body.is_active === 'boolean') {
    update.is_active = body.is_active
  }
  if (body.event_classification === 'by_type' || body.event_classification === 'by_title') {
    update.event_classification = body.event_classification
  }

  // updated_at 외 변경 사항이 1개도 없으면 400 (의도 없는 update 차단)
  if (Object.keys(update).length <= 1) {
    return NextResponse.json({ error: '변경할 필드가 없습니다.' }, { status: 400 })
  }

  const client = createAdminClient()
  const { data, error } = await client
    .from('org_calendars')
    .update(update)
    .eq('id', id)
    .select()
    .single()

  if (error) {
    if (error.code === '23503') return NextResponse.json({ error: '본부 또는 팀이 존재하지 않습니다.' }, { status: 400 })
    if (error.code === '23505') return NextResponse.json({ error: '이미 등록된 캘린더입니다.' }, { status: 409 })
    console.error('[admin/calendars PATCH] error:', error)
    return NextResponse.json({ error: '캘린더 수정에 실패했습니다.' }, { status: 500 })
  }
  if (!data) return NextResponse.json({ error: '캘린더를 찾을 수 없습니다.' }, { status: 404 })
  return NextResponse.json(data)
}

export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const adminUser = await requireAdmin()
  if (!adminUser) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await ctx.params
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const client = createAdminClient()

  // 1) 동기화된 events 먼저 제거 (FK 의존성 — RESTRICT 가능성 + 데이터 정리)
  const { error: evDelErr } = await client
    .from('org_calendar_events')
    .delete()
    .eq('org_calendar_id', id)
  if (evDelErr) {
    console.error('[admin/calendars DELETE] events delete error:', evDelErr)
    return NextResponse.json({ error: '연관 이벤트 삭제에 실패했습니다.' }, { status: 500 })
  }

  // 2) calendar 자체 제거
  const { error: calDelErr } = await client
    .from('org_calendars')
    .delete()
    .eq('id', id)
  if (calDelErr) {
    console.error('[admin/calendars DELETE] calendar delete error:', calDelErr)
    return NextResponse.json({ error: '캘린더 삭제에 실패했습니다.' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
