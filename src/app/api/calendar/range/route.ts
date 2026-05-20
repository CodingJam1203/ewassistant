/**
 * GET /api/calendar/range?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Phase 1.5a (2026-05-20) — 데이터 소스 swap:
 *   - 이전: Apps Script Web App + leave_calendar_cache (Google Sheets 캐시)
 *   - 변경: org_calendar_events (Phase 4.7 sync 결과, Google Calendar API 기반)
 *
 * 응답 shape는 그대로 유지 — MyHistoryCalendar / CheckInModal 등 클라이언트 코드 영향 0.
 *
 * 데이터 매핑:
 *   - 본인 매칭 row (matched_user_emails 안에 본인 이메일 포함) 만 조회
 *   - inferred_type === 'vacation'  → UserCalendarLookup.leaveType + leaveLabel
 *     · 종일(is_all_day) 또는 duration ≥ 8h → 'full_day'
 *     · 종료 시간 ≤ 14:00 → 'morning_half'
 *     · 시작 시간 ≥ 14:00 → 'afternoon_half'
 *     · 그 외 → 'morning_half' (default)
 *   - 그 외 (meeting/birthday/other) → events[] CalendarEventChunk 로 누적
 *
 * 응답:
 *   {
 *     enabled: boolean
 *     byDate: Record<'YYYY-MM-DD', UserCalendarLookup>
 *     fetchFailed?: boolean (DB 조회 실패 시)
 *   }
 */
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { UserCalendarLookup, CalendarEventChunk } from '@/types/leave-calendar'
import type { LeaveType } from '@/types/leave-timeline'

const MAX_DAYS = 45

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

function toKstTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('ko-KR', {
    timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false,
  })
}

function toKstDateString(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d)
}

/** vacation 이벤트의 시간 범위 → LeaveType 분류 */
function decideLeaveType(startMs: number, endMs: number, isAllDay: boolean): LeaveType {
  if (isAllDay) return 'full_day'
  const duration = endMs - startMs
  if (duration >= 480 * 60 * 1000) return 'full_day'
  // KST 기준 시작/끝 시간으로 morning_half / afternoon_half 분류
  const startKstHour = new Date(startMs).getUTCHours() + 9
  const endKstHour   = new Date(endMs).getUTCHours()   + 9
  // 정규화 (24+ → 다음 날)
  const sh = startKstHour % 24
  const eh = endKstHour % 24
  if (eh <= 14) return 'morning_half'
  if (sh >= 14) return 'afternoon_half'
  return 'morning_half'
}

export async function GET(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const userEmail = (user.email ?? '').toLowerCase()
    if (!userEmail) return NextResponse.json({ enabled: false, byDate: {} })

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

    // org_calendar_events에서 본인 매칭 이벤트 조회 (Phase 4.7 sync 결과)
    const adminClient = createAdminClient()
    const fromIso = new Date(`${from}T00:00:00+09:00`).toISOString()
    const toIso   = new Date(`${to}T23:59:59+09:00`).toISOString()

    const { data: rows, error: rowsErr } = await adminClient
      .from('org_calendar_events')
      .select('id, title, start_at, end_at, is_all_day, inferred_type, matched_user_emails')
      .lte('start_at', toIso)
      .gte('end_at',   fromIso)
      .contains('matched_user_emails', [userEmail])
      .range(0, 9999)
      .returns<Array<{
        id: string
        title: string | null
        start_at: string
        end_at: string
        is_all_day: boolean
        inferred_type: string | null
        matched_user_emails: string[] | null
      }>>()

    if (rowsErr) {
      console.error('[calendar/range] rows query error:', rowsErr.message)
      return NextResponse.json({ enabled: true, byDate: {}, fetchFailed: true }, { status: 200 })
    }

    // 결과 초기화 — 각 날짜별 빈 lookup
    const byDate: Record<string, UserCalendarLookup> = {}
    for (const dateIso of dates) {
      byDate[dateIso] = {
        enabled: true,
        leaveType: null,
        leaveLabel: null,
        events: [],
        raw: null,
      }
    }

    // 각 row를 KST 날짜 범위에 매핑 (종일은 duration 기반, 시각은 시각 비교)
    const dayBoundsMs = new Map<string, { start: number; end: number }>()
    for (const dateIso of dates) {
      const s = new Date(`${dateIso}T00:00:00+09:00`).getTime()
      const e = new Date(`${dateIso}T23:59:59+09:00`).getTime()
      dayBoundsMs.set(dateIso, { start: s, end: e })
    }

    for (const r of rows ?? []) {
      const evStartMs = new Date(r.start_at).getTime()
      const evEndMs   = new Date(r.end_at).getTime()
      const isVacation = r.inferred_type === 'vacation'

      // 그 row가 걸치는 KST 날짜 set
      let matchingDates: string[]
      if (r.is_all_day) {
        // 종일 — duration일수 기반 (Phase 4.4 정책)
        const durationDays = Math.max(1, Math.round((evEndMs - evStartMs) / 86_400_000))
        const startKst = toKstDateString(new Date(evStartMs))
        const [sy, sm, sd] = startKst.split('-').map(Number)
        const lastKst = toKstDateString(new Date(Date.UTC(sy, sm - 1, sd + durationDays - 1)))
        matchingDates = dates.filter(d => d >= startKst && d <= lastKst)
      } else {
        matchingDates = dates.filter(d => {
          const b = dayBoundsMs.get(d)
          if (!b) return false
          return !(evStartMs > b.end || evEndMs <= b.start)
        })
      }

      for (const dateIso of matchingDates) {
        const lookup = byDate[dateIso]
        if (isVacation) {
          // 첫 vacation 만 leaveType으로 (multi-vacation 1일은 비표준 — 첫 것 채택)
          if (lookup.leaveType === null) {
            lookup.leaveType = decideLeaveType(evStartMs, evEndMs, r.is_all_day)
            lookup.leaveLabel = r.title ?? '휴가'
            lookup.raw = r.title ?? null
          }
        } else {
          const chunk: CalendarEventChunk = {
            startTime: r.is_all_day ? null : toKstTime(r.start_at),
            endTime:   r.is_all_day ? null : toKstTime(r.end_at),
            title:     r.title ?? '',
          }
          lookup.events.push(chunk)
        }
      }
    }

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
