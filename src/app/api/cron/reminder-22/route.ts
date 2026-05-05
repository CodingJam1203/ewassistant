/**
 * GET /api/cron/reminder-22
 * 매일 22:00 KST (13:00 UTC) — 다음 날짜 출근보고 현황 재발송
 * 팀별로 라우팅 테이블을 사용해 각 팀의 출근보고 스레드에 개별 발송
 */

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { notifyDailyCheckinReminder } from '@/lib/notifications/teams'
import { formatNightlyCheckinStatus } from '@/lib/notifications/messages'

function getKstDate(offsetDays = 0): string {
  const d = new Date(Date.now() + 9 * 60 * 60 * 1000)
  d.setUTCDate(d.getUTCDate() + offsetDays)
  return d.toISOString().slice(0, 10)
}

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  const secret = process.env.CRON_SECRET
  if (secret && authHeader !== `Bearer ${secret}`) {
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

  const { data: checkins } = await adminClient
    .from('work_logs')
    .select('user_email, expected_work_location, expected_work_time, attendance_record_type, expected_start_date, created_at')
    .eq('expected_start_date', targetDate)
    .eq('attendance_record_type', '출근보고 진행 (주말출근, 휴가 포함)')
    .eq('is_deleted', false)
    .order('created_at', { ascending: false })

  const checkinMap = new Map<string, any>()
  for (const c of checkins ?? []) {
    if (!checkinMap.has(c.user_email)) {
      checkinMap.set(c.user_email, {
        expected_work_location: c.expected_work_location,
        expected_work_time:     c.expected_work_time,
        attendance_record_type: c.attendance_record_type,
        expected_start_date:    c.expected_start_date,
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

  // 팀별 발송
  const promises = Array.from(teamGroups.values()).map(group => {
    const members = group.users.map(u => {
      const c = checkinMap.get(u.email) || {}
      return {
        name:   u.display_name || u.email,
        division: u.division || '미입력',
        team: u.team || '미입력',
        scheduledWorkDate: c.expected_start_date || targetDate,
        scheduledWorkTime: c.expected_work_time || '',
        scheduledWorkLocation: c.expected_work_location || '미입력',
        attendanceRecordType: c.attendance_record_type || '미입력',
        status: formatNightlyCheckinStatus(c) // fallback
      }
    })
    return notifyDailyCheckinReminder('daily_checkin_reminder_22', {
      division:   group.division,
      team:       group.team,
      targetDate,
      members,
    })
  })

  await Promise.allSettled(promises)

  return NextResponse.json({ ok: true, targetDate, teamCount: teamGroups.size, userCount: users.length })
}
