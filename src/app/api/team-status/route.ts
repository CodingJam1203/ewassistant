import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getKstTodayDateString } from '@/lib/utils/date'
import { getCalendarForDate, parseCell, isCalendarEnabled } from '@/lib/leave-calendar'
import type { WorkLocationTimeline } from '@/types/work-location-timeline'
import type { WorkLocations } from '@/types/work-locations-v2'
import { normalizeWorkLocations } from '@/lib/work-locations-v2'
import type { LeaveTimeline, LeaveType } from '@/types/leave-timeline'
import type { CalendarBatchResponse, CalendarEventChunk } from '@/types/leave-calendar'

// ─── 타입 ────────────────────────────────────────────────────────────────────

export interface LocationHistoryEntry {
  time: string
  location: string
  source: 'initial' | 'status_change' | 'log_update'
}

export interface TeamMemberCard {
  // 프로필
  email: string
  display_name: string | null
  division: string | null
  team: string | null
  display_order: number
  is_self: boolean

  // 계산된 상태
  color: 'green' | 'yellow' | 'red'
  status_text: string

  // daily_work_status
  daily_status_id: string | null
  status: string
  current_location: string | null
  current_location_index: number | null
  checked_in_at: string | null
  checked_out_at: string | null
  break_started_at: string | null
  break_ended_at: string | null
  is_on_break: boolean
  last_event_at: string | null

  // work_log
  work_log_id: string | null
  start_time: string | null     // 출근 예정시간 (EW 시작)
  end_time: string | null       // 퇴근 예정시간 (EW 종료)
  work_location: string | null
  work_content: string | null
  location_history: LocationHistoryEntry[]
  /** 오늘 실제 근무장소 타임라인 (퇴근보고 모달 prefill용) */
  work_location_timeline: WorkLocationTimeline | null
  /** v2: 실제 근무장소 칩 배열 (NULL = planned와 동일) */
  actual_work_locations: WorkLocations | null
  /** v2: 예정 근무장소 칩 배열 */
  planned_work_locations: WorkLocations | null
  /** 오늘 휴가/반차 타임라인 */
  leave_timeline: LeaveTimeline | null
  /** 휴게 자동 누적 — 퇴근보고 폼 prefill용 */
  break_auto_actual_minutes: number | null
  break_auto_rounded_minutes: number | null
  /** 외부 캘린더(Google Sheets) 휴가 판정 — work_log 없을 때 카드 배지 표시용 */
  calendar_leave_type: LeaveType | null
  calendar_leave_label: string | null
  /** 외부 캘린더(Google Sheets) 일반 일정 — 카드에 표시 */
  calendar_events: CalendarEventChunk[]

  /**
   * 팀 설정: 출근 후 [출근 완료] 버튼 사용 여부.
   *  - true (기본): 출근보고 → 별도 [출근 완료] 클릭 → 근무 중
   *  - false : 출근보고 제출 시 자동으로 출근 처리됨. [출근 완료] 버튼 숨김.
   *           프로필에 팀 매칭 안 되면 true (기본).
   */
  use_check_in_complete: boolean
}

// ─── 상태/색상 계산 ───────────────────────────────────────────────────────────

