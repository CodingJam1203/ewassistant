/**
 * GET /api/my/missed-checkout
 *
 * 본인의 가장 최근 미완료 퇴근보고 1건 조회.
 *
 * 조건:
 *   - expected_start_date < 오늘 (KST)
 *   - 그 날짜의 퇴근보고(leave_date 동일 + end_time 채워짐) 없음
 *   - 종일 휴가 아님
 *
 * 응답:
 *   { targetDate: 'YYYY-MM-DD' } — 미완료 1건 (가장 최근)
 *   { targetDate: null }         — 미완료 없음
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getKstTodayDateString } from '@/lib/utils/date'
import type { LeaveTimeline } from '@/types/leave-timeline'

const LOOKBACK_DAYS = 30  // 30일 이전까지만 알림 (그 이상 오래되면 무시)

export async function GET() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const today = getKstTodayDateString()
    const earliest = (() => {
      const d = new Date(`${today}T00:00:00+09:00`)
      d.setUTCDate(d.getUTCDate() - LOOKBACK_DAYS)
      return d.toISOString().slice(0, 10)
    })()

    const adminClient = createAdminClient()

    // 0) 본인 user_profile.created_at — 가입(첫 로그인) 시점 전의 미보고는 후보 제외
    const { data: profileRow } = await adminClient
      .from('user_profiles')
      .select('created_at')
      .eq('email', user.email)
      .maybeSingle()
    const signupDate = profileRow?.created_at
      ? new Date(profileRow.created_at).toISOString().slice(0, 10)
      : null
    // 가입일이 30일 한도(earliest)보다 늦으면 그 날짜를 lower bound로 사용
    const lowerBound = signupDate && signupDate > earliest ? signupDate : earliest

    // 1) 본인의 최근 출근보고 (expected_start_date < today) — 날짜 desc, 30일 한도
    const { data: candidates, error: candErr } = await adminClient
      .from('work_logs')
      .select('id, expected_start_date, expected_leave_timeline, leave_timeline')
      .eq('user_email', user.email)
      .eq('is_deleted', false)
      .not('expected_start_date', 'is', null)
      .lt('expected_start_date', today)
      .gte('expected_start_date', lowerBound)
      .order('expected_start_date', { ascending: false })

    if (candErr) {
      console.warn('[missed-checkout] candidates fetch failed:', candErr.message)
      return NextResponse.json({ targetDate: null })
    }
    if (!candidates || candidates.length === 0) {
      return NextResponse.json({ targetDate: null })
    }

    // 2) 후보 날짜들의 퇴근보고 완료 여부 일괄 조회
    const candidateDates = Array.from(
      new Set(candidates.map(c => c.expected_start_date as string)),
    )
    const { data: completed } = await adminClient
      .from('work_logs')
      .select('leave_date')
      .eq('user_email', user.email)
      .eq('is_deleted', false)
      .in('leave_date', candidateDates)
      .not('end_time', 'is', null)

    const completedSet = new Set(
      ((completed ?? []) as Array<{ leave_date: string }>).map(r => r.leave_date),
    )

    // 3) 종일 휴가는 미완료 대상에서 제외
    const isFullDayLeave = (tl: LeaveTimeline | null | undefined) =>
      Array.isArray(tl) && tl.some(it => it?.leaveType === 'full_day')

    // 4) candidates는 expected_start_date desc 정렬 — 가장 최근 미완료 1건 찾기
    for (const c of candidates) {
      const date = c.expected_start_date as string
      if (completedSet.has(date)) continue
      // 출근보고 row의 expected_leave_timeline 또는 leave_timeline 검사
      if (isFullDayLeave(c.expected_leave_timeline as LeaveTimeline | null)) continue
      if (isFullDayLeave(c.leave_timeline as LeaveTimeline | null)) continue

      return NextResponse.json({
        targetDate: date,
      }, {
        headers: {
          // 30초 캐시 — MY PAGE 새로고침 시마다 DB hit 부담 ↓
          'Cache-Control': 'private, max-age=30',
        },
      })
    }

    return NextResponse.json({ targetDate: null })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[missed-checkout]', msg)
    return NextResponse.json({ targetDate: null })
  }
}
