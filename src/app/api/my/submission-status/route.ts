/**
 * GET /api/my/submission-status?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * 본인의 일자별 보고 상태 — 캘린더/테이블에서 미보고 가시화용.
 *
 * 상태 분류 (5):
 *   complete         : 출근+퇴근 모두 보고
 *   missing_checkout : 출근만 보고, 퇴근 보고 없음
 *   missing_all      : 출근/퇴근 둘 다 보고 없음 (평일 + 휴가 아님)
 *   leave            : 종일 휴가
 *   weekend          : 토/일 (자동 정상 — 미보고 카운트 X)
 *   holiday          : 공휴일 (자동 정상 — 미보고 카운트 X)
 *
 * 정책:
 *   - 미보고 = 평일(월~금) + 휴일/휴가 아님
 *   - 토/일/공휴일은 자동 정상 (사용자가 작성 안 해도 OK)
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isKoreanHoliday, getKoreanHolidayName, isSaturday, isSunday } from '@/lib/kr-holidays'
import type { LeaveTimeline } from '@/types/leave-timeline'

export type DayStatus =
  | 'complete'
  | 'missing_checkout'
  | 'missing_all'
  | 'leave'
  | 'weekend'
  | 'holiday'

export interface DayStatusEntry {
  date: string
  weekday: number  // 0=일, 6=토
  isHoliday: boolean
  holidayName: string | null
  status: DayStatus
  leaveType: 'full_day' | 'morning_half' | 'afternoon_half' | null
  /** 작성된 출근보고 work_log id (있으면) — 클라가 수정 모달 띄울 때 사용 */
  checkInLogId: string | null
  /** 작성된 퇴근보고 work_log id (있으면) */
  checkOutLogId: string | null
}

