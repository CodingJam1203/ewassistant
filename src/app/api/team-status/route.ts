import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getKstTodayDateString } from '@/lib/utils/date'
import type { WorkLocationTimeline } from '@/types/work-location-timeline'

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
}

// ─── 상태/색상 계산 ───────────────────────────────────────────────────────────

function computeStatus(
  workLog: Record<string, unknown> | null,
  daily: Record<string, unknown> | null
): { color: 'green' | 'yellow' | 'red'; status_text: string; status: string } {
  const hasLog = !!workLog
  const checkedIn = !!(daily?.checked_in_at)
  const checkedOut = !!(daily?.checked_out_at)
  const onBreak = !!(daily?.is_on_break)

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
    const filterDivision = searchParams.get('division') ?? ''
    const filterTeam = searchParams.get('team') ?? ''

    const adminClient = createAdminClient()

    // ── 로그인 유저 프로필 조회 ────────────────────────────────────────────────
    const { data: myProfile } = await adminClient
      .from('user_profiles')
      .select('email, division, team, display_name, display_order')
      .eq('email', user.email!)
      .single()

    const targetDivision = filterDivision || myProfile?.division || ''
    const targetTeam     = filterTeam     || myProfile?.team     || ''

    // ── 대상 팀원 목록 조회 ────────────────────────────────────────────────────
    let profileQuery = adminClient
      .from('user_profiles')
      .select('id, email, display_name, division, team, display_order, is_active')
      .eq('is_active', true)

    if (targetDivision) profileQuery = profileQuery.eq('division', targetDivision)
    if (targetTeam)     profileQuery = profileQuery.eq('team',     targetTeam)

    const { data: profiles, error: profileErr } = await profileQuery
    if (profileErr) throw profileErr

    if (!profiles || profiles.length === 0) {
      return NextResponse.json([])
    }

    const emails = profiles.map((p: { email: string }) => p.email)

    // ── 해당 날짜 work_logs 일괄 조회 ─────────────────────────────────────────
    const { data: workLogs } = await adminClient
      .from('work_logs')
      .select('id, user_email, start_time, end_time, work_location, work_content, location_history, work_location_timeline, leave_date')
      .in('user_email', emails)
      .eq('leave_date', dateParam)
      .eq('is_deleted', false)
      .order('created_at', { ascending: false })

    // email → 최신 work_log 매핑 (같은 날짜에 복수 제출 가능성 → 최신 1건)
    const workLogByEmail = new Map<string, Record<string, unknown>>()
    for (const log of (workLogs ?? [])) {
      if (!workLogByEmail.has(log.user_email)) {
        workLogByEmail.set(log.user_email, log as Record<string, unknown>)
      }
    }

    // ── 해당 날짜 daily_work_status 일괄 조회 ─────────────────────────────────
    const { data: dailyStatuses } = await adminClient
      .from('daily_work_status')
      .select('*')
      .in('user_email', emails)
      .eq('work_date', dateParam)

    const dailyByEmail = new Map<string, Record<string, unknown>>()
    for (const ds of (dailyStatuses ?? [])) {
      dailyByEmail.set(ds.user_email, ds as Record<string, unknown>)
    }

    // ── 마지막 이벤트 시각 조회 ────────────────────────────────────────────────
    const { data: lastEvents } = await adminClient
      .from('work_status_events')
      .select('user_email, event_at')
      .in('user_email', emails)
      .eq('work_date', dateParam)
      .order('event_at', { ascending: false })

    const lastEventByEmail = new Map<string, string>()
    for (const ev of (lastEvents ?? [])) {
      if (!lastEventByEmail.has(ev.user_email)) {
        lastEventByEmail.set(ev.user_email, ev.event_at)
      }
    }

    // ── 카드 조립 ──────────────────────────────────────────────────────────────
    const cards: TeamMemberCard[] = profiles.map((profile: Record<string, unknown>) => {
      const email = profile.email as string
      const workLog = workLogByEmail.get(email) ?? null
      const daily   = dailyByEmail.get(email)   ?? null

      const { color, status_text, status } = computeStatus(workLog, daily)

      return {
        email,
        display_name:    (profile.display_name as string | null) ?? null,
        division:        (profile.division as string | null) ?? null,
        team:            (profile.team as string | null) ?? null,
        display_order:   (profile.display_order as number) ?? 999,
        is_self:         email === user.email,

        color,
        status_text,

        daily_status_id: daily ? (daily.id as string) : null,
        status,
        current_location: daily ? (daily.current_location as string | null) : null,
        checked_in_at:    daily ? (daily.checked_in_at as string | null) : null,
        checked_out_at:   daily ? (daily.checked_out_at as string | null) : null,
        break_started_at: daily ? (daily.break_started_at as string | null) : null,
        break_ended_at:   daily ? (daily.break_ended_at as string | null) : null,
        is_on_break:      daily ? !!(daily.is_on_break) : false,
        last_event_at:    lastEventByEmail.get(email) ?? null,

        work_log_id:      workLog ? (workLog.id as string) : null,
        start_time:       workLog ? (workLog.start_time as string | null) : null,
        end_time:         workLog ? (workLog.end_time as string | null) : null,
        work_location:    workLog ? (workLog.work_location as string | null) : null,
        work_content:     workLog ? (workLog.work_content as string | null) : null,
        location_history: (workLog?.location_history as LocationHistoryEntry[]) ?? [],
        work_location_timeline:
          (workLog?.work_location_timeline as WorkLocationTimeline | null | undefined) ?? null,
      }
    })

    // ── 정렬: 본인 맨 앞 → display_order 오름차순 → display_name 순 ──────────
    cards.sort((a, b) => {
      if (a.is_self && !b.is_self) return -1
      if (!a.is_self && b.is_self) return 1
      if (a.display_order !== b.display_order) return a.display_order - b.display_order
      return (a.display_name ?? a.email).localeCompare(b.display_name ?? b.email)
    })

    return NextResponse.json(cards)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
