/**
 * GET /api/team-status/expected-timeline?date=YYYY-MM-DD
 *
 * D-day 출근보고 모달이 열릴 때 호출. prefill 우선순위:
 *   1) D-day 본문 row (leave_date=D-day) — 이미 D-day에 출근보고 작성한 경우
 *      → 그 값으로 prefill (수정 가능)
 *   2) D-1 사전 보고 row (expected_start_date=D-day, leave_date < D-day)
 *      → D-1 퇴근보고 시점에 입력한 다음날 예정값으로 prefill
 *   3) 둘 다 없으면 빈 응답 (기본값 09:00 / 18:00 / 사무실)
 *
 * 응답:
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

    const empty = {
      plannedLocations: null,
      expectedStartTime: null,
      expectedEndTime: null,
      timeline: null,
      leaveTimeline: null,
      hasExisting: false,
      checkedInAt: null as string | null,  // 'HH:mm' or null — daily.checked_in_at에서 추출
    }

    // ─── 1순위: D-day 본문 row ─────────────────────────────────────────────
    // 이미 D-day에 출근보고를 작성한 적이 있다면 그 값으로 prefill (수정 가능)
    const { data: bodyLog } = await adminClient
      .from('work_logs')
      .select('start_time, end_time, work_location, work_location_timeline, leave_timeline, planned_work_locations')
      .eq('user_email', user.email!)
      .eq('leave_date', date)
      .eq('is_deleted', false)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (bodyLog) {
      // 본문 row의 값으로 응답
      const plannedLocations = normalizeWorkLocations(bodyLog.planned_work_locations)
        ?? legacyTimelineToLocations(bodyLog.work_location_timeline ?? null)
        ?? legacySingleToLocations(bodyLog.work_location ?? null)
      const startHHmm = typeof bodyLog.start_time === 'string' ? bodyLog.start_time.slice(0, 5) : null
      const endHHmm   = typeof bodyLog.end_time   === 'string' ? bodyLog.end_time.slice(0, 5)   : null

      const leave = Array.isArray(bodyLog.leave_timeline) ? bodyLog.leave_timeline as LeaveTimeline : null
      const leaveTimeline: LeaveTimeline | null = leave && leave.length > 0
        ? leave.map(it => ({ ...it, source: it.source }))
        : null

      // legacy timeline 호환 응답
      let timeline: WorkLocationTimeline | null = null
      if (Array.isArray(bodyLog.work_location_timeline) && bodyLog.work_location_timeline.length > 0) {
        timeline = bodyLog.work_location_timeline as WorkLocationTimeline
      } else if (bodyLog.work_location || startHHmm || endHHmm) {
        timeline = legacyToTimeline({
          expectedWorkLocation: bodyLog.work_location ?? null,
          expectedWorkLocationType: bodyLog.work_location ?? null,
          expectedWorkTime: startHHmm,
          fallbackCheckoutTime: endHHmm,
          asExpected: true,
        })
      }

      // daily_work_status에서 checked_in_at 시간 추출 (HH:mm)
      let checkedInAt: string | null = null
      try {
        const { data: daily } = await adminClient
          .from('daily_work_status')
          .select('checked_in_at')
          .eq('user_email', user.email!)
          .eq('work_date', date)
          .maybeSingle()
        if (daily?.checked_in_at) {
          const d = new Date(daily.checked_in_at)
          // KST(+09) 기준 HH:mm 추출
          const fmt = new Intl.DateTimeFormat('en-US', {
            timeZone: 'Asia/Seoul',
            hour12: false,
            hour: '2-digit',
            minute: '2-digit',
          })
          const parts = fmt.formatToParts(d)
          const h = parts.find(p => p.type === 'hour')?.value ?? '00'
          const m = parts.find(p => p.type === 'minute')?.value ?? '00'
          // 30분 floor
          const mm = parseInt(m, 10)
          const flooredM = mm < 30 ? '00' : '30'
          checkedInAt = `${h.padStart(2, '0')}:${flooredM}`
        }
      } catch { /* 무시 */ }

      return NextResponse.json({
        plannedLocations,
        expectedStartTime: startHHmm,
        expectedEndTime: endHHmm,
        timeline,
        leaveTimeline,
        hasExisting: true,
        checkedInAt,
      })
    }

    // ─── 2순위: D-1 사전 보고 row (expected_start_date 매칭) ────────────────
    const { data: priorLog, error } = await adminClient
      .from('work_logs')
      .select('expected_work_location_timeline, expected_work_location, expected_work_location_type, expected_work_time, expected_leave_timeline, planned_work_locations')
      .eq('user_email', user.email!)
      .eq('expected_start_date', date)
      .neq('leave_date', date)  // 본문 row는 위에서 처리 (혹시 양쪽 매칭되는 옛날 row 제외)
      .eq('is_deleted', false)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error) {
      console.error('expected-timeline lookup error:', error)
      return NextResponse.json(empty)
    }
    if (!priorLog) {
      return NextResponse.json(empty)
    }

    let plannedLocations: WorkLocations | null = normalizeWorkLocations(priorLog.planned_work_locations)
    if (!plannedLocations || plannedLocations.length === 0) {
      const fromTl = legacyTimelineToLocations(priorLog.expected_work_location_timeline ?? null)
      if (fromTl && fromTl.length > 0) plannedLocations = fromTl
      else {
        const fromSingle = legacySingleToLocations(priorLog.expected_work_location ?? null)
        if (fromSingle && fromSingle.length > 0) plannedLocations = fromSingle
      }
    }

    const tlArr = Array.isArray(priorLog.expected_work_location_timeline)
      ? priorLog.expected_work_location_timeline as WorkLocationTimeline
      : null
    const tlFirst = tlArr?.find(e => e.kind === 'work_location') ?? null
    const tlLast = tlArr && tlArr.length > 0 ? tlArr[tlArr.length - 1] : null
    const expectedStartTime: string | null =
      (typeof priorLog.expected_work_time === 'string' ? priorLog.expected_work_time.slice(0, 5) : null)
      ?? tlFirst?.startTime
      ?? null
    const expectedEndTime: string | null =
      (tlLast && (tlLast.kind === 'expected_checkout' || tlLast.kind === 'checkout')
        ? tlLast.startTime
        : null) ?? null

    let timeline: WorkLocationTimeline | null = null
    if (Array.isArray(priorLog.expected_work_location_timeline) && priorLog.expected_work_location_timeline.length > 0) {
      timeline = prefillFromExpected(priorLog.expected_work_location_timeline as WorkLocationTimeline)
    } else if (priorLog.expected_work_location || priorLog.expected_work_time) {
      timeline = legacyToTimeline({
        expectedWorkLocation: priorLog.expected_work_location ?? null,
        expectedWorkLocationType: (priorLog as { expected_work_location_type?: string | null }).expected_work_location_type ?? null,
        expectedWorkTime: priorLog.expected_work_time ?? null,
        asExpected: true,
      })
    }

    const expectedLeave = Array.isArray(priorLog.expected_leave_timeline)
      ? (priorLog.expected_leave_timeline as LeaveTimeline)
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
      hasExisting: false,
      checkedInAt: null,
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
      hasExisting: false,
      checkedInAt: null,
    }, { status: 200 })
  }
}
