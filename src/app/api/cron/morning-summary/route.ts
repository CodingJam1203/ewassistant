/**
 * GET /api/cron/morning-summary
 * 매일 07:00 KST — 팀별로 오늘의 휴가/근무 현황 정리해서 출근보고 채널에 발송.
 *
 * 흐름:
 *   1. 외부 캘린더 강제 갱신 (Google Sheets → leave_calendar_cache)
 *   2. user_profiles + 오늘 work_logs(출근보고) + 어제 work_logs(퇴근보고) 일괄 조회
 *   3. 사용자별 휴가 판정 (N-Click 입력 + 캘린더, 어느 쪽이든 휴가면 휴가)
 *   4. 사람별 분류:
 *        🏖️ 휴가/반차 (종일 / 오전반차 / 오후반차)
 *        ✅ 출근보고 완료
 *        ⚠️ 출근보고 필요
 *        🕐 오후 출근보고 필요 (오전반차 후 오후 근무 예정자가 출근보고 미작성)
 *   5. 팀별 메시지 빌드 → notifyMorningSummary 발송
 */

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { notifyMorningSummary } from '@/lib/notifications/teams'
import { formatMorningWorklogStatus } from '@/lib/notifications/messages'
import { forceRefreshCalendar, getDepartmentDailyParsed } from '@/lib/leave-calendar'
import { parseLeaveLabel } from '@/lib/leave-timeline'
import type { LeaveType, LeaveTimeline } from '@/types/leave-timeline'

function getKstDate(offsetDays = 0): string {
  const d = new Date(Date.now() + 9 * 60 * 60 * 1000)
  d.setUTCDate(d.getUTCDate() + offsetDays)
  return d.toISOString().slice(0, 10)
}

