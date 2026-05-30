/**
 * GET /api/team-status/calendar-events?date=YYYY-MM-DD
 *
 * 현재 로그인 사용자의 외부 Google Sheets 캘린더 일정 조회.
 * - CheckInModal/WorkLogForm에서 호출
 * - 휴가 키워드는 leaveType + leaveLabel
 * - 일반 일정은 events 배열
 * - DB 캐시(leave_calendar_cache) 우선, 만료 시에만 Apps Script 호출
 *
 * env LEAVE_CALENDAR_WEBHOOK_URL 미설정 시 enabled=false 반환.
 */
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getKstTodayDateString } from '@/lib/utils/date'
import { getUserCalendarLookup, isCalendarEnabled } from '@/lib/leave-calendar'
import type { UserCalendarLookup } from '@/types/leave-calendar'

export async function GET(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const date = searchParams.get('date') ?? getKstTodayDateString()

    // 캘린더 연동 비활성 시 즉시 빈 결과 반환
    if (!isCalendarEnabled()) {
      const empty: UserCalendarLookup = {
        enabled: false,
        leaveType: null,
        leaveLabel: null,
        events: [],
        raw: null,
      }
      return NextResponse.json(empty)
    }

    // 사용자 본부/이름 + team의 calendar_mode 조회 (시트 매칭 분기용)
    const adminClient = createAdminClient()
    const { data: profile } = await adminClient
      .from('user_profiles')
      .select('display_name, division, team')
      .eq('email', user.email!)
      .single()

    if (!profile?.display_name || !profile?.division) {
      const empty: UserCalendarLookup = {
        enabled: true,
        leaveType: null,
        leaveLabel: null,
        events: [],
        raw: null,
      }
      return NextResponse.json(empty)
    }

    // v1.61.8 — 사용자 본부에 active sheet_source 매핑 있을 때만 시트 lookup.
    // 운영 의도: sheet_source_id 매핑이 시트 운영 의도의 source-of-truth.
    // calendar_mode는 admin 미설정 default(none)일 수 있어 신뢰 X.
    // 매핑 없는 본부(예: HR임팩트본부 - 전 팀 sheet_source_id 없음)면 시트 lookup skip.
    let hasSheetSource = false
    {
      const { data: div } = await adminClient
        .from('org_divisions')
        .select('id')
        .eq('name', profile.division)
        .maybeSingle()
      if (div) {
        const { count } = await adminClient
          .from('org_sheet_sources')
          .select('id', { count: 'exact', head: true })
          .eq('division_id', div.id)
          .eq('is_active', true)
        hasSheetSource = (count ?? 0) > 0
      }
    }

    if (!hasSheetSource) {
      const empty: UserCalendarLookup = {
        enabled: true,
        leaveType: null,
        leaveLabel: null,
        events: [],
        raw: null,
      }
      return NextResponse.json(empty)
    }

    const lookup = await getUserCalendarLookup({
      date,
      department: profile.division,
      userName: profile.display_name,
    })
    return NextResponse.json(lookup)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[calendar-events] error:', message)
    // 에러는 200 + enabled=true + fetchFailed=true로 응답
    // (UI가 "캘린더 불러오기 실패" 안내만 하면 됨, 폼은 그대로 동작)
    const failed: UserCalendarLookup = {
      enabled: true,
      fetchFailed: true,
      leaveType: null,
      leaveLabel: null,
      events: [],
      raw: null,
    }
    return NextResponse.json(failed, { status: 200 })
  }
}
