/**
 * GET /api/my/missed-checkout
 *
 * 본인의 가장 최근 미완료 퇴근보고 1건 조회.
 *
 * Stage 0-4a 정책서 "한 (user, date) row" 모델:
 *   - leave_date < 오늘 (KST)
 *   - actual_end_time IS NULL (퇴근완료 아직 안 함)
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
import { isKoreanHoliday, isSaturday, isSunday } from '@/lib/kr-holidays'
import type { LeaveTimeline } from '@/types/leave-timeline'

const LOOKBACK_DAYS = 30  // 30일 이전까지만 알림 (그 이상 오래되면 무시)

// Vercel Hobby 기본 10s — work_logs 쿼리 2건이 콜드스타트에서 종종 타임아웃 → 30s로 여유
export const maxDuration = 30

export async function GET() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // 달력 자정 기준 — 자정 넘긴 전날 미보고는 즉시 퇴근누락으로 잡아 미보고 팝업 노출 (v1.42)
    const today = getKstTodayDateString()
    const earliest = (() => {
      // UTC로 파싱해야 setUTCDate가 KST 날짜 단위로 정확히 동작.
      // (+09:00로 파싱하면 UTC에선 전날 15시가 되어 1일 어긋남)
      const d = new Date(`${today}T00:00:00Z`)
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

    // Stage 0-4a: 단일 쿼리 — leave_date < today + actual_end_time IS NULL.
    // 옛 expected_start_date 기반 D+1 row 분리 모델은 deprecate.
    // 단일 row 모델에서 "미완료 퇴근"은 row가 존재하지만 actual_end_time이 비어있는 상태.
    const { data: candidates, error: candErr } = await adminClient
      .from('work_logs')
      .select('id, leave_date, leave_timeline')
      .eq('user_email', user.email)
      .eq('is_deleted', false)
      .is('actual_end_time', null)
      .lt('leave_date', today)
      .gte('leave_date', lowerBound)
      .order('leave_date', { ascending: false })

    if (candErr) {
      console.warn('[missed-checkout] candidates fetch failed:', candErr.message)
      return NextResponse.json({ targetDate: null })
    }
    if (!candidates || candidates.length === 0) {
      return NextResponse.json({ targetDate: null })
    }

    // 종일 휴가는 알림 대상에서 제외
    const isFullDayLeave = (tl: LeaveTimeline | null | undefined) =>
      Array.isArray(tl) && tl.some(it => it?.leaveType === 'full_day')

    // candidates는 leave_date desc — 가장 최근 미완료 1건 반환.
    // 토/일/공휴일은 미보고 알림 대상 X (자발 근무 시 본인 인지 가정)
    for (const c of candidates) {
      const date = c.leave_date as string
      if (isSaturday(date) || isSunday(date)) continue
      if (isKoreanHoliday(date)) continue
      if (isFullDayLeave(c.leave_timeline as LeaveTimeline | null)) continue

      return NextResponse.json({
        targetDate: date,
      }, {
        headers: {
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
