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
  firstChipLabel,
  chipLabel,
  formatChipsArrow,
} from '@/lib/work-locations-v2'
import type { WorkLocations } from '@/types/work-locations-v2'

/**
 * POST /api/team-status/location
 *
 * body:
 *   date: YYYY-MM-DD
 *   location: string (한글 라벨 또는 직접 입력)
 *   target: 'planned' | 'actual'  (기본: 'planned')
 *
 * 정책 (v2):
 *   - target='planned' (기본): 1번 카드(My Page) 또는 둘러보기 카드의 "예정" 영역에서 변경
 *     → planned_work_locations에 칩 append. 예정 갱신.
 *   - target='actual': 둘러보기 카드의 "실제" 영역에서 변경 (본인 카드만)
 *     → actual_work_locations에 칩 append. 실제 갱신.
 *
 * 둘 다 daily_work_status.current_location은 갱신 (지금 어디 있는지 단일 트래킹).
 * legacy timeline은 호환을 위해 함께 누적.
 */

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
    const target: 'planned' | 'actual' | 'actual_replace' | 'current' =
      (body.target === 'actual' || body.target === 'actual_replace' || body.target === 'current')
        ? body.target : 'planned'

    // current/actual_replace 외의 케이스에서 location 검증
    if ((target === 'planned' || target === 'actual' || target === 'current') && !location.trim()) {
      return NextResponse.json({ error: '근무지를 입력해주세요.' }, { status: 400 })
    }
    // actual_replace는 body.locations(배열) 받음 — 빈 배열도 허용 (전체 비우기)
    if (target === 'actual_replace' && !Array.isArray(body.locations)) {
      return NextResponse.json({ error: 'actual_replace는 locations 배열이 필요합니다.' }, { status: 400 })
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

    // current_location 결정 — target별 분기
    let effectiveCurrentLocation: string = location
    if (target === 'actual_replace') {
      // 기존 current가 새 chips에 있으면 유지, 없으면 첫 칩 라벨로 자동 잡기
      const newChips = normalizeWorkLocations(body.locations) ?? []
      const hasMatch = newChips.some(c => chipLabel(c).trim() === (previousLocation ?? '').trim())
      effectiveCurrentLocation = hasMatch
        ? (previousLocation ?? firstChipLabel(newChips))
        : firstChipLabel(newChips)
    }

    const { data: daily, error: dailyErr } = await adminClient
      .from('daily_work_status')
      .upsert({
        work_date:        date,
        user_email:       user.email!,
        user_profile_id:  profile?.id ?? null,
        current_location: effectiveCurrentLocation,
        updated_at:       now,
      }, { onConflict: 'work_date,user_email' })
      .select()
      .single()

    if (dailyErr) throw dailyErr

    let updatedTimeline: WorkLocationTimeline | null = null
    let timelineChanged = false
    let updatedPlannedLocs: WorkLocations | null = null
    let updatedActualLocs: WorkLocations | null = null
    let chipsChanged = false

    if (daily?.work_log_id) {
      const { data: wLog } = await adminClient
        .from('work_logs')
        .select('work_location_timeline, location_history, planned_work_locations, actual_work_locations, work_location')
        .eq('id', daily.work_log_id)
        .single()

      const currentTimeline = Array.isArray(wLog?.work_location_timeline)
        ? wLog!.work_location_timeline as WorkLocationTimeline
        : null

      // legacy location_history 누적 유지
      const history: unknown[] = Array.isArray(wLog?.location_history) ? wLog!.location_history : []
      history.push({ time: flooredTime, location: effectiveCurrentLocation, source: 'status_change' })

      const updates: Record<string, unknown> = {
        location_history: history,
        work_location: effectiveCurrentLocation, // legacy mirror (단일 문자열) — 항상 갱신
      }

      // legacy timeline은 호환 유지 (target과 무관하게)
      if (currentTimeline) {
        const newItem = locationStringToItem(location, flooredTime)
        const result = appendWorkLocationToTimeline(currentTimeline, newItem)
        updatedTimeline = result.next
        timelineChanged = result.changed
        if (result.changed) {
          updates.work_location_timeline = result.next
        }
      }

      // ─── v2 chips append — target에 따라 분기 ─────────────────────────
      const newChip = locationStringToChip(location)

      if (target === 'actual_replace') {
        // actual_work_locations 전체 교체 (body.locations 배열 그대로 set)
        const replaced = normalizeWorkLocations(body.locations) ?? []
        updatedActualLocs = replaced
        chipsChanged = true
        updates.actual_work_locations = replaced
      } else if (target === 'current') {
        // daily.current_location만 갱신, work_logs는 안 건드림
        // (위 daily upsert에서 이미 current_location=location으로 갱신됨)
        // chips는 변경 없음
      } else if (target === 'actual') {
        // actual에 chip append (기존 동작 — 호환용)
        const baseActual: WorkLocations | null =
          normalizeWorkLocations(wLog?.actual_work_locations)
          ?? normalizeWorkLocations(wLog?.planned_work_locations)
          ?? legacyTimelineToLocations(currentTimeline)
          ?? legacySingleToLocations(typeof wLog?.work_location === 'string' ? wLog?.work_location : null)
        const result2 = appendChipIfChanged(baseActual, newChip)
        updatedActualLocs = result2.next
        chipsChanged = result2.changed
        if (result2.changed) {
          updates.actual_work_locations = result2.next
        }
      } else {
        // planned에 chip append (기본)
        const basePlanned: WorkLocations | null =
          normalizeWorkLocations(wLog?.planned_work_locations)
          ?? legacyTimelineToLocations(currentTimeline)
          ?? legacySingleToLocations(typeof wLog?.work_location === 'string' ? wLog?.work_location : null)
        const result2 = appendChipIfChanged(basePlanned, newChip)
        updatedPlannedLocs = result2.next
        chipsChanged = result2.changed
        if (result2.changed) {
          updates.planned_work_locations = result2.next
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
      event_value:     {
        location,
        time: flooredTime,
        target,
        timeline_changed: timelineChanged,
        chips_changed: chipsChanged,
      },
      event_at:        now,
      created_by:      user.email!,
    })

    // Teams 알림 — actual chips + 현재 위치(★)를 함께 전달
    notifyLocationChanged({
      name: profile?.display_name || user.email!,
      date,
      previousLocation,
      newLocation: effectiveCurrentLocation,
      changedAt: now,
      timeline: updatedTimeline ?? undefined,
      actualWorkLocations: updatedActualLocs
        ?? (target === 'actual_replace' ? normalizeWorkLocations(body.locations) ?? undefined : undefined),
      currentLabel: effectiveCurrentLocation,
      division: profile?.division ?? null,
      team: profile?.team ?? null,
    })

    return NextResponse.json({
      ...daily,
      target,
      planned_work_locations: updatedPlannedLocs,
      actual_work_locations: updatedActualLocs,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
