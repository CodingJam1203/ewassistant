import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { notifyLocationChanged } from '@/lib/notifications/teams'
import { getKstTodayDateString } from '@/lib/utils/date'
import {
  appendWorkLocationToTimeline,
  nowKstHHmmFloor,
} from '@/lib/work-location-timeline'
import {
  KOREAN_LABEL_TO_TYPE,
  WORK_LOCATION_TYPE_LABELS,
  type WorkLocationItem,
  type WorkLocationTimeline,
  type WorkLocationType,
} from '@/types/work-location-timeline'

/** 사용자가 입력한 location 문자열을 work_location 항목으로 변환 */
function locationStringToItem(location: string, startTime: string): Omit<WorkLocationItem, 'kind'> {
  const trimmed = location.trim()
  if (KOREAN_LABEL_TO_TYPE[trimmed]) {
    const type: WorkLocationType = KOREAN_LABEL_TO_TYPE[trimmed]
    return {
      type,
      label: WORK_LOCATION_TYPE_LABELS[type],
      customLabel: null,
      startTime,
    }
  }
  // 알려진 한글 라벨이 아니면 custom
  return {
    type: 'custom',
    label: WORK_LOCATION_TYPE_LABELS.custom,
    customLabel: trimmed,
    startTime,
  }
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json()
    const date: string     = body.date ?? getKstTodayDateString()
    const location: string = body.location ?? ''
    if (!location.trim()) {
      return NextResponse.json({ error: '근무지를 입력해주세요.' }, { status: 400 })
    }

    const now     = new Date().toISOString()
    const flooredTime = nowKstHHmmFloor()  // KST 현재 시각 30분 단위 내림
    const adminClient = createAdminClient()

    const { data: profile } = await adminClient
      .from('user_profiles')
      .select('id, display_name, division, team')
      .eq('email', user.email!)
      .single()

    const { data: existingStatus } = await adminClient
      .from('daily_work_status')
      .select('current_location')
      .eq('work_date', date)
      .eq('user_email', user.email!)
      .maybeSingle()
    const previousLocation = existingStatus?.current_location ?? ''

    const { data: daily, error: dailyErr } = await adminClient
      .from('daily_work_status')
      .upsert({
        work_date:        date,
        user_email:       user.email!,
        user_profile_id:  profile?.id ?? null,
        current_location: location,
        updated_at:       now,
      }, { onConflict: 'work_date,user_email' })
      .select()
      .single()

    if (dailyErr) throw dailyErr

    let updatedTimeline: WorkLocationTimeline | null = null
    let timelineChanged = false

    if (daily?.work_log_id) {
      const { data: wLog } = await adminClient
        .from('work_logs')
        .select('work_location_timeline, location_history')
        .eq('id', daily.work_log_id)
        .single()

      const currentTimeline = Array.isArray(wLog?.work_location_timeline)
        ? wLog!.work_location_timeline as WorkLocationTimeline
        : null

      // legacy location_history 누적 유지
      const history: unknown[] = Array.isArray(wLog?.location_history) ? wLog!.location_history : []
      history.push({ time: flooredTime, location, source: 'status_change' })

      const updates: Record<string, unknown> = {
        location_history: history,
        work_location: location, // legacy mirror
      }

      // timeline이 있으면 누적 시도
      if (currentTimeline) {
        const newItem = locationStringToItem(location, flooredTime)
        const result = appendWorkLocationToTimeline(currentTimeline, newItem)
        updatedTimeline = result.next
        timelineChanged = result.changed
        if (result.changed) {
          updates.work_location_timeline = result.next
        }
      }

      await adminClient
        .from('work_logs')
        .update(updates)
        .eq('id', daily.work_log_id)
    }

    await adminClient.from('work_status_events').insert({
      work_date:       date,
      user_email:      user.email!,
      user_profile_id: profile?.id ?? null,
      work_log_id:     daily?.work_log_id ?? null,
      event_type:      'location_change',
      event_value:     { location, time: flooredTime, timeline_changed: timelineChanged },
      event_at:        now,
      created_by:      user.email!,
    })

    // Teams 근무지 변경 알림
    notifyLocationChanged({
      name: profile?.display_name || user.email!,
      date,
      previousLocation,
      newLocation: location,
      changedAt: now,
      timeline: updatedTimeline ?? undefined,
      division: profile?.division ?? null,
      team: profile?.team ?? null,
    })

    return NextResponse.json(daily)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