interface UserRow {
  email: string
  display_name: string | null
  division: string | null
  team: string | null
  display_order: number | null
}

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  const secret = process.env.CRON_SECRET
  // FAIL-CLOSE: env가 비어있으면 무조건 거부 (이전엔 secret 미설정 시 모두 통과 — 심각한 취약점)
  if (!secret) {
    console.error('[cron/morning-summary] CRON_SECRET env not set — rejecting all requests')
    return NextResponse.json({ error: 'Server misconfiguration' }, { status: 500 })
  }
  if (authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (process.env.ENABLE_DAILY_REMINDER_NOTIFY === 'false') {
    return NextResponse.json({ skipped: true, reason: 'ENABLE_DAILY_REMINDER_NOTIFY=false' })
  }

  const todayDate     = getKstDate(0)
  const yesterdayDate = getKstDate(-1)

  const adminClient = createAdminClient()

  const { data: usersRaw } = await adminClient
    .from('user_profiles')
    .select('email, display_name, division, team, display_order')
    .eq('is_active', true)
    .order('display_order', { ascending: true, nullsFirst: false })
    .order('division', { ascending: true })
    .order('team', { ascending: true })
    .order('display_name', { ascending: true })

  const users: UserRow[] = (usersRaw ?? []) as UserRow[]
  if (users.length === 0) {
    return NextResponse.json({ skipped: true, reason: 'no active users' })
  }

  // ─── 오늘 출근보고(work_logs) 조회 — leave_timeline까지 ─────────────────────
  const { data: checkins } = await adminClient
    .from('work_logs')
    .select('user_email, expected_work_location, expected_work_time, leave_timeline, expected_leave_timeline, created_at')
    .eq('expected_start_date', todayDate)
    .eq('attendance_record_type', '출근보고 진행 (주말출근, 휴가 포함)')
    .eq('is_deleted', false)
    .order('created_at', { ascending: false })

  // 사용자가 직접 입력한 오늘의 work_log (오늘 leave_date 기준)
  const { data: todayLogs } = await adminClient
    .from('work_logs')
    .select('user_email, leave_timeline, work_location, start_time, end_time, created_at')
    .eq('leave_date', todayDate)
    .eq('is_deleted', false)
    .order('created_at', { ascending: false })

  interface CheckinInfo {
    expected_work_location: string | null
    expected_work_time: string | null
    expected_leave_timeline: LeaveTimeline | null
  }
  const checkinMap = new Map<string, CheckinInfo>()
  for (const c of checkins ?? []) {
    if (!checkinMap.has(c.user_email)) {
      checkinMap.set(c.user_email, {
        expected_work_location: c.expected_work_location,
        expected_work_time:     c.expected_work_time,
        expected_leave_timeline: (c.expected_leave_timeline as LeaveTimeline | null) ?? null,
      })
    }
  }

  interface TodayLogInfo {
    leave_timeline: LeaveTimeline | null
    work_location: string | null
  }
  const todayLogMap = new Map<string, TodayLogInfo>()
  for (const t of todayLogs ?? []) {
    if (!todayLogMap.has(t.user_email)) {
      todayLogMap.set(t.user_email, {
        leave_timeline: (t.leave_timeline as LeaveTimeline | null) ?? null,
        work_location:  t.work_location,
      })
    }
  }

  // ─── 어제 퇴근보고 — 메시지 하단 표시용 (기존 유지) ───────────────────────
  const { data: workLogs } = await adminClient
    .from('work_logs')
    .select('user_email, start_time, end_time, break_time, work_location, work_type_code, created_at')
    .eq('leave_date', yesterdayDate)
    .eq('is_deleted', false)
    .order('created_at', { ascending: false })

  const workLogMap = new Map<string, { start_time: string; end_time: string; break_time: string; work_location: string; work_type_code: number | null }>()
  for (const w of workLogs ?? []) {
    if (!workLogMap.has(w.user_email)) {
      workLogMap.set(w.user_email, {
        start_time:    w.start_time,
        end_time:      w.end_time,
        break_time:    w.break_time,
        work_location: w.work_location,
        work_type_code: typeof w.work_type_code === 'number' ? w.work_type_code : null,
      })
    }
  }

  /**
   * EW 실근무 시간 (분) 계산 — (퇴근-출근) - 점심(워크타입 기반) - 휴게.
   * 점심: 기본/간주(=1,2) = 60분, 공휴일(=3) = 0. workTypeCode 모르면 60 가정.
   * 명일 케이스 처리. 야근 판정용.
   */
  function computeActualMinutes(start: string | null, end: string | null, br: string | null, workTypeCode: number | null): number {
    if (!start || !end) return 0
    const toMin = (hhmm: string): number => {
      const [h, m] = hhmm.slice(0, 5).split(':').map(Number)
      return (h || 0) * 60 + (m || 0)
    }
    const lunchAuto = workTypeCode === 3 ? 0 : 60
    let mins = toMin(end) - toMin(start) - lunchAuto - toMin(br ?? '00:00')
    if (mins < 0) mins += 24 * 60
    return mins
  }
  const OVERTIME_THRESHOLD_MIN = 480  // EW 실근무 8h 이상이면 야근

  // ─── 외부 캘린더 강제 갱신 + 본부별 휴가자 조회 ───────────────────────────
  await forceRefreshCalendar(todayDate)

  // 본부별 캘린더 entries 캐시 (아래에서 user 매칭에 사용)
  const calendarByDeptUser = new Map<string, { leaveType: LeaveType | null; leaveLabel: string | null }>()
  // department -> already fetched
  const fetchedDepts = new Set<string>()
  async function ensureDepartmentLoaded(dept: string) {
    if (fetchedDepts.has(dept)) return
    fetchedDepts.add(dept)
    const result = await getDepartmentDailyParsed({ date: todayDate, department: dept })
    if (!result.enabled || result.fetchFailed) return
    for (const entry of result.entries) {
      calendarByDeptUser.set(`${dept}||${entry.name}`, {
        leaveType: entry.leaveType,
        leaveLabel: entry.leaveLabel,
      })
    }
  }

  // ─── 팀별 그루핑 ────────────────────────────────────────────────────────────
  const teamGroups = new Map<string, { division: string; team: string; users: UserRow[] }>()
  for (const u of users) {
    if (!u.division || !u.team) continue
    const key = `${u.division}||${u.team}`
    if (!teamGroups.has(key)) {
      teamGroups.set(key, { division: u.division, team: u.team, users: [] })
    }
    teamGroups.get(key)!.users.push(u)
  }

  // 본부별 캘린더 사전 로드
  const allDepts = Array.from(new Set(Array.from(teamGroups.values()).map(g => g.division)))
  for (const dept of allDepts) {
    await ensureDepartmentLoaded(dept)
  }

  // ─── 팀별 사용자 분류 + 발송 ───────────────────────────────────────────────
  const promises = Array.from(teamGroups.values()).map(group => {
    const leaveSection: Array<{ name: string; label: string; leaveType: LeaveType }> = []
    const completedSection: Array<{ name: string; status: string }> = []
    const needSection: Array<{ name: string }> = []
    const needAfterSection: Array<{ name: string; label: string }> = []

    for (const u of group.users) {
      const name = u.display_name || u.email
      const checkinInfo = checkinMap.get(u.email)
      const todayInfo = todayLogMap.get(u.email)

      // 휴가 판정 — 다음 우선순위:
      //   1) 오늘 work_logs의 leave_timeline 첫 항목
      //   2) 어제 work_logs의 expected_leave_timeline 첫 항목
      //   3) 외부 캘린더 셀 값
      let leaveType: LeaveType | null = null
      let leaveLabel: string | null = null
      const todayLeave = todayInfo?.leave_timeline?.[0]
      const expectedLeave = checkinInfo?.expected_leave_timeline?.[0]
      const calendarHit = u.division ? calendarByDeptUser.get(`${u.division}||${name}`) : null

      if (todayLeave) {
        leaveType = todayLeave.leaveType
        leaveLabel = todayLeave.label
      } else if (expectedLeave) {
        leaveType = expectedLeave.leaveType
        leaveLabel = expectedLeave.label
      } else if (calendarHit?.leaveType) {
        leaveType = calendarHit.leaveType
        leaveLabel = calendarHit.leaveLabel ?? '휴가'
        // 캘린더 라벨이 자유 텍스트면 표준 라벨로 보정
        const stdType = parseLeaveLabel(leaveLabel)
        if (stdType) leaveType = stdType
      }

      // 분류 — TypeScript narrowing을 위해 leaveType을 직접 비교
      const hasCheckin = !!checkinInfo

      if (leaveType === 'full_day') {
        // 종일 휴가 — 휴가 섹션만, 출근보고 필요 안 함
        leaveSection.push({ name, label: leaveLabel || '휴가', leaveType })
        continue
      }

      if (leaveType === 'morning_half' || leaveType === 'afternoon_half') {
        leaveSection.push({
          name,
          label: leaveLabel || (leaveType === 'morning_half' ? '오전반차' : '오후반차'),
          leaveType,
        })
      }

      if (hasCheckin) {
        const status = checkinInfo?.expected_work_location && checkinInfo?.expected_work_time
          ? `${checkinInfo.expected_work_location} ${checkinInfo.expected_work_time}~`
          : '작성됨'
        completedSection.push({ name, status })
      } else if (leaveType === 'morning_half') {
        // 오전반차 + 출근보고 미작성 → 오후 출근보고 필요
        needAfterSection.push({ name, label: leaveLabel || '오전반차' })
      } else {
        // 휴가 없음 / 오후반차이나 미작성 → 일반 출근보고 필요
        needSection.push({ name })
      }
    }

    const yesterdayWorkLogs = group.users.map(u => {
      const log = workLogMap.get(u.email)
      const actualMin = log
        ? computeActualMinutes(log.start_time, log.end_time, log.break_time, log.work_type_code)
        : 0
      return {
        name:   u.display_name || u.email,
        status: formatMorningWorklogStatus(log),
        isOvertime: actualMin >= OVERTIME_THRESHOLD_MIN,
      }
    })

    return notifyMorningSummary({
      division:   group.division,
      team:       group.team,
      todayDate,
      yesterdayDate,
      // 신규 4섹션
      leaveSection,
      completedSection,
      needSection,
      needAfterSection,
      // 어제 퇴근보고 (기존 표시 유지)
      yesterdayWorkLogs,
      // legacy 필드는 빈 배열로 유지 (타입 호환)
      todayCheckins: completedSection.map(c => ({ name: c.name, status: c.status })),
    })
  })

  await Promise.allSettled(promises)

  return NextResponse.json({
    ok: true,
    todayDate,
    yesterdayDate,
    teamCount: teamGroups.size,
    userCount: users.length,
    calendarEnabled: !!process.env.LEAVE_CALENDAR_WEBHOOK_URL,
  })
}
