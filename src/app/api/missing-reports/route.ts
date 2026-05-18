/**
 * GET /api/missing-reports?from=YYYY-MM-DD&to=YYYY-MM-DD&division=&team=&name=&page=1&limit=50
 *
 * 회사 전체(필터 적용) 미보고 일자 리스트.
 *
 * 미보고 조건 (submission-status와 동일 정의):
 *   - 평일 (월~금)
 *   - 한국 공휴일 아님
 *   - 토/일 아님
 *   - 사용자 가입(created_at) 이후
 *   - **어제 이하** (오늘은 아직 퇴근 시간 전일 수 있어 미보고 게이트 외부 — submission-status와 동일)
 *   - 종일 휴가 아님
 *   - 출근/퇴근보고 둘 다 없음(missing_all) 또는 출근만 있음(missing_checkout)
 *
 * 정렬: 날짜 desc, 이름 asc.
 *
 * 인증: 로그인 사용자 누구나 (회사 전체 조회 허용).
 *
 * 성능 노트:
 *   - user_profiles 전체 list + work_logs 1개월치를 메모리에 펼침
 *   - 회사 ~100명 × 30일 = 약 3000 row, 가벼움
 *   - 페이징은 결과 array slice (총 미보고가 많아도 결과는 보통 작음)
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isKoreanHoliday, isSaturday, isSunday } from '@/lib/kr-holidays'
import { getKstTodayDateString } from '@/lib/utils/date'
import type { LeaveTimeline } from '@/types/leave-timeline'

export const maxDuration = 30

export type MissingStatus = 'missing_all' | 'missing_checkout'

export interface MissingReportItem {
  date: string                 // YYYY-MM-DD
  email: string
  name: string
  division: string | null
  team: string | null
  status: MissingStatus
  /** 본인의 work_log id가 있으면 checkout 작성 모달 prefill에 사용 */
  checkInLogId: string | null
}

export interface MissingReportsResponse {
  items: MissingReportItem[]
  total: number
  page: number
  limit: number
  /** 본인 email — 클라가 self 판단에 사용 */
  selfEmail: string
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function isFullDayLeave(tl: LeaveTimeline | null | undefined): boolean {
  if (!Array.isArray(tl)) return false
  return tl.some(it => it?.leaveType === 'full_day')
}

export async function GET(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const from = (searchParams.get('from') || '').trim()
    const to   = (searchParams.get('to')   || '').trim()
    const division = (searchParams.get('division') || '').trim()
    const team = (searchParams.get('team') || '').trim()
    const nameQ = (searchParams.get('name') || '').trim()
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1)
    const limit = Math.min(200, Math.max(10, parseInt(searchParams.get('limit') || '50', 10) || 50))

    const isoRe = /^\d{4}-\d{2}-\d{2}$/
    if (!isoRe.test(from) || !isoRe.test(to)) {
      return NextResponse.json({ error: 'from/to are required (YYYY-MM-DD)' }, { status: 400 })
    }
    if (from > to) {
      return NextResponse.json({ error: 'from must be <= to' }, { status: 400 })
    }

    const today = getKstTodayDateString()
    // 오늘은 아직 퇴근 시간 전일 수 있어 미보고 게이트 외부.
    // → 미보고 후보는 어제까지만. (submission-status와 동일 정책)
    const yesterday = addDays(today, -1)
    const effectiveTo = to > yesterday ? yesterday : to

    const adminClient = createAdminClient()

    // 1) 대상 사용자 (활성, 본부/팀 필터)
    let profilesQuery = adminClient
      .from('user_profiles')
      .select('email, display_name, division, team, created_at, is_active')
      .eq('is_active', true)
    if (division) profilesQuery = profilesQuery.eq('division', division)
    if (team) profilesQuery = profilesQuery.eq('team', team)
    if (nameQ) profilesQuery = profilesQuery.ilike('display_name', `%${nameQ}%`)
    const { data: profiles, error: profilesErr } = await profilesQuery
    if (profilesErr) {
      console.warn('[missing-reports] profiles fetch error:', profilesErr.message)
      return NextResponse.json({ error: '사용자 조회 실패' }, { status: 500 })
    }
    if (!profiles || profiles.length === 0) {
      const empty: MissingReportsResponse = { items: [], total: 0, page, limit, selfEmail: user.email }
      return NextResponse.json(empty)
    }

