/**
 * POST /api/team-status/location/notify
 *
 * 근무장소 편집 완료("완료" 버튼 클릭) 시 Teams 알림 발송.
 *
 * 정책 (2026-05-19 v1.9, C2):
 *   - `/api/team-status/location` 자동 저장 경로에서는 알림 발송 X
 *   - 사용자가 편집 완료 행위(EditableLocationChips의 "완료" 버튼)를 했을 때만
 *     본 라우트가 호출되어 1건 알림 발송
 *   - 클라이언트는 편집 시작 시 startSnapshot을 기록 후 변화 있을 때만 본 라우트 호출
 *
 * Body (선택):
 *   { date: 'YYYY-MM-DD', previousLocation?: string }
 *
 * 인증: 로그인 사용자 본인의 데이터만. user_email로 본인 row 식별.
 */
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { notifyLocationChanged } from '@/lib/notifications/teams'
import { resolveRoutingTeam } from '@/lib/org'
import { getKstTodayDateString } from '@/lib/utils/date'
import { normalizeWorkLocations } from '@/lib/work-locations-v2'
import type { WorkLocations } from '@/types/work-locations-v2'
import type { WorkLocationTimeline } from '@/types/work-location-timeline'

export const maxDuration = 30

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json().catch(() => ({})) as {
      date?: string
      previousLocation?: string
    }
    const date = body.date || getKstTodayDateString()
    const previousLocation = body.previousLocation ?? ''

    const adminClient = createAdminClient()

    // 본인 프로필 + 현재 daily_work_status + 현재 work_log
    const [profileRes, dailyRes] = await Promise.all([
      adminClient
        .from('user_profiles')
        .select('id, display_name, division, team, notify_team')
        .eq('email', user.email)
        .maybeSingle(),
      adminClient
        .from('daily_work_status')
        .select('work_log_id, current_location, current_location_index')
        .eq('user_email', user.email)
        .eq('work_date', date)
        .maybeSingle(),
    ])

    const profile = profileRes.data
    const daily = dailyRes.data

    if (!daily?.work_log_id) {
      // 활성 work_log 없으면 발송할 위치 정보 자체가 없음 → 조용히 종료
      return NextResponse.json({ ok: false, reason: 'no active work_log' })
    }

    const { data: workLog } = await adminClient
      .from('work_logs')
      .select('actual_work_locations, work_location_timeline')
      .eq('id', daily.work_log_id)
      .maybeSingle()

    const actualLocs = normalizeWorkLocations(workLog?.actual_work_locations) as WorkLocations | null
    const timeline = Array.isArray(workLog?.work_location_timeline)
      ? workLog!.work_location_timeline as WorkLocationTimeline
      : null

    const currentLabel = daily.current_location ?? ''
    const currentIndex = typeof daily.current_location_index === 'number'
      ? daily.current_location_index
      : null

    // Teams 알림 발송 — await로 처리. Vercel function이 sendToMake retry 완주까지 대기 후 응답.
    // (fire-and-forget로 두면 응답 후 함수 종료되면서 retry promise가 끊겨 알림 지연·누락 발생.)
    await notifyLocationChanged({
      name: profile?.display_name || user.email,
      date,
      previousLocation,
      newLocation: currentLabel,
      changedAt: new Date().toISOString(),
      timeline: timeline ?? undefined,
      actualWorkLocations: actualLocs ?? undefined,
      currentLabel,
      currentIndex,
      division: profile?.division ?? null,
      // 본부 직속(team 없음) → admin 지정 notify_team으로 라우팅
      team: resolveRoutingTeam(profile?.team, profile?.notify_team) || null,
    })

    return NextResponse.json({ ok: true })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[location/notify] error:', msg)
    return NextResponse.json({ error: '알림 발송 실패' }, { status: 500 })
  }
}
