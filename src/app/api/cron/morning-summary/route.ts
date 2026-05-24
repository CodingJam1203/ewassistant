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
import { resolveRoutingTeam } from '@/lib/org'
import { formatMorningWorklogStatus, formatMorningCheckinStatus } from '@/lib/notifications/messages'
import { fetchOrgCalendarLookup } from '@/lib/org-calendar/lookup'
import { parseLeaveLabel } from '@/lib/leave-timeline'
import type { LeaveType, LeaveTimeline } from '@/types/leave-timeline'
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

interface UserRow {
  email: string
  display_name: string | null
  division: string | null
  team: string | null
  notify_team: string | null
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
    .select('email, display_name, division, team, notify_team, display_order')
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
  // Stage 0-4a 단일 row 모델: 옛 분리 모델(expected_start_date='오늘') 쿼리는 deprecate.
  // todayDate의 work_log row를 leave_date 기준으로 찾고, planned_*를 expected_* 자리에 매핑.
  const { data: checkinsRaw } = await adminClient
    .from('work_logs')
    .select('user_email, planned_start_time, planned_end_time, planned_work_locations, leave_timeline, expected_leave_timeline, created_at')
    .eq('leave_date', todayDate)
    .eq('is_deleted', false)
    .not('planned_start_time', 'is', null)
    .order('created_at', { ascending: false })

  // 메시지 빌드(formatMorningCheckinStatus)가 기대하는 옛 필드명으로 매핑
  const checkins = (checkinsRaw ?? []).map(c => ({
    user_email: c.user_email,
    expected_work_location: fmtPlannedLocations(c.planned_work_locations as WorkLocations | null),
    expected_work_time:     c.planned_start_time,
    expected_end_time:      c.planned_end_time,
    leave_timeline:         c.leave_timeline,
    expected_leave_timeline: c.expected_leave_timeline,
    created_at:             c.created_at,
  }))

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
    expected_end_time: string | null
    expected_leave_timeline: LeaveTimeline | null
  }
  const checkinMap = new Map<string, CheckinInfo>()
  for (const c of checkins ?? []) {
    if (!checkinMap.has(c.user_email)) {
      checkinMap.set(c.user_email, {
        expected_work_location: c.expected_work_location,
        expected_work_time:     c.expected_work_time,
        expected_end_time:      c.expected_end_time,
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

  // ─── 어제 퇴근보고 — 메시지 하단 표시용 ─────────────────────────────────
  // 정책서 §2 시간 4종 분리 — 표시·야근 판정의 SoT는 actual_start_time/actual_end_time.
  // legacy start_time/end_time(=출근예정/퇴근예정)은 actual_*가 NULL일 때만 fallback (구 row 보호).
  const { data: workLogs } = await adminClient
    .from('work_logs')
    .select('user_email, start_time, end_time, actual_start_time, actual_end_time, break_time, work_location, work_type_code, created_at')
    .eq('leave_date', yesterdayDate)
    .eq('is_deleted', false)
    .order('created_at', { ascending: false })

  // 'HH:mm:ss' → 'HH:mm:ss' 또는 NULL 정규화 (DB time 컬럼은 'HH:mm:ss' 문자열로 반환됨)
  const pickActualTime = (actual: string | null, legacy: string | null): string | null => {
    if (actual && actual.length >= 4) return actual
    if (legacy && legacy.length >= 4) return legacy
    return null
  }

  const workLogMap = new Map<string, { start_time: string | null; end_time: string | null; break_time: string; work_location: string; work_type_code: number | null }>()
  for (const w of workLogs ?? []) {
    if (!workLogMap.has(w.user_email)) {
      workLogMap.set(w.user_email, {
        start_time:    pickActualTime(w.actual_start_time as string | null, w.start_time as string | null),
        end_time:      pickActualTime(w.actual_end_time   as string | null, w.end_time   as string | null),
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
  const OVERTIME_THRESHOLD_MIN = 480  // EW 실근무가 8h(=480분)를 초과하면 야근 (정확히 480분은 야근 아님)

  // ─── 외부 캘린더(Google Calendar) 휴가 조회 — email 기반 ────────────────────
  // Phase 1.5f: Sheets(Apps Script) → org_calendar_events. 매칭 안 된 이벤트는 제외.
  const calLookup = await fetchOrgCalendarLookup({
    adminClient,
    emails: users.map(u => u.email),
    dates: [todayDate],
  }).catch(err => {
    console.warn('[morning-summary] calendar lookup failed:', err)
    return null
  })

  // ─── 팀별 그루핑 ────────────────────────────────────────────────────────────
  // 본부 직속(team 없음)은 admin 지정 notify_team으로 effective team을 잡아 해당 팀 그룹에 합류 →
  // 그 팀 출근보고 채널 아침요약에 함께 노출. division도 notify_team도 없으면 제외.
  const teamGroups = new Map<string, { division: string; team: string; users: UserRow[] }>()
  for (const u of users) {
    const effTeam = resolveRoutingTeam(u.team, u.notify_team)
    if (!u.division || !effTeam) continue
    const key = `${u.division}||${effTeam}`
    if (!teamGroups.has(key)) {
      teamGroups.set(key, { division: u.division, team: effTeam, users: [] })
    }
    teamGroups.get(key)!.users.push(u)
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
      const calDay = calLookup?.byEmail.get(u.email.toLowerCase())?.[todayDate]
      const calendarHit = calDay?.leaveType
        ? { leaveType: calDay.leaveType, leaveLabel: calDay.leaveLabel }
        : null

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
        // 정책 v1.25: formatMorningCheckinStatus helper로 통일 — fmtTime이 초 절삭 + 앞 0 유지
        const status = (checkinInfo?.expected_work_location || checkinInfo?.expected_work_time)
          ? formatMorningCheckinStatus(checkinInfo ?? undefined)
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
        isOvertime: actualMin > OVERTIME_THRESHOLD_MIN,
      }
    })

    // 비근무일(토/일/한국 공휴일) + 출근보고 작성자(completedSection) 0명 → 그 팀 알림 스킵.
    // v1.46: 공휴일(대체공휴일 포함) 추가 — 평일이지만 공휴일이라 출근 안 함이 디폴트인 케이스 노이즈 제거.
    if ((isWeekendDate(todayDate) || isKoreanHoliday(todayDate)) && completedSection.length === 0) return null

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
  }).filter((p): p is Promise<void> => p !== null)

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