    type Profile = {
      email: string
      display_name: string
      division: string | null
      team: string | null
      created_at: string | null
      is_active: boolean
    }
    const profileRows = profiles as Profile[]
    const emails = profileRows.map(p => p.email).filter((e): e is string => !!e)
    const byEmail = new Map<string, Profile>(profileRows.map(p => [p.email, p]))

    // 2) Stage 0-4a: 정책서 "한 (user, date) row" 모델 — 단일 leave_date 쿼리.
    // 옛 분리 모델(expected_start_date 기반 D+1 row)은 deprecate.
    const SELECT_COLS = 'id, user_email, leave_date, actual_end_time, leave_timeline'
    const { data: queryRows, error: queryErr } = await adminClient
      .from('work_logs')
      .select(SELECT_COLS)
      .in('user_email', emails)
      .eq('is_deleted', false)
      .gte('leave_date', from)
      .lte('leave_date', effectiveTo)
    if (queryErr) {
      console.warn('[missing-reports] query failed:', queryErr.message)
      return NextResponse.json({ error: '조회 실패' }, { status: 500 })
    }

    type Row = {
      id: string
      user_email: string
      leave_date: string | null
      actual_end_time: string | null
      leave_timeline: LeaveTimeline | null
    }

    // 3) (email, date) 단위로 보고 상태 펼침
    //   - has_check_in : row 존재 (어느 row든)
    //   - has_check_out: actual_end_time IS NOT NULL인 row 존재
    //                    (Stage 0-3 backfill로 옛 row도 채워짐)
    interface PerCell {
      checkInLogId: string | null
      checkOutLogId: string | null
      leaveType: 'full_day' | 'morning_half' | 'afternoon_half' | null
    }
    const cells = new Map<string, PerCell>()  // key = `${email}|${date}`
    const cellKey = (email: string, date: string) => `${email}|${date}`
    const ensureCell = (email: string, date: string): PerCell => {
      const k = cellKey(email, date)
      let c = cells.get(k)
      if (!c) {
        c = { checkInLogId: null, checkOutLogId: null, leaveType: null }
        cells.set(k, c)
      }
      return c
    }

    for (const r of (queryRows ?? []) as Row[]) {
      const email = r.user_email
      if (!email || !r.leave_date) continue
      const c = ensureCell(email, r.leave_date)
      if (!c.checkInLogId) c.checkInLogId = r.id
      if (!c.checkOutLogId && r.actual_end_time) c.checkOutLogId = r.id
      if (!c.leaveType && isFullDayLeave(r.leave_timeline)) c.leaveType = 'full_day'
    }

    // 4) 사용자 × 날짜 매트릭스 순회 → 미보고만 추출
    const items: MissingReportItem[] = []
    for (const p of profileRows) {
      const signupDate = p.created_at
        ? new Date(p.created_at).toISOString().slice(0, 10)
        : null
      // 범위 내 가입 이전 일자는 자동 스킵 (lowerBound)
      const lowerBound = signupDate && signupDate > from ? signupDate : from

      for (let d = lowerBound; d <= effectiveTo; d = addDays(d, 1)) {
        if (isSaturday(d) || isSunday(d)) continue
        if (isKoreanHoliday(d)) continue
        const c = cells.get(cellKey(p.email, d))
        if (c?.leaveType === 'full_day') continue  // 종일 휴가 제외

        const hasIn = !!c?.checkInLogId
        const hasOut = !!c?.checkOutLogId
        let status: MissingStatus | null = null
        if (!hasIn && !hasOut) status = 'missing_all'
        else if (hasIn && !hasOut) status = 'missing_checkout'
        // hasOut만 있는 경우는 complete 취급 → 미보고 아님
        if (!status) continue

        items.push({
          date: d,
          email: p.email,
          name: p.display_name,
          division: p.division,
          team: p.team,
          status,
          checkInLogId: c?.checkInLogId ?? null,
        })
      }
    }

    // 5) 정렬: 날짜 desc, 이름 asc
    items.sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1
      return a.name.localeCompare(b.name, 'ko')
    })

    // 6) 페이징
    const total = items.length
    const start = (page - 1) * limit
    const pageItems = items.slice(start, start + limit)

    const body: MissingReportsResponse = {
      items: pageItems,
      total,
      page,
      limit,
      selfEmail: user.email,
    }
    return NextResponse.json(body, {
      headers: {
        'Cache-Control': 'private, max-age=30, stale-while-revalidate=120',
      },
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[missing-reports]', msg)
    return NextResponse.json({ error: '서버 에러' }, { status: 500 })
  }
}