function computeStatus(
  workLog: (Record<string, unknown> & { _expectedOnly?: boolean }) | null,
  daily: Record<string, unknown> | null,
  calendarLeaveType: LeaveType | null = null,
): { color: 'green' | 'yellow' | 'red'; status_text: string; status: string } {
  const hasLog = !!workLog
  const isExpectedOnly = !!workLog?._expectedOnly
  const checkedIn = !!(daily?.checked_in_at)
  const checkedOut = !!(daily?.checked_out_at)
  const onBreak = !!(daily?.is_on_break)

  // work_log.leave_timeline 또는 expected_leave_timeline에 종일 휴가가 있으면 휴가로 인식
  const leaveTimeline =
    (workLog?.leave_timeline as Array<{ leaveType?: string }> | null | undefined) ??
    (workLog?.expected_leave_timeline as Array<{ leaveType?: string }> | null | undefined)
  const hasFullDayLeave =
    Array.isArray(leaveTimeline) && leaveTimeline.some(it => it?.leaveType === 'full_day')

  // 출근보고만 작성된 상태 (다른 날 미리 작성한 사전 보고) — 카드에 yellow + "출근보고 작성됨"
  if (isExpectedOnly && !checkedIn) {
    if (hasFullDayLeave) {
      return { color: 'yellow', status_text: '휴가', status: 'on_leave' }
    }
    return { color: 'yellow', status_text: '출근보고 작성됨', status: 'expected_only' }
  }

  // 캘린더에 종일 휴가가 있고 N-Click 보고가 없으면 → 휴가 상태로 표시
  // (반차는 결국 출근보고가 필요하므로 별도 처리하지 않음 — '미제출'로 두고 카드에 반차 배지만)
  if (calendarLeaveType === 'full_day' && !hasLog && !checkedIn) {
    return { color: 'yellow', status_text: '휴가', status: 'on_leave' }
  }

  // 종일 휴가가 work_log에 명시된 경우 — checkedIn 여부와 무관하게 '휴가' 우선.
  // (휴가 중 잠깐 일한 케이스: 일관성을 위해 휴가 표시 — 사용자는 작업 위치 chip에서 추가 정보 확인 가능.)
  if (hasFullDayLeave) {
    return { color: 'yellow', status_text: '휴가', status: 'on_leave' }
  }

  // 둘 다 없음 → 빨간색
  if (!hasLog && !daily) {
    return { color: 'red', status_text: '미제출', status: 'not_reported' }
  }

  // 출근 체크인 상태
  if (checkedIn) {
    if (checkedOut) {
      return { color: 'yellow', status_text: '퇴근', status: 'checked_out' }
    }
    if (onBreak) {
      return { color: 'green', status_text: '휴게 중', status: 'on_break' }
    }
    return { color: 'green', status_text: '근무 중', status: 'working' }
  }

  // 출퇴근보고는 있으나 출근 버튼 미클릭
  if (hasLog) {
    const content = String(workLog?.work_content ?? '').toLowerCase()
    const hasLeave = ['휴가', '연차', '반차', '외출'].some(k => content.includes(k))
    if (hasLeave) {
      return { color: 'yellow', status_text: '보고 완료', status: 'reported' }
    }
    return { color: 'yellow', status_text: '보고 완료', status: 'reported' }
  }

  // daily_status만 있고 check_in 없음 (비정상 상태)
  return { color: 'yellow', status_text: '확인 필요', status: 'reported' }
}

// ─── GET /api/team-status ─────────────────────────────────────────────────────
// Query params: date (YYYY-MM-DD), division, team

