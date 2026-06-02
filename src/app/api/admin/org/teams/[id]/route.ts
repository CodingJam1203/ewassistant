import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-check'
import { createAdminClient } from '@/lib/supabase/admin'

// PATCH /api/admin/org/teams/[id] — 팀명·use_check_in_complete·sheet_source_id·calendar_mode·cron 알림 플래그 수정
const VALID_CALENDAR_MODES = ['gcal_only', 'gcal_plus_sheet', 'sheet_only', 'none'] as const
type CalendarMode = typeof VALID_CALENDAR_MODES[number]

const CRON_FLAG_KEYS = ['notify_morning_07', 'notify_reminder_20', 'notify_reminder_22'] as const
type CronFlagKey = typeof CRON_FLAG_KEYS[number]

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const adminUser = await requireAdmin()
  if (!adminUser) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const body = await request.json()
  const updates: {
    name?: string
    use_check_in_complete?: boolean
    sheet_source_id?: string | null
    calendar_mode?: CalendarMode
    notify_morning_07?: boolean
    notify_reminder_20?: boolean
    notify_reminder_22?: boolean
    use_leader_review?: boolean
  } = {}

  if ('name' in body) {
    if (typeof body.name !== 'string' || !body.name.trim()) {
      return NextResponse.json({ error: '팀명을 입력해주세요.' }, { status: 400 })
    }
    if (body.name.trim().length > 100) {
      return NextResponse.json({ error: '팀명은 100자 이하로 입력해주세요.' }, { status: 400 })
    }
    updates.name = body.name.trim()
  }

  if ('use_check_in_complete' in body) {
    if (typeof body.use_check_in_complete !== 'boolean') {
      return NextResponse.json({ error: 'use_check_in_complete must be boolean' }, { status: 400 })
    }
    updates.use_check_in_complete = body.use_check_in_complete
  }

  // v1.73 — 리더 관리 뷰 사용 토글
  if ('use_leader_review' in body) {
    if (typeof body.use_leader_review !== 'boolean') {
      return NextResponse.json({ error: 'use_leader_review must be boolean' }, { status: 400 })
    }
    updates.use_leader_review = body.use_leader_review
  }

  // Phase A — 시트 source 매핑. null/'' → 매핑 해제, uuid → 매핑 설정.
  if ('sheet_source_id' in body) {
    const v = body.sheet_source_id
    if (v === null || v === '') {
      updates.sheet_source_id = null
    } else if (typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v)) {
      updates.sheet_source_id = v
    } else {
      return NextResponse.json({ error: 'sheet_source_id는 uuid 또는 null이어야 합니다.' }, { status: 400 })
    }
  }

  // Phase B — 캘린더 운영 mode 변경. ENUM 4종 중 하나만 허용.
  if ('calendar_mode' in body) {
    const v = body.calendar_mode
    if (typeof v !== 'string' || !VALID_CALENDAR_MODES.includes(v as CalendarMode)) {
      return NextResponse.json({
        error: `calendar_mode는 다음 중 하나여야 합니다: ${VALID_CALENDAR_MODES.join(', ')}`,
      }, { status: 400 })
    }
    updates.calendar_mode = v as CalendarMode
  }

  // v1.51 — cron 알림 ON/OFF 플래그 (morning-summary 07 / reminder-20 / reminder-22)
  for (const key of CRON_FLAG_KEYS) {
    if (key in body) {
      if (typeof body[key] !== 'boolean') {
        return NextResponse.json({ error: `${key}는 boolean이어야 합니다.` }, { status: 400 })
      }
      updates[key as CronFlagKey] = body[key] as boolean
    }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: '변경할 항목이 없습니다.' }, { status: 400 })
  }

  const adminClient = createAdminClient()
  const { data, error } = await adminClient
    .from('org_teams')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) {
    if (error.code === '23505') return NextResponse.json({ error: '이미 존재하는 팀명입니다.' }, { status: 409 })
    console.error('[admin/org/teams PATCH] error:', error)
    return NextResponse.json({ error: '팀 수정에 실패했습니다.' }, { status: 500 })
  }
  return NextResponse.json(data)
}

// DELETE /api/admin/org/teams/[id] — 팀 삭제
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const adminUser = await requireAdmin()
  if (!adminUser) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const adminClient = createAdminClient()

  const { error } = await adminClient.from('org_teams').delete().eq('id', id)
  if (error) {
    console.error('[admin/org/teams DELETE] error:', error)
    return NextResponse.json({ error: '팀 삭제에 실패했습니다.' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
