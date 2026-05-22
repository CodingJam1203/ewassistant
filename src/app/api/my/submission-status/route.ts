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
import { getKstTodayDateString } from '@/lib/utils/date'
import type { LeaveTimeline } from '@/types/leave-timeline'
import { isCalendarEnabled, getCalendarRangeBatch, parseCell } from '@/lib/leave-calendar'

// Vercel Hobby 기본 10s — 1개월치 work_logs 2번 쿼리가 콜드스타트에서 종종 타임아웃 → 30s로 여유
export const maxDuration = 30

export type DayStatus =
  | 'complete'
  | 'missing_checkout'
  | 'missing_all'
  | 'leave'
  | 'weekend'
  | 'holiday'
  | 'pre_signup'
  | 'future'  // 오늘 이후 — 보고 의무 X (사전 등록만 가능)

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
  // ❗ BUG FIX: 기존 코드는 `${date}T00:00:00+09:00`로 파싱했는데, 이러면 UTC에서 전날 15시가 되어
  // setUTCDate(getUTCDate() + 1) 결과가 같은 날짜로 돌아옴 → 무한 루프 → 30s timeout.
  // UTC로 통일해서 처리. (date string은 timezone-free라 UTC 파싱이 안전)
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
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
  // 504 디버깅용 단계별 타이밍 — Vercel function logs에서 어디서 시간이 새는지 추적
  const t0 = Date.now()
  const log = (label: string) => {
    console.log(`[submission-status][${Date.now() - t0}ms] ${label}`)
  }

  try {
    log('start')
    const supabase = await createClient()
    log('createClient done')
    const { data: { user } } = await supabase.auth.getUser()
    log(`auth.getUser done user=${user?.email ?? 'null'}`)
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
    log('adminClient created')

    // 본인 user_profile — created_at(가입일), division/display_name(Google 캘린더 lookup용)
    const { data: profileRow } = await adminClient
      .from('user_profiles')
      .select('created_at, division, display_name')
      .eq('email', user.email)
      .maybeSingle()
    log('profile lookup done')
    const signupDate: string | null = profileRow?.created_at
      ? new Date(profileRow.created_at).toISOString().slice(0, 10)
      : null
    const userDivision = (profileRow?.division as string | null) ?? null
    const userDisplayName = (profileRow?.display_name as string | null) ?? null

    // Stage 0-4a: 정책서 "한 (user, date) row" 모델 — 단일 leave_date 쿼리.
    // 옛 분리 모델(expected_start_date 기반 D+1 사전등록 row)은 deprecate.
    // - check_in 판정: row 존재 (planned_start_time 또는 start_time 있으면)
    // - check_out 판정: actual_end_time IS NOT NULL (Stage 0-3 backfill로 옛 row도 채워짐)
    // - check_out 판정 fallback: actual_end_time NULL이면 "출근보고만 작성, 미퇴근" 으로 본다
    //   (옛 모델의 end_time NOT NULL은 default 18:00이라 신호 못 됨)
    const SELECT_COLS = 'id, leave_date, planned_start_time, actual_end_time, start_time, end_time, leave_timeline'
    const { data: queryRows, error: queryErr } = await adminClient
      .from('work_logs')
      .select(SELECT_COLS)
      .eq('user_email', user.email)
      .eq('is_deleted', false)
      .gte('leave_date', from)
      .lte('leave_date', to)
      .order('leave_date', { ascending: false })
    log(`work_logs query done (rows=${queryRows?.length ?? 'err'})`)
    if (queryErr) {
      console.warn('[submission-status] query failed:', queryErr.message)
      return NextResponse.json({ error: '조회 실패' }, { status: 500 })
    }
    const rows = queryRows ?? []

    // 날짜별 매핑 — 같은 (user, date)에 row가 여러 개일 수 있음 (옛 데이터 잔여물).
    // 정책서 단일 row 가정 — 모든 row를 펼쳐서 가장 진행된 상태 1건으로 합친다.
    //   has_check_in : 어느 row든 존재
    //   has_check_out: actual_end_time IS NOT NULL인 row 존재
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

    for (const r of rows) {
      const row = r as {
        id: string
        leave_date: string | null
        planned_start_time: string | null
        actual_end_time: string | null
        start_time: string | null
        end_time: string | null
        leave_timeline: LeaveTimeline | null
      }
      if (!row.leave_date) continue
      const p = ensure(row.leave_date)
      if (!p.checkInLogId) p.checkInLogId = row.id
      if (!p.checkOutLogId && row.actual_end_time) p.checkOutLogId = row.id
      if (!p.leaveType) p.leaveType = pickLeaveType(row.leave_timeline)
    }

    // ─── Google 캘린더 휴가 반영 ─────────────────────────────────────────────
    // N-Click 보고가 없는 날도 Google 캘린더에 종일 휴가가 등록돼 있으면 leave로 분류
    // (그래야 미보고로 잘못 카운트되지 않음). work_logs 기반 leaveType이 이미 있는 날은
    // 우선순위가 높으므로 덮어쓰지 않음.
    if (isCalendarEnabled() && userDivision && userDisplayName) {
      try {
        // from~to 사이 모든 날짜 (range가 보통 1개월이라 31개 정도)
        const allDates: string[] = []
        for (let d = from; d <= to; d = addDays(d, 1)) {
          allDates.push(d)
        }
        const calBatchByDate = await getCalendarRangeBatch(allDates)
        log(`google calendar batch fetched (${allDates.length} dates)`)

        for (const date of allDates) {
          const batch = calBatchByDate[date]
          if (!batch) continue
          const deptEntries = batch.departments?.[userDivision] ?? []
          const target = deptEntries.find(e => e.name?.trim() === userDisplayName.trim())
          if (!target) continue
          const parsed = parseCell(target.cellValue)
          if (parsed.leaveType === 'full_day') {
            const p = ensure(date)
            if (!p.leaveType) p.leaveType = 'full_day'
          } else if (parsed.leaveType === 'morning_half' || parsed.leaveType === 'afternoon_half') {
            const p = ensure(date)
            if (!p.leaveType) p.leaveType = parsed.leaveType
          }
        }
      } catch (err) {
        // Google 캘린더 fetch 실패해도 본 흐름 진행 — work_logs 기반으로만 판정
        console.warn('[submission-status] google calendar lookup failed (continuing):', err)
      }
    }

    // 날짜 범위 순회하면서 status 결정. 달력 자정 기준 — 자정 넘기면 전날 미보고는 퇴근누락 칩 (v1.42)
    const today = getKstTodayDateString()
    const days: DayStatusEntry[] = []
    let totalWorkdays = 0
    let complete = 0
    let missingCheckout = 0
    let missingAll = 0
    let onLeave = 0

    for (let d = from; d <= to; d = addDays(d, 1)) {
      // YYYY-MM-DD를 UTC로 파싱해서 그 날의 요일을 계산.
      // KST offset(+09:00)으로 파싱하면 UTC에선 전날 15시가 되어 UTCDay가 하루 어긋남.
      const weekday = new Date(`${d}T00:00:00Z`).getUTCDay()
      const sat = isSaturday(d)
      const sun = isSunday(d)
      const holiday = isKoreanHoliday(d)
      const holidayName = getKoreanHolidayName(d)

      const per = byDate.get(d)
      let status: DayStatus
      const leaveType: DayStatusEntry['leaveType'] = per?.leaveType ?? null

      if (signupDate && d < signupDate) {
        status = 'pre_signup'
      } else if (sat || sun) {
        status = 'weekend'
      } else if (holiday) {
        status = 'holiday'
      } else if (leaveType === 'full_day') {
        // 휴가는 미래여도 leave로 표시 (사전 등록된 휴가 가시화)
        status = 'leave'
        onLeave++
        totalWorkdays++
      } else if (d > today) {
        // 오늘 이후 + 휴가 아님 → 미래. 보고 의무 없음 (사전 등록만 가능).
        status = 'future'
      } else {
        // 평일 + 휴일 아님 + 종일 휴가 아님 → 보고 의무 대상.
        // 단, 오늘은 아직 퇴근 시간 전일 수 있어 미보고 게이트 외부.
        //   - 출/퇴근 모두 작성됐으면 complete로 인정 (조기 퇴근 케이스)
        //   - 그 외 (출근만 / 둘 다 없음)는 future와 같이 진행 중 처리 → 미보고 카운트·뱃지 X
        const hasIn = !!per?.checkInLogId
        const hasOut = !!per?.checkOutLogId
        const isToday = d === today
        if (hasIn && hasOut) {
          status = 'complete'
          complete++
          totalWorkdays++
        } else if (!hasIn && hasOut) {
          // 출근보고 없이 퇴근만 — 드문 케이스. complete 취급 (사용자 의도 명확)
          status = 'complete'
          complete++
          totalWorkdays++
        } else if (isToday) {
          // 오늘 + 진행 중(출근만 또는 둘 다 없음) → 미보고로 잡지 않음
          status = 'future'
        } else if (hasIn && !hasOut) {
          status = 'missing_checkout'
          missingCheckout++
          totalWorkdays++
        } else {
          status = 'missing_all'
          missingAll++
          totalWorkdays++
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
    log(`response ready (days=${days.length})`)
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