export async function GET(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const dateParam = searchParams.get('date') ?? getKstTodayDateString()
    let filterDivision = searchParams.get('division') ?? ''
    let filterTeam = searchParams.get('team') ?? ''
    // mine=true → 본인 카드 1건만 (홈 페이지용 — 응답 크기/쿼리 시간 최소화)
    const mineOnly = searchParams.get('mine') === 'true'
    // mine_team=true → 서버가 본인 division/team을 자체 조회 후 필터 적용.
    //   → 클라이언트가 /api/auth/profile 응답 대기 없이 곧장 호출 가능 (1 RTT 절약).
    //   → division/team 명시 시 mine_team 무시 (사용자가 직접 필터 변경한 경우).
    const mineTeam = searchParams.get('mine_team') === 'true'

    const adminClient = createAdminClient()

    // mineTeam 처리 — 본인 user_profile 조회 후 division/team으로 채움
    if (mineTeam && !mineOnly && !filterDivision && !filterTeam) {
      const { data: me } = await adminClient
        .from('user_profiles')
        .select('division, team')
        .eq('email', user.email!)
        .maybeSingle()
      if (me?.division) filterDivision = me.division as string
      if (me?.team)     filterTeam     = me.team as string
      // 본부/팀 정보 없으면 본인 카드만이라도 반환 (빈 응답 방지)
      if (!filterDivision && !filterTeam) {
        // mineOnly와 동일 효과 — 본인 한 명만
      }
    }

    // ── 대상 팀원 목록 조회 ────────────────────────────────────────────────────
    // 빈 division/team = 전체 (본인 본부/팀으로 fallback하지 않음)
    // 일반 사용자도 전체 조직 카드 조회 가능 — 권한 제약 없음
    // mineOnly=true → 본인 1명만
    let profileQuery = adminClient
      .from('user_profiles')
      .select('id, email, display_name, division, team, display_order, is_active')
      .eq('is_active', true)

    if (mineOnly) {
      profileQuery = profileQuery.eq('email', user.email!)
    } else if (mineTeam && !filterDivision && !filterTeam) {
      // mine_team 인데 본인 profile에 division/team 둘 다 없는 케이스 — 본인만이라도
      profileQuery = profileQuery.eq('email', user.email!)
    } else {
      if (filterDivision) profileQuery = profileQuery.eq('division', filterDivision)
      if (filterTeam)     profileQuery = profileQuery.eq('team',     filterTeam)
    }

    const { data: profiles, error: profileErr } = await profileQuery
    if (profileErr) throw profileErr

    if (!profiles || profiles.length === 0) {
      return NextResponse.json([])
    }

    const emails = profiles.map((p: { email: string }) => p.email)

    // ── 모든 부수 데이터를 병렬로 조회 (profiles 이후 emails만 의존) ─────────
    //   work_logs(leave/expected), daily_work_status, work_status_events, calendarBatch
    //   직렬 5번 → Promise.all 1번 ≈ 단일 가장 느린 쿼리 시간 ≈ 80%↓
    const SELECT_COLS = 'id, user_email, start_time, end_time, work_location, work_content, location_history, work_location_timeline, leave_timeline, expected_work_location_timeline, expected_leave_timeline, break_auto_actual_minutes, break_auto_rounded_minutes, leave_date, expected_start_date, expected_work_time, expected_work_location, planned_work_locations, actual_work_locations'

    const [
      workLogsLeaveRes,
      workLogsExpectedRes,
      dailyStatusesRes,
      lastEventsRes,
      calendarBatchRes,
      orgTeamsRes,
      orgDivisionsRes,
    ] = await Promise.all([
      adminClient
        .from('work_logs')
        .select(SELECT_COLS)
        .in('user_email', emails)
        .eq('leave_date', dateParam)
        .eq('is_deleted', false)
        .order('created_at', { ascending: false }),
      adminClient
        .from('work_logs')
        .select(SELECT_COLS)
        .in('user_email', emails)
        .eq('expected_start_date', dateParam)
        .eq('is_deleted', false)
        .order('created_at', { ascending: false }),
      adminClient
        .from('daily_work_status')
        .select('*')
        .in('user_email', emails)
        .eq('work_date', dateParam),
      adminClient
        .from('work_status_events')
        .select('user_email, event_at')
        .in('user_email', emails)
        .eq('work_date', dateParam)
        .order('event_at', { ascending: false }),
      isCalendarEnabled()
        ? getCalendarForDate(dateParam).catch(err => {
            console.warn('[team-status] calendar fetch failed:', err)
            return null as CalendarBatchResponse | null
          })
        : Promise.resolve(null as CalendarBatchResponse | null),
      adminClient.from('org_teams').select('division_id, name, use_check_in_complete'),
      adminClient.from('org_divisions').select('id, name'),
    ])

    // 팀별 use_check_in_complete 매핑 — (division_name, team_name) → boolean
    const divIdToName = new Map<string, string>()
    for (const d of ((orgDivisionsRes.data ?? []) as Array<{ id: string; name: string }>)) {
      divIdToName.set(d.id, d.name)
    }
    const teamSettings = new Map<string, boolean>()
    for (const t of ((orgTeamsRes.data ?? []) as Array<{ division_id: string; name: string; use_check_in_complete: boolean | null }>)) {
      const divName = divIdToName.get(t.division_id)
      if (!divName) continue
      teamSettings.set(`${divName}::${t.name}`, t.use_check_in_complete ?? true)
    }

    const workLogsLeave    = workLogsLeaveRes.data
    const workLogsExpected = workLogsExpectedRes.data
    const dailyStatuses    = dailyStatusesRes.data
    const lastEvents       = lastEventsRes.data
    const calendarBatch    = calendarBatchRes

    // email → work_log 매핑. (A) 우선. (B)인 경우 _expectedOnly=true 표식.
    const workLogByEmail = new Map<string, Record<string, unknown> & { _expectedOnly?: boolean }>()
    for (const log of (workLogsLeave ?? [])) {
      if (!workLogByEmail.has(log.user_email)) {
        workLogByEmail.set(log.user_email, log as Record<string, unknown>)
      }
    }
    for (const log of (workLogsExpected ?? [])) {
      if (!workLogByEmail.has(log.user_email)) {
        workLogByEmail.set(log.user_email, { ...log, _expectedOnly: true } as Record<string, unknown> & { _expectedOnly: boolean })
      }
    }

    const dailyByEmail = new Map<string, Record<string, unknown>>()
    for (const ds of (dailyStatuses ?? [])) {
      dailyByEmail.set(ds.user_email, ds as Record<string, unknown>)
    }

    const lastEventByEmail = new Map<string, string>()
    for (const ev of (lastEvents ?? [])) {
      if (!lastEventByEmail.has(ev.user_email)) {
        lastEventByEmail.set(ev.user_email, ev.event_at)
      }
    }

    /** 사용자 이름 + 본부로 캘린더 셀 조회 → 휴가/일반일정 파싱 (events 포함) */
    function lookupCalendar(division: string | null, displayName: string | null): {
      leaveType: LeaveType | null
      label: string | null
      events: CalendarEventChunk[]
    } {
      if (!calendarBatch || !division || !displayName) {
        return { leaveType: null, label: null, events: [] }
      }
      const entries = calendarBatch.departments?.[division] ?? []
      const target = entries.find(e => e.name?.trim() === displayName.trim())
      if (!target) return { leaveType: null, label: null, events: [] }
      const parsed = parseCell(target.cellValue)
      return {
        leaveType: parsed.leaveType,
        label: parsed.leaveType ? target.cellValue.trim() : null,
        events: parsed.events ?? [],
      }
    }

    // ── 카드 조립 ──────────────────────────────────────────────────────────────
    const cards: TeamMemberCard[] = profiles.map((profile: Record<string, unknown>) => {
      const email = profile.email as string
      const workLog = workLogByEmail.get(email) ?? null
      const daily   = dailyByEmail.get(email)   ?? null

      const division = (profile.division as string | null) ?? null
      const displayName = (profile.display_name as string | null) ?? null
      const calLeave = lookupCalendar(division, displayName)

      const { color, status_text, status } = computeStatus(workLog, daily, calLeave.leaveType)

      // expected_start_date 매칭으로 잡힌 work_log는 출근보고 정보를 본문 필드로 노출
      const isExpectedOnly = !!workLog?._expectedOnly
      const startTime = workLog
        ? (isExpectedOnly
            ? (workLog.expected_work_time as string | null) ?? null
            : (workLog.start_time as string | null))
        : null
      // 퇴근예정: isExpectedOnly면 expected_work_location_timeline의 마지막 checkout 항목 시각,
      //          아니면 work_log.end_time
      const expectedTimelineEndItem = (() => {
        const tl = workLog?.expected_work_location_timeline as
          | Array<{ kind?: string; startTime?: string }>
          | null | undefined
        if (!Array.isArray(tl) || tl.length === 0) return null
        const last = tl[tl.length - 1]
        if (last?.kind === 'expected_checkout' || last?.kind === 'checkout') {
          return last.startTime ?? null
        }
        return null
      })()
      const endTime = workLog
        ? (isExpectedOnly
            ? (expectedTimelineEndItem ?? null)
            : (workLog.end_time as string | null))
        : null
      const workLocation = workLog
        ? (isExpectedOnly
            ? (workLog.expected_work_location as string | null) ?? null
            : (workLog.work_location as string | null))
        : null
      const workLocationTimeline = workLog
        ? (isExpectedOnly
            ? (workLog.expected_work_location_timeline as WorkLocationTimeline | null | undefined) ?? null
            : (workLog.work_location_timeline as WorkLocationTimeline | null | undefined) ?? null)
        : null
      const leaveTimeline = workLog
        ? (isExpectedOnly
            ? (workLog.expected_leave_timeline as LeaveTimeline | null | undefined) ?? null
            : (workLog.leave_timeline as LeaveTimeline | null | undefined) ?? null)
        : null

      return {
        email,
        display_name:    displayName,
        division:        division,
        team:            (profile.team as string | null) ?? null,
        display_order:   (profile.display_order as number) ?? 999,
        is_self:         email === user.email,

        color,
        status_text,

        daily_status_id: daily ? (daily.id as string) : null,
        status,
        current_location: daily ? (daily.current_location as string | null) : null,
        current_location_index: daily ? ((daily.current_location_index as number | null) ?? null) : null,
        checked_in_at:    daily ? (daily.checked_in_at as string | null) : null,
        checked_out_at:   daily ? (daily.checked_out_at as string | null) : null,
        break_started_at: daily ? (daily.break_started_at as string | null) : null,
        break_ended_at:   daily ? (daily.break_ended_at as string | null) : null,
        is_on_break:      daily ? !!(daily.is_on_break) : false,
        last_event_at:    lastEventByEmail.get(email) ?? null,

        work_log_id:      workLog ? (workLog.id as string) : null,
        start_time:       startTime,
        end_time:         endTime,
        work_location:    workLocation,
        work_content:     workLog && !isExpectedOnly ? (workLog.work_content as string | null) : null,
        location_history: (workLog?.location_history as LocationHistoryEntry[]) ?? [],
        work_location_timeline: workLocationTimeline,
        actual_work_locations: workLog ? normalizeWorkLocations(workLog.actual_work_locations) : null,
        planned_work_locations: workLog ? normalizeWorkLocations(workLog.planned_work_locations) : null,
        leave_timeline:         leaveTimeline,
        break_auto_actual_minutes:
          (workLog?.break_auto_actual_minutes as number | null | undefined) ?? null,
        break_auto_rounded_minutes:
          (workLog?.break_auto_rounded_minutes as number | null | undefined) ?? null,
        calendar_leave_type:  calLeave.leaveType,
        calendar_leave_label: calLeave.label,
        calendar_events:      calLeave.events,

        use_check_in_complete: teamSettings.get(`${division ?? ''}::${(profile.team as string | null) ?? ''}`) ?? true,
      }
    })

    cards.sort((a, b) => {
      if (a.is_self && !b.is_self) return -1
      if (!a.is_self && b.is_self) return 1
      if (a.display_order !== b.display_order) return a.display_order - b.display_order
      return (a.display_name ?? a.email).localeCompare(b.display_name ?? b.email)
    })

    return NextResponse.json(cards, {
      headers: {
        // mine=true (홈 헤더 카드)는 자주 바뀌지만 새로 빌렸을 때 짧은 캐시로
        // 같은 페이지 안에서 여러 번 호출되어도 한 번만 실제 fetch가 되도록.
        // 사용자가 출근/퇴근/휴게 클릭하면 명시적으로 fetchMyCard()로 재호출되니 OK.
        'Cache-Control': mineOnly
          ? 'private, max-age=10, stale-while-revalidate=60'
          : 'private, max-age=5, stale-while-revalidate=30',
      },
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[/api/team-status]', message)
    return NextResponse.json({ error: '서버 에러가 발생했습니다.' }, { status: 500 })
  }
}
