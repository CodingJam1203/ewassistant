/**
 * POST /api/work-logs/dismiss-calendar-prefill (v1.61.1, 2026-05-30)
 *
 * body — { date: 'YYYY-MM-DD' }
 *
 * 정책 — 사용자가 시트/Google Calendar 자동 인식 휴가를 [이 휴가 취소] 누를 때 호출.
 * work_log row가 있으면 calendar_prefill_dismissed=true update + leave_timeline에서 source='calendar' 항목 제거.
 * 없으면 minimal row INSERT (leave_timeline=null, calendar_prefill_dismissed=true) — 다음 prefill 시 무시되도록 마커만.
 *
 * 응답 — { ok: true, workLogId: string }
 *
 * audit — 'work_log_dismiss_calendar_prefill' action 박제.
 * 알림 — 미발송 (silent — 휴가 무시 마커는 noisy 알림 대상 아님).
 *
 * vacation-sync — 기존 row의 leave_timeline에 calendar source 항목이 있었다면 같이 events.delete 시도.
 */
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireActiveUser } from '@/lib/admin-check'
import { recordAudit, extractRequestMeta } from '@/lib/audit-log'
import { syncLeaveTimelineWithGoogle } from '@/lib/google-calendar/vacation-sync'
import type { LeaveTimeline } from '@/types/leave-timeline'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/

export async function POST(request: Request) {
  const user = await requireActiveUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized or Inactive account' }, { status: 403 })
  }

  const body = await request.json().catch(() => null)
  const date = typeof body?.date === 'string' ? body.date.trim() : ''
  if (!DATE_REGEX.test(date)) {
    return NextResponse.json({ error: 'date 형식이 올바르지 않습니다 (YYYY-MM-DD).' }, { status: 400 })
  }
  // v1.61.3 — leaveSource='gcal' + leaveEventId 받으면 vacation-sync helper로 Google
  // Calendar events.delete 자동 호출 (양방향 fully sync). sheet source이면 무시.
  const leaveSource = typeof body?.leaveSource === 'string' ? body.leaveSource as 'gcal' | 'sheet' : null
  const leaveEventId = typeof body?.leaveEventId === 'string' ? body.leaveEventId : null

  const adminClient = createAdminClient()

  // 본인 프로필 (display_name, division/team)
  const { data: profile } = await adminClient
    .from('user_profiles')
    .select('display_name, division, team')
    .eq('email', user.email!)
    .maybeSingle()
  const displayName = profile?.display_name?.trim() || user.email!
  const userDivision = profile?.division ?? null
  const userTeam = profile?.team ?? null

  // 그 일자의 본인 active row 1건
  const { data: existing } = await adminClient
    .from('work_logs')
    .select('id, leave_timeline')
    .eq('user_email', user.email!)
    .eq('leave_date', date)
    .eq('is_deleted', false)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  let workLogId: string
  let prevLeaveTimeline: LeaveTimeline = []
  let nextLeaveTimeline: LeaveTimeline = []

  if (existing) {
    workLogId = existing.id
    prevLeaveTimeline = (Array.isArray(existing.leave_timeline)
      ? (existing.leave_timeline as LeaveTimeline)
      : []) as LeaveTimeline
    // calendar source 항목 제거 (manual은 유지)
    nextLeaveTimeline = prevLeaveTimeline.filter(it => it?.source !== 'calendar')

    const { error: updErr } = await adminClient
      .from('work_logs')
      .update({
        leave_timeline: nextLeaveTimeline.length > 0 ? nextLeaveTimeline : null,
        calendar_prefill_dismissed: true,
        updated_at: new Date().toISOString(),
      })
      .eq('id', workLogId)
      .eq('is_deleted', false)
    if (updErr) {
      return NextResponse.json({ error: updErr.message }, { status: 500 })
    }
  } else {
    // minimal row INSERT — dismissed 마커 전용. 다른 view에서 보고로 오인되지 않게 본문 비움.
    // attendance_record_type / planned_*_time / work_location_timeline 모두 null.
    // work_location은 NOT NULL이라 빈 문자열.
    const { data: inserted, error: insErr } = await adminClient
      .from('work_logs')
      .insert({
        user_id: user.id,
        user_email: user.email!,
        division: userDivision,
        team: userTeam,
        name: displayName,
        work_type_label: '(평일) 기본 근무',
        leave_date: date,
        // legacy NOT NULL 만족용 minimum
        start_time: '09:00',
        end_time: '18:00',
        break_time: '00:00:00',
        work_location: '',
        leave_timeline: null,
        late_or_attendance_status: '아니오',
        calendar_prefill_dismissed: true,
        teams_sent: false,
        is_deleted: false,
      })
      .select('id')
      .single()
    if (insErr) {
      console.error('[dismiss-calendar-prefill] INSERT error:', insErr)
      return NextResponse.json({ error: '마커 row 생성에 실패했습니다.' }, { status: 500 })
    }
    workLogId = inserted.id as string
  }

  // vacation-sync — 두 가지 경로:
  //  (a) 기존 row의 leave_timeline에 calendar source 항목이 있던 경우 — diff 기반 events.delete
  //  (b) v1.61.3 — caller가 leaveSource='gcal' + leaveEventId 명시한 경우. work_log row 없거나
  //      leave_timeline에 항목 없어도, fake prev entry 만들어서 events.delete trigger.
  //      org_calendar_events에서 fetch된 GCal 휴가를 N-Click 표시에서 가리는 동시에 Google Calendar
  //      이벤트도 같이 삭제 (사용자가 N-Click에 한 번도 등록 안 한 GCal-only 휴가).
  const shouldGcalDelete = leaveSource === 'gcal' && leaveEventId
  const effectivePrev: LeaveTimeline = shouldGcalDelete
    ? [
        ...prevLeaveTimeline,
        {
          kind: 'leave',
          leaveType: 'full_day',
          label: '휴가',
          startTime: '09:00',
          endTime: '18:00',
          actualMinutes: 480,
          roundedMinutes: 480,
          source: 'calendar',
          google_event_id: leaveEventId,
        },
      ]
    : prevLeaveTimeline
  if (effectivePrev.length > 0) {
    try {
      const result = await syncLeaveTimelineWithGoogle({
        adminClient,
        userEmail: user.email!,
        userDisplayName: displayName,
        leaveDate: date,
        prev: effectivePrev,
        next: nextLeaveTimeline,
      })
      if (result.changed && result.updatedTimeline && workLogId) {
        await adminClient
          .from('work_logs')
          .update({ leave_timeline: result.updatedTimeline.length > 0 ? result.updatedTimeline : null })
          .eq('id', workLogId)
      }
    } catch (err) {
      console.warn('[dismiss-calendar-prefill] vacation-sync failed (non-fatal):', err)
    }
  }

  // audit
  try {
    const meta = extractRequestMeta(request)
    await recordAudit({
      action: 'work_log_dismiss_calendar_prefill',
      actorId: user.id,
      actorEmail: user.email ?? null,
      targetTable: 'work_logs',
      targetId: workLogId,
      details: {
        leave_date: date,
        was_existing: !!existing,
        prev: prevLeaveTimeline,
        next: nextLeaveTimeline,
      },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    })
  } catch { /* silent */ }

  return NextResponse.json({ ok: true, workLogId })
}
