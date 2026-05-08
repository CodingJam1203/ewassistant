/**
 * GET /api/calendar/range?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * 현재 로그인 사용자의 외부 Google Sheets 캘린더 일정을 날짜 범위 단위로 조회.
 * 캘린더뷰(MyHistoryCalendar)에서 월간 그리드를 그릴 때 사용한다.
 *
 * - 단일 날짜 endpoint(`/api/team-status/calendar-events`)를 N번 호출하는 대신
 *   서버에서 병렬로 묶어 응답.
 * - 각 날짜의 결과는 DB cache(`leave_calendar_cache`) hit이면 거의 무료, miss이면
 *   Apps Script 호출. 캐시 없이 호출하면 비쌀 수 있어 최대 45일로 제한.
 *
 * 응답:
 *   {
 *     enabled: boolean
 *     byDate: Record<'YYYY-MM-DD', UserCalendarLookup>
 *     fetchFailed?: boolean (전체 실패 시)
 *   }
 */
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getUserCalendarLookup, isCalendarEnabled } from '@/lib/leave-calendar'
import type { UserCalendarLookup } from '@/types/leave-calendar'

const MAX_DAYS = 45

export async function GET(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const from = (searchParams.get('from') || '').trim()
    const to   = (searchParams.get('to')   || '').trim()
    const isoRe = /^\d{4}-\d{2}-\d{2}$/
    if (!isoRe.test(from) || !isoRe.test(to)) {
      return NextResponse.json({ error: 'from/to are required (YYYY-MM-DD)' }, { status: 400 })
    }
    if (from > to) {
      return NextResponse.json({ error: 'from must be <= to' }, { status: 400 })
    }

    // 캘린더 연동 비활성 시 즉시 빈 결과
    if (!isCalendarEnabled()) {
      return NextResponse.json({ enabled: false, byDate: {} })
    }

    // 사용자 프로필 조회 (시트 매칭용)
    const adminClient = createAdminClient()
    const { data: profile } = await adminClient
      .from('user_profiles')
      .select('display_name, division')
      .eq('email', user.email!)
      .single()
    if (!profile?.display_name || !profile?.division) {
      return NextResponse.json({ enabled: true, byDate: {} })
    }

    // from~to 사이 날짜 나열 (UTC 기준 enumerate — 시트는 KST 날짜라 같은 결과)
    const start = new Date(`${from}T00:00:00Z`)
    const end   = new Date(`${to}T00:00:00Z`)
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return NextResponse.json({ error: 'Invalid date range' }, { status: 400 })
    }
    const days = Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1
    if (days > MAX_DAYS) {
      return NextResponse.json({ error: `Range too large (max ${MAX_DAYS} days)` }, { status: 400 })
    }
    const dates: string[] = []
    for (let i = 0; i < days; i++) {
      const d = new Date(start)
      d.setUTCDate(d.getUTCDate() + i)
      dates.push(d.toISOString().slice(0, 10))
    }

    // 동시 호출 수 제한 (CONCURRENCY=3) — Apps Script가 동시 요청에 약해서
    // Promise.all로 41개 한 번에 쏘면 대부분 throttle/timeout. 작은 배치로 묶어서
    // sequentially 처리하면 Apps Script 1개당 응답 시간이 안정적이라 모두 성공함.
    // 최악의 경우 ceil(41/3) * 6s ≈ 84s까지 갈 수 있지만, 실제론 cache hit 비율이
    // 점점 올라가서 두 번째 페이지 로드부터는 1~2초 안에 끝남.
    const CONCURRENCY = 3
    const results: UserCalendarLookup[] = new Array(dates.length)
    for (let i = 0; i < dates.length; i += CONCURRENCY) {
      const batch = dates.slice(i, i + CONCURRENCY)
      const batchResults = await Promise.all(
        batch.map(date =>
          getUserCalendarLookup({
            date,
            department: profile.division!,
            userName: profile.display_name!,
          }).catch((): UserCalendarLookup => ({
            enabled: true,
            fetchFailed: true,
            leaveType: null,
            leaveLabel: null,
            events: [],
            raw: null,
          })),
        )
      )
      batchResults.forEach((r, j) => { results[i + j] = r })
    }

    const byDate: Record<string, UserCalendarLookup> = {}
    dates.forEach((d, i) => { byDate[d] = results[i] })

    return NextResponse.json({
      enabled: true,
      byDate,
    }, {
      headers: {
        // 캘린더는 자주 바뀌지 않음 — 클라이언트 짧게 캐시
        'Cache-Control': 'private, max-age=60, stale-while-revalidate=300',
      },
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[calendar/range] error:', message)
    return NextResponse.json({ enabled: true, byDate: {}, fetchFailed: true }, { status: 200 })
  }
}
