/**
 * GET /api/cron/reminder-22
 * 매일 22:00 KST (13:00 UTC) — 다음 날짜 출근보고 현황 재발송
 * 팀별로 라우팅 테이블을 사용해 각 팀의 출근보고 스레드에 개별 발송
 */

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { notifyDailyCheckinReminder } from '@/lib/notifications/teams'
import { formatNightlyCheckinStatus } from '@/lib/notifications/messages'
import { getDepartmentDailyParsed } from '@/lib/leave-calendar'
import { resolveDisplayLocations, formatChipsArrow } from '@/lib/work-locations-v2'
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
    .select('email, display_name, division, team, display_order')
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
    attendance_record_type: string | null
    expected_start_date: string | null
  }
  const checkinMap = new Map<string, CheckinAdapter>()
  for (const c of checkins ?? []) {
    if (!checkinMap.has(c.user_email)) {
      checkinMap.set(c.user_email, {
        expected_work_location: fmtPlannedLocations(c.planned_work_locations as WorkLocations | null),
        expected_work_time:     c.planned_start_time,
        attendance_record_type: c.attendance_record_type ?? '출근보고 진행 (주말출근, 휴가 포함)',
        expected_start_date:    c.leave_date,
      })
    }
  }

  // 팀별 그루핑
  const teamGroups = new Map<string, { division: string; team: string; users: typeof users }>()
  for (const u of users) {
    if (!u.division || !u.team) continue
    const key = `${u.division}||${u.team}`
    if (!teamGroups.has(key)) {
      teamGroups.set(key, { division: u.division, team: u.team, users: [] })
    }
    teamGroups.get(key)!.users.push(u)
  }

  // 본부별 내일자 캘린더 일정 미리 로드 (휴가 제외, 일반 events만)
  const allDepts = Array.from(new Set(Array.from(teamGroups.values()).map(g => g.division)))
  const calendarByDept = new Map<
    string,
    Map<string, Array<{ startTime: string | null; endTime: string | null; title: string }>>
  >()
  for (const dept of allDepts) {
    try {
      const result = await getDepartmentDailyParsed({ date: targetDate, department: dept })
      if (!result.enabled || result.fetchFailed) continue
      const byUser = new Map<string, Array<{ startTime: string | null; endTime: string | null; title: string }>>()
      for (const entry of result.entries) {
        if (entry.events && entry.events.length > 0) {
          byUser.set(entry.name, entry.events)
        }
      }
      calendarByDept.set(dept, byUser)
    } catch (err) {
      console.warn('[cron/reminder-22] calendar fetch failed for dept:', dept, err)
    }
  }

  // 팀별 발송
  const promises = Array.from(teamGroups.values()).map(group => {
    const members = group.users.map(u => {
      const c = checkinMap.get(u.email)
      return {
        name:   u.display_name || u.email,
        division: u.division || '미입력',
        team: u.team || '미입력',
        scheduledWorkDate: c?.expected_start_date || targetDate,
        scheduledWorkTime: c?.expected_work_time || '',
        scheduledWorkLocation: c?.expected_work_location || '미입력',
        attendanceRecordType: c?.attendance_record_type || '미입력',
        status: formatNightlyCheckinStatus(c), // fallback
        hasReport: !!c,
      }
    })

    // 이 팀(=division)에 속한 사용자들의 내일 캘린더 일정 모음
    const deptCalendar = calendarByDept.get(group.division)
    const calendarEvents: Array<{
      name: string
      startTime: string | null
      endTime: string | null
      title: string
    }> = []
    if (deptCalendar) {
      for (const u of group.users) {
        const userName = u.display_name?.trim()
        if (!userName) continue
        const events = deptCalendar.get(userName)
        if (!events) continue
        for (const ev of events) {
          calendarEvents.push({
            name: userName,
            startTime: ev.startTime,
            endTime: ev.endTime,
            title: ev.title,
          })
        }
      }
    }

    return notifyDailyCheckinReminder('daily_checkin_reminder_22', {
      division:   group.division,
      team:       group.team,
      targetDate,
      members,
      calendarEvents,
    })
  })

  await Promise.allSettled(promises)

  return NextResponse.json({ ok: true, targetDate, teamCount: teamGroups.size, userCount: users.length })
}
