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
import {
  appendChipIfChanged,
  locationStringToChip,
  normalizeWorkLocations,
  legacyTimelineToLocations,
  legacySingleToLocations,
} from '@/lib/work-locations-v2'
import type { WorkLocations } from '@/types/work-locations-v2'

/** 사용자가 입력한 location 문자열을 legacy work_location 항목으로 변환 */
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
    const flooredTime = nowKstHHmmFloor()
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
    let updatedActualLocs: WorkLocations | null = null
    let actualLocsChanged = false

    if (daily?.work_log_id) {
      const { data: wLog } = await adminClient
        .from('work_logs')
        .select('work_location_timeline, location_history, actual_work_locations, planned_work_locations, work_location')
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
        work_location: location, // legacy mirror (단일 문자열)
      }

      // legacy timeline이 있으면 누적 시도
      if (currentTimeline) {
        const newItem = locationStringToItem(location, flooredTime)
        const result = appendWorkLocationToTimeline(currentTimeline, newItem)
        updatedTimeline = result.next
        timelineChanged = result.changed
        if (result.changed) {
          updates.work_location_timeline = result.next
        }
      }

      // ─── v2: actual_work_locations 칩 누적 ─────────────────────────────
      // 베이스: 기존 actual → planned → legacy timeline → legacy 단일
      // 맨 마지막 칩이 같으면 noop, 다르면 append.
      const baseActual: WorkLocations | null =
        normalizeWorkLocations(wLog?.actual_work_locations)
        ?? normalizeWorkLocations(wLog?.planned_work_locations)
        ?? legacyTimelineToLocations(currentTimeline)
        ?? legacySingleToLocations(typeof wLog?.work_location === 'string' ? wLog?.work_location : null)
      const newChip = locationStringToChip(location)
      const result2 = appendChipIfChanged(baseActual, newChip)
      updatedActualLocs = result2.next
      actualLocsChanged = result2.changed
      if (result2.changed) {
        updates.actual_work_locations = result2.next
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
      event_value:     {
        location,
        time: flooredTime,
        timeline_changed: timelineChanged,
        actual_locs_changed: actualLocsChanged,
      },
      event_at:        now,
      created_by:      user.email!,
    })

    // Teams 근무지 변경 알림 (legacy timeline 그대로 전달, 알림 빌더가 v2 처리는 별도로)
    notifyLocationChanged({
      name: profile?.display_name || user.email!,
      date,
      previousLocation,
      newLocation: location,
      changedAt: now,
      timeline: updatedTimeline ?? undefined,
      actualWorkLocations: updatedActualLocs ?? undefined,
      division: profile?.division ?? null,
      team: profile?.team ?? null,
    })

    return NextResponse.json({
      ...daily,
      actual_work_locations: updatedActualLocs,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
