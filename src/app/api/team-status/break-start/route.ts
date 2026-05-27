import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getKstTodayDateString } from '@/lib/utils/date'
import { kstHHmmToIso } from '@/lib/utils/kst-datetime'
import { notifyBreakStarted } from '@/lib/notifications/teams'
import { resolveRoutingTeam } from '@/lib/org'

// 2026-05-19 v1.21: notify await 대응 — sendToMake retry 최악 31.5s + DB 처리 여유.
export const maxDuration = 60

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json()
    const date: string = body.date ?? getKstTodayDateString()
    const now = new Date().toISOString()
    // v1.44 — body.startTime(HH:mm, 30분 단위 floor)이 있으면 그 시각의 KST ISO로 break_started_at 설정.
    // 없으면 기존 즉시 동작(now). 토글(home USE_BREAK_MODAL_FLOW)로 두 흐름 공존.
    const startTimeRaw = typeof body.startTime === 'string' ? body.startTime.trim() : ''
    const effectiveBreakStartIso = startTimeRaw
      ? kstHHmmToIso(date, startTimeRaw)
      : now
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

    if (!existing?.checked_in_at) {
      return NextResponse.json({ error: '출근 상태가 아닙니다.' }, { status: 400 })
    }
    if (existing.checked_out_at) {
      return NextResponse.json({ error: '이미 퇴근한 상태입니다.' }, { status: 400 })
    }

    const { data: daily, error } = await adminClient
      .from('daily_work_status')
      .update({
        status:           'on_break',
        is_on_break:      true,
        break_started_at: effectiveBreakStartIso,
        break_ended_at:   null,
        updated_at:       now,
      })
      .eq('work_date', date)
      .eq('user_email', user.email!)
      .select()
      .single()

    if (error) throw error

    // v1.44 — body.memo가 string으로 들어오면(빈 문자열 포함) work_logs.work_content 업데이트.
    // 기존 메모 정책 공유 (출근/퇴근 메모와 같은 컬럼, 덮어쓰기 허용).
    // body.memo 키 없으면(기존 즉시 호출 호환) 처리 안 함.
    if (typeof body.memo === 'string' && existing.work_log_id) {
      const memoVal = body.memo.trim() || null
      await adminClient
        .from('work_logs')
        .update({ work_content: memoVal })
        .eq('id', existing.work_log_id)
    }

    await adminClient.from('work_status_events').insert({
      work_date:       date,
      user_email:      user.email!,
      user_profile_id: profile?.id ?? null,
      work_log_id:     existing.work_log_id ?? null,
      event_type:      'break_start',
      event_value:     {},
      event_at:        now,
      created_by:      user.email!,
    })

    // Teams 휴게 시작 알림 — 2026-05-19 v1.21: await + maxDuration=60
    // v1.32 (2026-05-27): 알림에 휴게 종료 예정 + 메모도 함께 표시.
    //   breakAt = 사용자가 입력한 시작시간이 있으면 그 ISO(effectiveBreakStartIso), 없으면 now.
    //   breakEndPlanned = 사용자가 모달에서 입력한 HH:mm (표시용, DB 저장 X).
    //   memo = body.memo (있을 때만 라인 추가).
    const endPlannedRaw = typeof body.endPlanned === 'string' ? body.endPlanned.trim() : ''
    const memoForNotify = typeof body.memo === 'string' ? body.memo.trim() : ''
    await notifyBreakStarted({
      name: profile?.display_name || user.email!,
      date,
      breakAt: effectiveBreakStartIso,
      workLocation: existing.current_location ?? '',
      division: profile?.division ?? null,
      // 본부 직속(team 없음) → admin 지정 notify_team으로 라우팅
      team: resolveRoutingTeam(profile?.team, profile?.notify_team) || null,
      breakEndPlanned: endPlannedRaw || null,
      memo: memoForNotify || null,
    })

    return NextResponse.json(daily)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
