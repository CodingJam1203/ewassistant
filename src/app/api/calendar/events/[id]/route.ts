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
import { pushEventUpdate, pushEventDelete, pushInstanceOverride, pushInstanceDelete, splitMasterFollowing, truncateMasterFollowing, extractRawEventIdFromGoogleEventId, syncMasterById } from '@/lib/google-calendar/events'
import { resolveUserAuthz, canWriteToCalendar } from '@/lib/google-calendar/authz'
import { loadUserLookup, matchUsers, inferEventType } from '@/lib/org-calendar/match-users'

type RecurrenceMode = 'instance' | 'following' | 'all'

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
  /** Phase 4.8 — 반복 시리즈 수정 옵션. single 이벤트면 무시(=all). default 'all'. */
  recurrenceMode?: RecurrenceMode
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

  const rawCalId = extractCalendarRawId(cal.google_calendar_id)
  const rawEventId = extractRawEventIdFromGoogleEventId(ev.google_event_id)
  const lookup = await loadUserLookup(admin)
  const matchFn = (t: string, attendees: string[]) => matchUsers(
    { title: t, attendeeEmails: attendees, divisionId: cal.division_id, teamId: cal.team_id },
    lookup,
  )
  const isInstance = !!ev.recurring_event_id  // 이 row가 반복 시리즈의 한 occurrence인지
  // single 이벤트는 mode 무시(=all). instance가 아니면 실질적으로 mode='all'.
  const requestedMode: RecurrenceMode = (body.recurrenceMode === 'instance' || body.recurrenceMode === 'following') ? body.recurrenceMode : 'all'
  const effectiveMode: RecurrenceMode = isInstance ? requestedMode : 'all'

  // 사용자가 고른(또는 기존) 속성 — push extendedProperties + syncMasterById 신뢰용
  const nclickTypeForPush = (next.inferredType ?? undefined) as ('meeting' | 'vacation' | 'birthday' | 'other' | undefined)
  const payload = {
    title: next.title, description: next.description, location: next.location,
    startAt: next.startAt, endAt: next.endAt, isAllDay: next.isAllDay,
    rrule: next.rrule,
    nclickType: nclickTypeForPush,
  }

  let updated: Record<string, unknown> | null = null

  try {
    if (effectiveMode === 'instance') {
      // '이 일정' — events.patch(instanceId)로 그 instance만 override. 시리즈 그대로.
      await pushInstanceOverride(rawCalId, rawEventId, { ...payload, rrule: null })
      // DB 그 row만 update (master 그대로)
      const nowIso = new Date().toISOString()
      const { data: row, error: upErr } = await admin
        .from('org_calendar_events')
        .update({
          title: next.title,
          description: next.description,
          location: next.location,
          start_at: next.startAt.toISOString(),
          end_at:   next.endAt.toISOString(),
          is_all_day: next.isAllDay,
          matched_user_emails: matchFn(next.title, ev.attendee_emails ?? []),
          inferred_type: next.inferredType,
          source: 'nclick',
          synced_at: nowIso,
          nclick_pushed_at: nowIso,
          // rrule/recurring_event_id 그대로 (시리즈 소속 유지)
        })
        .eq('id', id)
        .select('*')
        .single()
      if (upErr) throw new Error(upErr.message)
      updated = row as Record<string, unknown>
    } else if (effectiveMode === 'following') {
      // '이 일정 및 향후' — 기존 master truncate + 새 master insert (변경 내용 + RRULE)
      const masterId = ev.recurring_event_id as string
      const { oldMasterICalUID, newMaster } = await splitMasterFollowing(
        rawCalId,
        masterId,
        new Date(ev.start_at),
        payload,
      )
      // 두 master 모두 syncMasterById — 기존 master 잘림, 새 master expanded
      await syncMasterById({
        adminClient: admin, rawCalId,
        calendar: { id: cal.id, division_id: cal.division_id, team_id: cal.team_id, calendar_type: next.inferredType },
        iCalUID: oldMasterICalUID,
        rrule: null,  // 기존 master rrule은 truncated. syncMasterById가 events.list로 재조회하니 master rrule 자동 반영 X (rrule 컬럼 인자만 인스턴스 보존용). 일관성을 위해 null 전달.
        userId: user.id, matchUsersForTitle: matchFn, inferType: inferEventType,
        nclickType: nclickTypeForPush,
      })
      const newMasterSync = await syncMasterById({
        adminClient: admin, rawCalId,
        calendar: { id: cal.id, division_id: cal.division_id, team_id: cal.team_id, calendar_type: next.inferredType },
        iCalUID: newMaster.iCalUID,
        rrule: next.rrule,
        userId: user.id, matchUsersForTitle: matchFn, inferType: inferEventType,
        nclickType: nclickTypeForPush,
      })
      updated = newMasterSync.primaryRow ?? ev as Record<string, unknown>
    } else {
      // 'all' — master(or single) 직접 update + syncMasterById
      const targetId = (ev.recurring_event_id as string | null) ?? rawEventId
      const pushed = await pushEventUpdate(rawCalId, targetId, payload)
      const result = await syncMasterById({
        adminClient: admin, rawCalId,
        calendar: { id: cal.id, division_id: cal.division_id, team_id: cal.team_id, calendar_type: next.inferredType },
        iCalUID: pushed.iCalUID,
        rrule: next.rrule,
        userId: user.id, matchUsersForTitle: matchFn, inferType: inferEventType,
        nclickType: nclickTypeForPush,
      })
      updated = result.primaryRow ?? ev as Record<string, unknown>
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[calendar/events PATCH] mode=', effectiveMode, 'failed:', message)
    return NextResponse.json({ error: `수정 실패 (${effectiveMode}): ${message}` }, { status: 502 })
  }

  if (!updated) updated = ev as Record<string, unknown>

  await admin.from('org_calendar_event_history').insert({
    event_id: (updated as { id: string }).id,
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
    return NextResponse.json({ error: 'Forbidden — 본인 본부 캘린더만 삭제 가능' }, { status: 403 })
  }

  // Phase 4.8 — query string ?mode=instance|following|all (default 'all').
  // single 이벤트(recurring_event_id 없음)는 항상 'all' 동작.
  const url = new URL(request.url)
  const requestedMode = url.searchParams.get('mode')
  const isInstance = !!ev.recurring_event_id
  const effectiveMode: RecurrenceMode =
    isInstance && (requestedMode === 'instance' || requestedMode === 'following')
      ? requestedMode
      : 'all'

  const rawCalId = extractCalendarRawId(cal.google_calendar_id)
  const rawEventId = extractRawEventIdFromGoogleEventId(ev.google_event_id)

  try {
    if (effectiveMode === 'instance') {
      // events.delete(instanceId) — 그 occurrence만 cancel. master는 살아남음.
      await pushInstanceDelete(rawCalId, rawEventId)
      // DB 그 row 1건만 삭제
      const { error: delErr } = await admin.from('org_calendar_events').delete().eq('id', id)
      if (delErr) throw new Error(delErr.message)
    } else if (effectiveMode === 'following') {
      // master RRULE에 UNTIL=<instanceStart-1s> 적용 → 그 시점 이후 시리즈 모두 사라짐.
      const masterId = ev.recurring_event_id as string
      await truncateMasterFollowing(rawCalId, masterId, new Date(ev.start_at))
      // DB의 그 master 관련 row 중 start_at >= this instance 시각인 것 모두 삭제
      const { error: delErr } = await admin
        .from('org_calendar_events')
        .delete()
        .or(`google_event_id.eq.${masterId},recurring_event_id.eq.${masterId}`)
        .gte('start_at', ev.start_at)
      if (delErr) throw new Error(delErr.message)
    } else {
      // 'all' — master(또는 single) 삭제. 모든 occurrence 정리.
      const masterId = (ev.recurring_event_id as string | null) ?? rawEventId
      await pushEventDelete(rawCalId, masterId)
      const { error: delErr } = await admin
        .from('org_calendar_events')
        .delete()
        .or(`google_event_id.eq.${masterId},recurring_event_id.eq.${masterId}`)
      if (delErr) throw new Error(delErr.message)
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[calendar/events DELETE] mode=', effectiveMode, 'failed:', message)
    return NextResponse.json({ error: `삭제 실패 (${effectiveMode}): ${message}` }, { status: 502 })
  }

  // history — delete는 prev_snapshot에 삭제 직전 row 보존
  await admin.from('org_calendar_event_history').insert({
    event_id: id,
    org_calendar_id: cal.id,
    action: 'delete',
    actor_user_id: user.id,
    actor_email: user.email,
    snapshot: { ...ev, _delete_mode: effectiveMode },
    prev_snapshot: ev,
  })

  return NextResponse.json({ ok: true, mode: effectiveMode })
}
