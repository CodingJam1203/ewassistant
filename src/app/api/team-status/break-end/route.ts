import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { notifyBreakEnded } from '@/lib/notifications/teams'
import { resolveRoutingTeam } from '@/lib/org'
import { getKstTodayDateString } from '@/lib/utils/date'

// 2026-05-19 v1.21: notify await 대응 — sendToMake retry 최악 31.5s + DB 처리 여유.
export const maxDuration = 60
import {
  calculateBreakAutoMinutesFromIso,
  accumulateBreakAuto,
  ceilTo30Min,
} from '@/lib/leave-timeline'
import { calculateLunchOverlapMinutes, LUNCH_OVERLAP_CHOICE } from '@/lib/utils/lunch-overlap'

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json()
    const date: string = body.date ?? getKstTodayDateString()
    // v1.65 — 휴게가 12:00~13:00 KST와 겹친 경우 클라가 모달로 받은 사용자 선택.
    //   'lunch': 점심으로 처리 (겹친 분 break_auto 누적에서 제외)
    //   'extra': 별도 휴게로 누적 (그대로)
    //   undefined: 겹침 없음 → 현재 동작 그대로 (모달 안 띄움)
    // 보안: 클라 선택을 신뢰하되 overlap 분 계산은 서버에서 재계산.
    const lunchOverlapChoiceRaw: unknown = body.lunchOverlapChoice
    const lunchOverlapChoice: 'lunch' | 'extra' | null =
      lunchOverlapChoiceRaw === LUNCH_OVERLAP_CHOICE.LUNCH
        ? 'lunch'
        : lunchOverlapChoiceRaw === LUNCH_OVERLAP_CHOICE.EXTRA
          ? 'extra'
          : null
    // v1.79 — 클라가 모달에서 조정한 휴게 시작/종료 시각을 ISO로 보내면 그 값을 사용.
    // 미전송 시 종전 동작 — break_started_at은 existing 그대로, break_ended_at은 NOW.
    // 형식 검증: ISO 형식이 아니면 fallback.
    const isoRe = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/
    const overrideStartedAt: string | null =
      typeof body.breakStartedAt === 'string' && isoRe.test(body.breakStartedAt)
        ? body.breakStartedAt
        : null
    const overrideEndedAt: string | null =
      typeof body.breakEndedAt === 'string' && isoRe.test(body.breakEndedAt)
        ? body.breakEndedAt
        : null
    const now = new Date().toISOString()
    const adminClient = createAdminClient()

    const { data: profile } = await adminClient
      .from('user_profiles')
      .select('id, display_name, division, team, notify_team')
      .eq('email', user.email!)
      .single()

    const { data: existing } = await adminClient
      .from('daily_work_status')
      .select('*')
      .eq('work_date', date)
      .eq('user_email', user.email!)
      .single()

    if (!existing?.is_on_break) {
      return NextResponse.json({ error: '휴게 상태가 아닙니다.' }, { status: 400 })
    }

    const newStatus = (existing.checked_in_at && !existing.checked_out_at) ? 'working' : 'reported'

    // v1.79 — 클라가 시각 조정값을 보냈으면 그 값으로 박음.
    const finalBreakStartedAt: string = overrideStartedAt ?? (existing.break_started_at as string | null) ?? now
    const finalBreakEndedAt: string = overrideEndedAt ?? now

    const updatePayload: Record<string, unknown> = {
      status:         newStatus,
      is_on_break:    false,
      break_ended_at: finalBreakEndedAt,
      updated_at:     now,
    }
    if (overrideStartedAt) {
      updatePayload.break_started_at = overrideStartedAt
    }

    const { data: daily, error } = await adminClient
      .from('daily_work_status')
      .update(updatePayload)
      .eq('work_date', date)
      .eq('user_email', user.email!)
      .select()
      .single()

    if (error) throw error

    // ─── 휴게 자동값 누적 (break_auto_actual_minutes / break_auto_rounded_minutes) ─
    let breakSessionMinutes = 0
    let lunchOverlapMinutes = 0
    {
      // v1.79 — overlap/세션 분 계산도 조정된 시각 기준으로 (서버에서 재계산해 신뢰).
      breakSessionMinutes = calculateBreakAutoMinutesFromIso(
        finalBreakStartedAt,
        finalBreakEndedAt
      )
      lunchOverlapMinutes = calculateLunchOverlapMinutes(
        finalBreakStartedAt,
        finalBreakEndedAt
      )
    }

    // v1.65 — choice='lunch'면 겹친 분을 누적에서 제외 (점심으로 흡수 — EW 이중 차감 방지).
    // overlap이 0이거나 choice가 lunch가 아니면 그대로 누적 (기존 동작).
    const effectiveSessionMinutes =
      lunchOverlapChoice === 'lunch' && lunchOverlapMinutes > 0
        ? Math.max(0, breakSessionMinutes - lunchOverlapMinutes)
        : breakSessionMinutes

    if (existing.work_log_id && effectiveSessionMinutes > 0) {
      try {
        const { data: wLog } = await adminClient
          .from('work_logs')
          .select('break_auto_actual_minutes')
          .eq('id', existing.work_log_id)
          .single()

        const accumulated = accumulateBreakAuto(
          (wLog?.break_auto_actual_minutes as number | null) ?? 0,
          effectiveSessionMinutes
        )

        await adminClient
          .from('work_logs')
          .update({
            break_auto_actual_minutes:  accumulated.actual,
            break_auto_rounded_minutes: accumulated.rounded,
          })
          .eq('id', existing.work_log_id)
      } catch (e) {
        // 누적 실패는 알림 흐름을 방해하지 않음
        console.warn('[break-end] auto break accumulation failed:', e)
      }
    }

    // v1.65 — audit 기록 강화: 점심 겹침 분 + 사용자 선택 함께 박제
    await adminClient.from('work_status_events').insert({
      work_date:       date,
      user_email:      user.email!,
      user_profile_id: profile?.id ?? null,
      work_log_id:     existing.work_log_id ?? null,
      event_type:      'break_end',
      event_value:     {
        session_minutes:        breakSessionMinutes,
        lunch_overlap_minutes:  lunchOverlapMinutes,
        // overlap 없으면 'none', 있으면 사용자 선택 또는 클라가 안 보낸 경우 'unspecified'
        lunch_overlap_choice:   lunchOverlapMinutes > 0 ? (lunchOverlapChoice ?? 'unspecified') : 'none',
        effective_session_minutes: effectiveSessionMinutes,
      },
      event_at:        now,
      created_by:      user.email!,
    })

    // Teams 휴게 종료 알림 — 2026-05-19 v1.21: await + maxDuration=60
    // v1.32 (2026-05-27): 알림에 실제 휴게 시간 범위 + 경과/차감 예정 + 메모 함께 표시.
    //   계산 로직은 위에서 이미 한 결과 그대로 재사용 — 추가 계산 없음.
    let memoForNotify: string | null = null
    if (existing.work_log_id) {
      try {
        const { data: wlForMemo } = await adminClient
          .from('work_logs')
          .select('work_content')
          .eq('id', existing.work_log_id)
          .maybeSingle()
        const wc = (wlForMemo?.work_content as string | null) ?? ''
        memoForNotify = wc.trim() || null
      } catch { /* 무시 — best-effort */ }
    }
    await notifyBreakEnded({
      name: profile?.display_name || user.email!,
      date,
      // v1.79 — 알림에 박는 시각도 조정된 값 기준
      breakAt: finalBreakEndedAt,
      workLocation: existing.current_location ?? '',
      division: profile?.division ?? null,
      // 본부 직속(team 없음) → admin 지정 notify_team으로 라우팅
      team: resolveRoutingTeam(profile?.team, profile?.notify_team) || null,
      breakStartedAt: finalBreakStartedAt,
      actualMinutes: breakSessionMinutes,
      roundedMinutes: breakSessionMinutes > 0 ? ceilTo30Min(breakSessionMinutes) : 0,
      memo: memoForNotify,
    })

    return NextResponse.json(daily)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
