/**
 * GET /api/cron/reminder-22
 * 매일 22:00 KST (13:00 UTC) — 다음 날짜 출근보고 현황 재발송
 * 팀별로 라우팅 테이블을 사용해 각 팀의 출근보고 스레드에 개별 발송
 */

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { notifyDailyCheckinReminder } from '@/lib/notifications/teams'
import { resolveRoutingTeam } from '@/lib/org'
import { formatNightlyCheckinStatus } from '@/lib/notifications/messages'
import { fetchOrgCalendarLookup } from '@/lib/org-calendar/lookup'
import { resolveDisplayLocations, formatChipsArrow } from '@/lib/work-locations-v2'
import { isWeekendDate } from '@/lib/utils/date'
import { isKoreanHoliday } from '@/lib/kr-holidays'
import { loadTeamCronFlags, isCronFlagOn } from '@/lib/notifications/cron-flags'
import type { WorkLocations } from '@/types/work-locations-v2'

/** planned_work_locations(WorkLocations 배열) → 표시용 string ("사무실 → 재택") */
function fmtPlannedLocations(planned: WorkLocations | null | undefined): string | null {
  if (!planned) return null
  const chips = resolveDisplayLocations({
    actual: null,
    planned: planned,
    legacyActualTimeline: null,
    legacyExpectedTimeline: null,
    legacyWorkLocation: null,
    legacyExpectedWorkLocation: null,
  })
  if (!chips || chips.length === 0) return null
  return formatChipsArrow(chips)
}

