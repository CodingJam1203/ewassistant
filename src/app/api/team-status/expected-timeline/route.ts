/**
 * GET /api/team-status/expected-timeline?date=YYYY-MM-DD
 *
 * D-day 출근보고 모달이 열릴 때 호출하여, D-1 퇴근보고에서 작성한
 * 다음 출근 예정 정보를 기본값으로 가져옵니다.
 *
 * 응답 (v2 우선 + legacy fallback 동시 반환):
 * {
 *   plannedLocations:   WorkLocations | null,    // v2 — 칩 배열
 *   expectedStartTime:  string | null,           // 'HH:mm'
 *   expectedEndTime:    string | null,           // 'HH:mm'
 *   timeline:           WorkLocationTimeline | null,  // legacy 호환
 *   leaveTimeline:      LeaveTimeline | null,
 * }
 */
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getKstTodayDateString } from '@/lib/utils/date'
import { legacyToTimeline, prefillFromExpected } from '@/lib/work-location-timeline'
import {
  normalizeWorkLocations,
  legacyTimelineToLocations,
  legacySingleToLocations,
} from '@/lib/work-locations-v2'
import type { WorkLocationTimeline } from '@/types/work-location-timeline'
import type { WorkLocations } from '@/types/work-locations-v2'
import type { LeaveTimeline } from '@/types/leave-timeline'

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
      .select('expected_work_location_timeline, expected_work_location, expected_work_location_type, expected_work_time, expected_leave_timeline, planned_work_locations')
      .eq('user_email', user.email!)
      .eq('expected_start_date', date)
      .eq('is_deleted', false)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    const empty = {
      plannedLocations: null,
      expectedStartTime: null,
      expectedEndTime: null,
      timeline: null,
      leaveTimeline: null,
    }

    if (error) {
      console.error('expected-timeline lookup error:', error)
      return NextResponse.json(empty)
    }
    if (!log) {
      return NextResponse.json(empty)
    }

    // ─── v2: plannedLocations 결정 ─────────────────────────────────────────
    let plannedLocations: WorkLocations | null = normalizeWorkLocations(log.planned_work_locations)
    if (!plannedLocations || plannedLocations.length === 0) {
      const fromTl = legacyTimelineToLocations(log.expected_work_location_timeline ?? null)
      if (fromTl && fromTl.length > 0) plannedLocations = fromTl
      else {
        const fromSingle = legacySingleToLocations(log.expected_work_location ?? null)
        if (fromSingle && fromSingle.length > 0) plannedLocations = fromSingle
      }
    }

    // ─── 시간 (HH:mm) 추출 ──────────────────────────────────────────────────
    const tlArr = Array.isArray(log.expected_work_location_timeline)
      ? log.expected_work_location_timeline as WorkLocationTimeline
      : null
    const tlFirst = tlArr?.find(e => e.kind === 'work_location') ?? null
    const tlLast = tlArr && tlArr.length > 0 ? tlArr[tlArr.length - 1] : null
    const expectedStartTime: string | null =
      (typeof log.expected_work_time === 'string' ? log.expected_work_time.slice(0, 5) : null)
      ?? tlFirst?.startTime
      ?? null
    const expectedEndTime: string | null =
      (tlLast && (tlLast.kind === 'expected_checkout' || tlLast.kind === 'checkout')
        ? tlLast.startTime
        : null) ?? null

    // ─── legacy timeline (호환 유지) ────────────────────────────────────────
    let timeline: WorkLocationTimeline | null = null
    if (Array.isArray(log.expected_work_location_timeline) && log.expected_work_location_timeline.length > 0) {
      timeline = prefillFromExpected(log.expected_work_location_timeline as WorkLocationTimeline)
    } else if (log.expected_work_location || log.expected_work_time) {
      timeline = legacyToTimeline({
        expectedWorkLocation: log.expected_work_location ?? null,
        expectedWorkLocationType: (log as { expected_work_location_type?: string | null }).expected_work_location_type ?? null,
        expectedWorkTime: log.expected_work_time ?? null,
        asExpected: true,
      })
    }

    // 휴가는 그대로 (D-1에서 D-day로 source: 'expected')
    const expectedLeave = Array.isArray(log.expected_leave_timeline)
      ? (log.expected_leave_timeline as LeaveTimeline)
      : null
    const leaveTimeline: LeaveTimeline | null = expectedLeave && expectedLeave.length > 0
      ? expectedLeave.map(it => ({ ...it, source: 'expected' as const }))
      : null

    return NextResponse.json({
      plannedLocations,
      expectedStartTime,
      expectedEndTime,
      timeline,
      leaveTimeline,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('expected-timeline GET error:', message)
    return NextResponse.json({
      plannedLocations: null,
      expectedStartTime: null,
      expectedEndTime: null,
      timeline: null,
      leaveTimeline: null,
    }, { status: 200 })
  }
}
