/**
 * PATCH /api/calendar/events/[id] — N-Click에서 일정 수정 → Google API update → DB update + history
 * DELETE /api/calendar/events/[id] — 삭제 → Google API delete → DB delete + history
 *
 * 권한: source 무관하게(Google 측 일정도 수정 가능) 본인 본부의 캘린더 events만.
 *       admin은 모든 본부 가능.
 *
 * source='google' 인 row를 수정/삭제하면 source='nclick'으로 전환되며 nclick_pushed_at 갱신.
 * (Google측 원본 일정에 우리가 변경을 push했다는 표시 — 다음 sync에서 같은 google_event_id로
 *  upsert되어 자연 idempotent.)
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { extractCalendarRawId } from '@/lib/google-calendar/client'
import { pushEventUpdate, pushEventDelete, extractRawEventIdFromGoogleEventId } from '@/lib/google-calendar/events'
import { resolveUserAuthz, canWriteToCalendar } from '@/lib/google-calendar/authz'
import { loadUserLookup, matchUsers } from '@/lib/org-calendar/match-users'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

interface PatchBody {
  title?: string
  description?: string | null
  location?: string | null
  startAt?: string
  endAt?: string
  isAllDay?: boolean
  rrule?: string | null
  inferredType?: 'meeting' | 'vacation' | 'birthday' | 'other'
}

async function loadEventAndCalendar(adminClient: ReturnType<typeof createAdminClient>, id: string) {
  const { data: ev } = await adminClient
    .from('org_calendar_events')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (!ev) return null
  const { data: cal } = await adminClient
    .from('org_calendars')
    .select('id, division_id, team_id, google_calendar_id, calendar_type, is_active')
    .eq('id', ev.org_calendar_id)
    .maybeSingle()
  if (!cal) return null
  return { ev, cal }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await context.params
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const admin = createAdminClient()
  const authz = await resolveUserAuthz(admin, user.id, user.email)
  if (!authz) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const loaded = await loadEventAndCalendar(admin, id)
  if (!loaded) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const { ev, cal } = loaded
  if (!canWriteToCalendar(authz, cal.division_id)) {
    return NextResponse.json({ error: 'Forbidden — 본인 본부 캘린더만 수정 가능' }, { status: 403 })
  }

  const body: PatchBody = await request.json().catch(() => ({}))

  // 변경 후 값 결정 — undefined인 필드는 기존 값 유지
  const next = {
    title:       (body.title ?? ev.title)?.trim() || ev.title,
    description: body.description !== undefined ? body.description : ev.description,
    location:    body.location    !== undefined ? body.location    : ev.location,
    startAt:     body.startAt ? new Date(body.startAt) : new Date(ev.start_at),
    endAt:       body.endAt   ? new Date(body.endAt)   : new Date(ev.end_at),
    isAllDay:    typeof body.isAllDay === 'boolean' ? body.isAllDay : ev.is_all_day,
    rrule:       body.rrule !== undefined ? (body.rrule?.trim() || null) : ev.rrule,
    inferredType: body.inferredType ?? ev.inferred_type,
  }

  if (Number.isNaN(next.startAt.getTime()) || Number.isNaN(next.endAt.getTime())) {
    return NextResponse.json({ error: 'invalid startAt/endAt' }, { status: 400 })
  }
  if (next.startAt >= next.endAt) {
    return NextResponse.json({ error: 'startAt must be < endAt' }, { status: 400 })
  }

  // Google push update
  const rawCalId = extractCalendarRawId(cal.google_calendar_id)
  const rawEventId = extractRawEventIdFromGoogleEventId(ev.google_event_id)
  let pushed
  try {
    pushed = await pushEventUpdate(rawCalId, rawEventId, {
      title: next.title,
      description: next.description,
      location: next.location,
      startAt: next.startAt,
      endAt: next.endAt,
      isAllDay: next.isAllDay,
      rrule: next.rrule,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[calendar/events PATCH] google update failed:', message)
    return NextResponse.json({ error: `Google update 실패: ${message}` }, { status: 502 })
  }

  // matched_user_emails 재산출 (title 변경 시 영향)
  const lookup = await loadUserLookup(admin)
  const matched = matchUsers(
    { title: next.title, attendeeEmails: ev.attendee_emails ?? [], divisionId: cal.division_id, teamId: cal.team_id },
    lookup,
  )

  const nowIso = new Date().toISOString()
  const { data: updated, error: updErr } = await admin
    .from('org_calendar_events')
    .update({
      title: next.title,
      description: next.description,
      location: next.location,
      start_at: next.startAt.toISOString(),
      end_at:   next.endAt.toISOString(),
      is_all_day: next.isAllDay,
      matched_user_emails: matched,
      inferred_type: next.inferredType,
      rrule: next.rrule,
      // start time이 바뀌면 google_event_id의 "::ms" suffix도 변경됨 — pushed에서 회수
      google_event_id: pushed.googleEventId,
      synced_at: nowIso,
      source: 'nclick',
      nclick_pushed_at: nowIso,
    })
    .eq('id', id)
    .select('*')
    .single()

  if (updErr || !updated) {
    console.error('[calendar/events PATCH] db update failed:', updErr?.message)
    return NextResponse.json({ error: `DB update 실패: ${updErr?.message}` }, { status: 500 })
  }

  await admin.from('org_calendar_event_history').insert({
    event_id: updated.id,
    org_calendar_id: cal.id,
    action: 'update',
    actor_user_id: user.id,
    actor_email: user.email,
    snapshot: updated,
    prev_snapshot: ev,
  })

  return NextResponse.json({ event: updated })
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await context.params
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const admin = createAdminClient()
  const authz = await resolveUserAuthz(admin, user.id, user.email)
  if (!authz) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const loaded = await loadEventAndCalendar(admin, id)
  if (!loaded) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const { ev, cal } = loaded
  if (!canWriteToCalendar(authz, cal.division_id)) {
    return NextResponse.json({ error: 'Forbidden — 본인 본부 캘린더만 삭제 가능' }, { status: 403 })
  }

  const rawCalId = extractCalendarRawId(cal.google_calendar_id)
  const rawEventId = extractRawEventIdFromGoogleEventId(ev.google_event_id)
  try {
    await pushEventDelete(rawCalId, rawEventId)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[calendar/events DELETE] google delete failed:', message)
    return NextResponse.json({ error: `Google delete 실패: ${message}` }, { status: 502 })
  }

  const { error: delErr } = await admin
    .from('org_calendar_events')
    .delete()
    .eq('id', id)
  if (delErr) {
    console.error('[calendar/events DELETE] db delete failed:', delErr.message)
    return NextResponse.json({ error: `DB delete 실패: ${delErr.message}` }, { status: 500 })
  }

  // history — delete는 prev_snapshot에 삭제 직전 row 보존
  await admin.from('org_calendar_event_history').insert({
    event_id: id,
    org_calendar_id: cal.id,
    action: 'delete',
    actor_user_id: user.id,
    actor_email: user.email,
    snapshot: ev,
    prev_snapshot: ev,
  })

  return NextResponse.json({ ok: true })
}
