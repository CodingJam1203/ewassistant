/**
 * GET /api/team-status/expected-timeline?date=YYYY-MM-DD
 *
 * D-day 출근보고 모달이 열릴 때 호출하여, D-1 퇴근보고에서 작성한
 * 다음 출근 예정(expected_work_location_timeline)을 기본값으로 가져옵니다.
 *
 * 조회 규칙:
 * - 현재 사용자의 work_logs 중 expected_start_date = ?date 인 가장 최근 레코드
 * - is_deleted = false
 * - expected_work_location_timeline 컬럼 우선 사용
 * - 해당 컬럼이 NULL이면 legacy 컬럼(expected_work_location/expected_work_time)으로 단일 항목 합성
 *
 * 응답:
 *   { timeline: WorkLocationTimeline | null }
 */
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getKstTodayDateString } from '@/lib/utils/date'
import { legacyToTimeline, prefillFromExpected } from '@/lib/work-location-timeline'
import type { WorkLocationTimeline } from '@/types/work-location-timeline'

export async function GET(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const date = searchParams.get('date') ?? getKstTodayDateString()

    const adminClient = createAdminClient()

    const { data: log, error } = await adminClient
      .from('work_logs')
      .select('expected_work_location_timeline, expected_work_location, expected_work_location_type, expected_work_time')
      .eq('user_email', user.email!)
      .eq('expected_start_date', date)
      .eq('is_deleted', false)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error) {
      console.error('expected-timeline lookup error:', error)
      return NextResponse.json({ timeline: null })
    }
    if (!log) {
      return NextResponse.json({ timeline: null })
    }

    let timeline: WorkLocationTimeline | null = null

    if (Array.isArray(log.expected_work_location_timeline) && log.expected_work_location_timeline.length > 0) {
      // expected → CheckInModal prefill 변환 (마지막 항목을 expected_checkout으로 통일)
      timeline = prefillFromExpected(log.expected_work_location_timeline as WorkLocationTimeline)
    } else if (log.expected_work_location || log.expected_work_time) {
      // legacy fallback: 단일 항목 timeline 합성
      timeline = legacyToTimeline({
        expectedWorkLocation: log.expected_work_location ?? null,
        expectedWorkLocationType: (log as { expected_work_location_type?: string | null }).expected_work_location_type ?? null,
        expectedWorkTime: log.expected_work_time ?? null,
        // 종료 시간 정보가 없으면 expected_checkout 미생성 (CheckInModal에서 기본값 18:00 추가)
        asExpected: true,
      })
    }

    return NextResponse.json({ timeline })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('expected-timeline GET error:', message)
    return NextResponse.json({ timeline: null }, { status: 200 })
  }
}
