/**
 * GET /api/cron/reminder-20
 * 매일 20:00 KST (11:00 UTC) — 다음 날짜 출근보고 현황 발송
 * 팀별로 라우팅 테이블을 사용해 각 팀의 출근보고 스레드에 개별 발송
 */

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { notifyDailyCheckinReminder } from '@/lib/notifications/teams'
import { resolveRoutingTeam } from '@/lib/org'
import { formatNightlyCheckinStatus } from '@/lib/notifications/messages'
import { resolveDisplayLocations, formatChipsArrow } from '@/lib/work-locations-v2'
import { isWeekendDate } from '@/lib/utils/date'
import { isKoreanHoliday } from '@/lib/kr-holidays'
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
    console.error('[cron/reminder-20] CRON_SECRET env not set — rejecting all requests')
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
  // 출근보고 작성 신호: planned_start_time NOT NULL (미보고 토글 OFF + 입력)
  const { data: checkins } = await adminClient
    .from('work_logs')
    .select('user_email, planned_start_time, planned_end_time, planned_work_locations, leave_timeline, attendance_record_type, leave_date, created_at')
    .eq('leave_date', targetDate)
    .eq('is_deleted', false)
    .not('planned_start_time', 'is', null)
    .order('created_at', { ascending: false })

  // 메시지 빌드가 기대하는 옛 필드명(expected_work_location/expected_work_time)로 매핑.
  // 새 컬럼 → 호환 필드 변환만, 메시지 함수 자체는 무변경.
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
        expected_work_time:     c.planned_start_time,   // HH:MM:SS — fmtTime이 trim 처리
        expected_end_time:      c.planned_end_time,
        attendance_record_type: c.attendance_record_type ?? '출근보고 진행 (주말출근, 휴가 포함)',
        expected_start_date:    c.leave_date,
      })
    }
  }

  // 팀별 그루핑.
  // 본부 직속(team 없음)은 admin 지정 notify_team으로 effective team을 잡아 해당 팀 그룹에 합류.
  // division도 notify_team도 없으면 제외.
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

  // 팀별 발송
  const promises = Array.from(teamGroups.values()).map(group => {
    const members = group.users.map(u => {
      const c = checkinMap.get(u.email)
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
      }
    })
    // 비근무일(토/일/한국 공휴일) 출근일 + 출근보고 작성자 0명 → 그 팀 알림 스킵.
    // v1.46: 공휴일(대체공휴일 포함) 추가.
    if ((isWeekendDate(targetDate) || isKoreanHoliday(targetDate)) && members.every(m => !m.hasReport)) return null
    return notifyDailyCheckinReminder('daily_checkin_reminder_20', {
      division:   group.division,
      team:       group.team,
      targetDate,
      members,
    })
  }).filter((p): p is Promise<void> => p !== null)

  await Promise.allSettled(promises)

  return NextResponse.json({ ok: true, targetDate, teamCount: teamGroups.size, userCount: users.length })
}