function getKstDate(offsetDays = 0): string {
  const d = new Date(Date.now() + 9 * 60 * 60 * 1000)
  d.setUTCDate(d.getUTCDate() + offsetDays)
  return d.toISOString().slice(0, 10)
}

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  const secret = process.env.CRON_SECRET
  // FAIL-CLOSE: env가 비어있으면 무조건 거부 (이전엔 secret 미설정 시 모두 통과 — 심각한 취약점)
  if (!secret) {
    console.error('[cron/reminder-22] CRON_SECRET env not set — rejecting all requests')
    return NextResponse.json({ error: 'Server misconfiguration' }, { status: 500 })
  }
  if (authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (process.env.ENABLE_DAILY_REMINDER_NOTIFY === 'false') {
    return NextResponse.json({ skipped: true, reason: 'ENABLE_DAILY_REMINDER_NOTIFY=false' })
  }

  const targetDate = getKstDate(1)
  const adminClient = createAdminClient()

  const { data: users } = await adminClient
    .from('user_profiles')
    .select('email, display_name, division, team, notify_team, display_order')
    .eq('is_active', true)
    .order('display_order', { ascending: true, nullsFirst: false })
    .order('division', { ascending: true })
    .order('team', { ascending: true })
    .order('display_name', { ascending: true })

  if (!users || users.length === 0) {
    return NextResponse.json({ skipped: true, reason: 'no active users' })
  }

  // Stage 0-4a 단일 row 모델: targetDate(내일)의 work_log row를 leave_date 기준으로 찾는다.
  // 옛 분리 모델(expected_start_date='내일') 쿼리는 deprecate — 새 모델 데이터를 못 찾아 전부 미보고 처리되던 버그.
  const { data: checkins } = await adminClient
    .from('work_logs')
    .select('user_email, planned_start_time, planned_end_time, planned_work_locations, leave_timeline, attendance_record_type, leave_date, created_at')
    .eq('leave_date', targetDate)
    .eq('is_deleted', false)
    .not('planned_start_time', 'is', null)
    .order('created_at', { ascending: false })

  interface CheckinAdapter {
    expected_work_location: string | null
    expected_work_time: string | null
    expected_end_time: string | null
    attendance_record_type: string | null
    expected_start_date: string | null
  }
  const checkinMap = new Map<string, CheckinAdapter>()
  for (const c of checkins ?? []) {
    if (!checkinMap.has(c.user_email)) {
      checkinMap.set(c.user_email, {
        expected_work_location: fmtPlannedLocations(c.planned_work_locations as WorkLocations | null),
        expected_work_time:     c.planned_start_time,
        expected_end_time:      c.planned_end_time,
        attendance_record_type: c.attendance_record_type ?? '출근보고 진행 (주말출근, 휴가 포함)',
        expected_start_date:    c.leave_date,
      })
    }
  }

  // v1.58: 대상일 휴가 map. 종일 휴가(full_day)는 planned_start_time이 NULL이라 위 checkins
  // 필터(.not planned_start null)에 안 잡힘 → 별도 조회해 미보고 대신 🌴 휴가로 표시.
  const leaveMap = new Map<string, { type: 'full_day' | 'morning_half' | 'afternoon_half'; label: string }>()
  {
    const { data: leaveRows } = await adminClient
      .from('work_logs')
      .select('user_email, leave_timeline')
      .eq('leave_date', targetDate)
      .eq('is_deleted', false)
    for (const r of leaveRows ?? []) {
      const lt = (r.leave_timeline as Array<{ leaveType?: string; label?: string }> | null)?.[0]
      if (lt?.leaveType === 'full_day' || lt?.leaveType === 'morning_half' || lt?.leaveType === 'afternoon_half') {
        if (!leaveMap.has(r.user_email)) leaveMap.set(r.user_email, { type: lt.leaveType, label: lt.label ?? '' })
      }
    }
  }

  // 팀별 그루핑.
  // 본부 직속(team 없음)은 admin 지정 notify_team으로 effective team을 잡아 해당 팀 그룹에 합류 →
  // 그 팀 출근보고 채널 리마인더에 함께 노출. division도 notify_team도 없으면 제외.
  const teamGroups = new Map<string, { division: string; team: string; users: typeof users }>()
  for (const u of users) {
    const effTeam = resolveRoutingTeam(u.team, (u as { notify_team?: string | null }).notify_team)
    if (!u.division || !effTeam) continue
    const key = `${u.division}||${effTeam}`
    if (!teamGroups.has(key)) {
      teamGroups.set(key, { division: u.division, team: effTeam, users: [] })
    }
    teamGroups.get(key)!.users.push(u)
  }

  // v1.51 — 팀별 cron 알림 ON/OFF 플래그 lookup (notify_reminder_22)
  const teamCronFlags = await loadTeamCronFlags(adminClient)

  // 내일자 캘린더 일정 조회 (Google Calendar, email 기반 — 휴가 제외 일반 events만)
  // Phase 1.5f: Sheets(getDepartmentDailyParsed) → org_calendar_events. lookup의 events는 vacation 제외.
  const calLookup = await fetchOrgCalendarLookup({
    adminClient,
    emails: users.map(u => u.email),
    dates: [targetDate],
  }).catch(err => {
    console.warn('[cron/reminder-22] calendar lookup failed:', err)
    return null
  })

  // 팀별 발송
  const promises = Array.from(teamGroups.values()).map(group => {
    const members = group.users.map(u => {
      const c = checkinMap.get(u.email)
      const lv = leaveMap.get(u.email)
      return {
        name:   u.display_name || u.email,
        division: u.division || '미입력',
        // 본부 직속 멤버는 raw team이 없으니 그룹의 effective team(notify_team) 표시
        team: u.team || group.team || '미입력',
        scheduledWorkDate: c?.expected_start_date || targetDate,
        scheduledWorkTime: c?.expected_work_time || '',
        scheduledWorkEndTime: c?.expected_end_time ?? null,
        scheduledWorkLocation: c?.expected_work_location || '미입력',
        attendanceRecordType: c?.attendance_record_type || '미입력',
        status: formatNightlyCheckinStatus(c), // fallback
        hasReport: !!c,
        leaveType: lv?.type ?? null,
        leaveLabel: lv?.label ?? null,
      }
    })

    // v1.51 — 팀별 cron 알림 OFF면 그 팀 skip.
    if (!isCronFlagOn(teamCronFlags, group.division, group.team, 'notify_reminder_22')) return null

    // 비근무일(토/일/한국 공휴일) 출근일 + 출근보고 작성자 0명 → 그 팀 알림 스킵.
    // v1.46: 공휴일(대체공휴일 포함) 추가.
    if ((isWeekendDate(targetDate) || isKoreanHoliday(targetDate)) && members.every(m => !m.hasReport)) return null

    // 이 팀에 속한 사용자들의 내일 캘린더 일정 모음 (email 매칭)
    const calendarEvents: Array<{
      name: string
      startTime: string | null
      endTime: string | null
      title: string
    }> = []
    for (const u of group.users) {
      const userName = u.display_name?.trim()
      if (!userName) continue
      const events = calLookup?.byEmail.get(u.email.toLowerCase())?.[targetDate]?.events ?? []
      for (const ev of events) {
        calendarEvents.push({
          name: userName,
          startTime: ev.startTime,
          endTime: ev.endTime,
          title: ev.title,
        })
      }
    }

    return notifyDailyCheckinReminder('daily_checkin_reminder_22', {
      division:   group.division,
      team:       group.team,
      targetDate,
      members,
      calendarEvents,
    })
  }).filter((p): p is Promise<void> => p !== null)

  await Promise.allSettled(promises)

  return NextResponse.json({ ok: true, targetDate, teamCount: teamGroups.size, userCount: users.length })
}