export interface SubmissionStatusResponse {
  from: string
  to: string
  days: DayStatusEntry[]
  summary: {
    totalWorkdays: number  // 평일+휴가아닌 일수
    complete: number
    missingCheckout: number
    missingAll: number
    onLeave: number
  }
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00+09:00`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function isFullDayLeave(tl: LeaveTimeline | null | undefined): boolean {
  if (!Array.isArray(tl)) return false
  return tl.some(it => it?.leaveType === 'full_day')
}

function pickLeaveType(tl: LeaveTimeline | null | undefined): DayStatusEntry['leaveType'] {
  if (!Array.isArray(tl)) return null
  for (const it of tl) {
    if (it?.leaveType === 'full_day') return 'full_day'
    if (it?.leaveType === 'morning_half') return 'morning_half'
    if (it?.leaveType === 'afternoon_half') return 'afternoon_half'
  }
  return null
}

export async function GET(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const from = searchParams.get('from')
    const to = searchParams.get('to')
    if (!from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      return NextResponse.json({ error: 'from/to 날짜 형식이 올바르지 않습니다.' }, { status: 400 })
    }
    if (from > to) {
      return NextResponse.json({ error: 'from은 to보다 작아야 합니다.' }, { status: 400 })
    }

    const adminClient = createAdminClient()

    // 본인 work_logs 일괄 조회 (출근보고 + 퇴근보고 모두)
    //   - expected_start_date in [from, to] → 출근보고
    //   - leave_date in [from, to] → 퇴근보고 (end_time 있어야 진짜 퇴근)
    // 양쪽 모두 한 쿼리에 OR로 모음
    const { data: rows, error } = await adminClient
      .from('work_logs')
      .select('id, expected_start_date, leave_date, end_time, leave_timeline, expected_leave_timeline')
      .eq('user_email', user.email)
      .eq('is_deleted', false)
      .or(
        `and(expected_start_date.gte.${from},expected_start_date.lte.${to}),` +
        `and(leave_date.gte.${from},leave_date.lte.${to})`
      )
      .order('created_at', { ascending: false })

    if (error) {
      console.warn('[submission-status] fetch error:', error.message)
      return NextResponse.json({ error: '조회 실패' }, { status: 500 })
    }

    // 날짜별 매핑 — 같은 날짜에 여러 row 있을 수 있음 (출근/퇴근 분리 + 재제출 등)
    interface PerDay {
      checkInLogId: string | null
      checkOutLogId: string | null
      leaveType: DayStatusEntry['leaveType']
    }
    const byDate = new Map<string, PerDay>()
    const ensure = (d: string): PerDay => {
      let p = byDate.get(d)
      if (!p) {
        p = { checkInLogId: null, checkOutLogId: null, leaveType: null }
        byDate.set(d, p)
      }
      return p
    }

    for (const r of rows ?? []) {
      const row = r as {
        id: string
        expected_start_date: string | null
        leave_date: string | null
        end_time: string | null
        leave_timeline: LeaveTimeline | null
        expected_leave_timeline: LeaveTimeline | null
      }
      if (row.expected_start_date) {
        const p = ensure(row.expected_start_date)
        if (!p.checkInLogId) p.checkInLogId = row.id
        if (!p.leaveType) {
          p.leaveType = pickLeaveType(row.expected_leave_timeline) ?? pickLeaveType(row.leave_timeline)
        }
      }
      if (row.leave_date && row.end_time) {
        const p = ensure(row.leave_date)
        if (!p.checkOutLogId) p.checkOutLogId = row.id
        if (!p.leaveType) {
          p.leaveType = pickLeaveType(row.leave_timeline)
        }
      }
      // 퇴근보고 row의 leave_timeline에 full_day가 있으면 해당 일자에도 반영
      if (row.leave_date && !row.end_time && isFullDayLeave(row.leave_timeline)) {
        const p = ensure(row.leave_date)
        if (!p.leaveType) p.leaveType = 'full_day'
      }
    }

    // 날짜 범위 순회하면서 status 결정
    const days: DayStatusEntry[] = []
    let totalWorkdays = 0
    let complete = 0
    let missingCheckout = 0
    let missingAll = 0
    let onLeave = 0

    for (let d = from; d <= to; d = addDays(d, 1)) {
      const weekday = new Date(`${d}T00:00:00+09:00`).getUTCDay()
      const sat = isSaturday(d)
      const sun = isSunday(d)
      const holiday = isKoreanHoliday(d)
      const holidayName = getKoreanHolidayName(d)

      const per = byDate.get(d)
      let status: DayStatus
      let leaveType: DayStatusEntry['leaveType'] = per?.leaveType ?? null

      if (sat || sun) {
        status = 'weekend'
      } else if (holiday) {
        status = 'holiday'
      } else if (leaveType === 'full_day') {
        status = 'leave'
        onLeave++
        totalWorkdays++
      } else {
        // 평일 + 휴일 아님 + 종일 휴가 아님 → 보고 의무 있음
        totalWorkdays++
        const hasIn = !!per?.checkInLogId
        const hasOut = !!per?.checkOutLogId
        if (hasIn && hasOut) {
          status = 'complete'
          complete++
        } else if (hasIn && !hasOut) {
          status = 'missing_checkout'
          missingCheckout++
        } else if (!hasIn && hasOut) {
          // 출근보고 없이 퇴근만 — 드문 케이스. 일단 complete처럼 취급 (퇴근만 있어도 사용자 의도가 명확)
          status = 'complete'
          complete++
        } else {
          status = 'missing_all'
          missingAll++
        }
      }

      days.push({
        date: d,
        weekday,
        isHoliday: holiday,
        holidayName: holiday ? holidayName : null,
        status,
        leaveType,
        checkInLogId: per?.checkInLogId ?? null,
        checkOutLogId: per?.checkOutLogId ?? null,
      })
    }

    const body: SubmissionStatusResponse = {
      from,
      to,
      days,
      summary: { totalWorkdays, complete, missingCheckout, missingAll, onLeave },
    }
    return NextResponse.json(body, {
      headers: {
        // 30초 캐시 (work_logs 갱신 빈도 고려)
        'Cache-Control': 'private, max-age=30, stale-while-revalidate=300',
      },
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[submission-status]', msg)
    return NextResponse.json({ error: '서버 에러가 발생했습니다.' }, { status: 500 })
  }
}
