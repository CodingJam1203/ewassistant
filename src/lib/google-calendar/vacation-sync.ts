/**
 * Phase 1.5b — N-Click 휴가 ↔ Google Calendar 양방향 sync helper.
 *
 * 진입점: /api/work-logs POST 안 UPSERT 직후 best-effort hook 호출.
 *
 * 정책:
 *   - 사용자 본부에 calendar_type='vacation' 캘린더 등록된 경우만 sync 동작 (org_calendars 기반)
 *   - sync 대상 캘린더 우선순위: 사용자 팀 vacation → 본부 공용 vacation → 첫 매칭
 *   - leave_timeline diff:
 *       · prev에 있고 next에 없는 google_event_id → Google events.delete
 *       · next에 google_event_id 없는 entry → events.insert → 결과 id를 entry.google_event_id에 채움
 *       · 양쪽 다 있고 내용 다르면 events.update
 *   - 시간 매핑:
 *       · leaveType === 'full_day' → 종일 이벤트 (start.date / end.date)
 *       · 그 외 → 부분 이벤트 — startTime 부터 actualMinutes 만큼 (start.dateTime ~ end.dateTime)
 *   - 실패는 best-effort — 모든 Google API 에러를 throw 안 하고 로그만 남김
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { getGoogleCalendarClient, extractCalendarRawId } from './client'
import type { LeaveTimeline, LeaveTimelineItem } from '@/types/leave-timeline'

interface VacationCalendar {
  id: string
  rawCalId: string
  division_id: string
  team_id: string | null
}

/**
 * 사용자 본부의 vacation 캘린더 식별.
 * 본부에 vacation 캘린더 없으면 null — 호출자가 sync skip.
 */
export async function getUserVacationCalendar(
  adminClient: SupabaseClient,
  userEmail: string,
): Promise<VacationCalendar | null> {
  const { data: profile } = await adminClient
    .from('user_profiles')
    .select('division, team')
    .eq('email', userEmail)
    .maybeSingle()
  if (!profile?.division) return null

  const { data: div } = await adminClient
    .from('org_divisions')
    .select('id')
    .eq('name', profile.division)
    .maybeSingle()
  if (!div) return null

  let teamId: string | null = null
  if (profile.team) {
    const { data: team } = await adminClient
      .from('org_teams')
      .select('id')
      .eq('division_id', div.id)
      .eq('name', profile.team)
      .maybeSingle()
    if (team) teamId = team.id
  }

  const { data: candidates } = await adminClient
    .from('org_calendars')
    .select('id, google_calendar_id, division_id, team_id')
    .eq('division_id', div.id)
    .eq('calendar_type', 'vacation')
    .eq('is_active', true)
    .returns<Array<{ id: string; google_calendar_id: string; division_id: string; team_id: string | null }>>()
  if (!candidates || candidates.length === 0) return null

  const pick =
    candidates.find(c => c.team_id === teamId) ??
    candidates.find(c => c.team_id === null) ??
    candidates[0]

  return {
    id: pick.id,
    rawCalId: extractCalendarRawId(pick.google_calendar_id),
    division_id: pick.division_id,
    team_id: pick.team_id,
  }
}

/** YYYY-MM-DD KST 그날 + n일 → YYYY-MM-DD */
function addDaysToKstDate(yyyymmdd: string, n: number): string {
  const [y, m, d] = yyyymmdd.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d + n))
  const pad = (x: number) => String(x).padStart(2, '0')
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
}

/** entry → Google event requestBody */
function buildVacationEventBody(
  leaveDate: string,
  userDisplayName: string,
  entry: LeaveTimelineItem,
): import('googleapis').calendar_v3.Schema$Event {
  const title = `[${userDisplayName}] ${entry.label}`
  if (entry.leaveType === 'full_day') {
    return {
      summary: title,
      start: { date: leaveDate },
      end:   { date: addDaysToKstDate(leaveDate, 1) },  // exclusive
    }
  }
  // 부분 휴가 — startTime부터 actualMinutes 만큼
  const [hh, mm] = entry.startTime.split(':').map(Number)
  const totalEndMin = hh * 60 + mm + entry.actualMinutes
  const eh = Math.floor(totalEndMin / 60)
  const em = totalEndMin % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return {
    summary: title,
    start: { dateTime: `${leaveDate}T${pad(hh)}:${pad(mm)}:00+09:00`, timeZone: 'Asia/Seoul' },
    end:   { dateTime: `${leaveDate}T${pad(eh)}:${pad(em)}:00+09:00`, timeZone: 'Asia/Seoul' },
  }
}

/** 두 entry가 Google 측 변경을 요구하는지 (내용 diff) */
function entryChanged(a: LeaveTimelineItem, b: LeaveTimelineItem): boolean {
  return a.label !== b.label
      || a.leaveType !== b.leaveType
      || a.startTime !== b.startTime
      || a.endTime !== b.endTime
      || a.actualMinutes !== b.actualMinutes
}

export interface SyncVacationResult {
  /** Google 측 변경이 1건이라도 발생했는지 (호출자가 work_logs.leave_timeline 재update 필요) */
  changed: boolean
  /** google_event_id 채워진 새 leave_timeline. sync 대상 아니거나 변경 없으면 null */
  updatedTimeline: LeaveTimeline | null
  /** sync 대상 본부 아니면 true */
  skipped: boolean
}

/**
 * work_logs UPSERT 직후 호출. prev → next diff 산출 → Google API insert/update/delete.
 * 실패는 best-effort: 일부 entry 실패해도 다른 entry 계속 처리. 응답에 changed 여부 반환.
 *
 * 호출 예시:
 *   const r = await syncLeaveTimelineWithGoogle({...})
 *   if (r.changed && r.updatedTimeline) {
 *     await admin.from('work_logs').update({ leave_timeline: r.updatedTimeline }).eq('id', rowId)
 *   }
 */
export async function syncLeaveTimelineWithGoogle(args: {
  adminClient: SupabaseClient
  userEmail: string
  userDisplayName: string
  leaveDate: string  // 'YYYY-MM-DD'
  prev: LeaveTimeline
  next: LeaveTimeline
}): Promise<SyncVacationResult> {
  const { adminClient, userEmail, userDisplayName, leaveDate, prev, next } = args

  const vacationCal = await getUserVacationCalendar(adminClient, userEmail)
  if (!vacationCal) {
    return { changed: false, updatedTimeline: null, skipped: true }
  }

  const cal = getGoogleCalendarClient()
  const prevById = new Map<string, LeaveTimelineItem>()
  for (const p of prev) {
    if (p.google_event_id) prevById.set(p.google_event_id, p)
  }
  const nextIds = new Set<string>()
  for (const n of next) {
    if (n.google_event_id) nextIds.add(n.google_event_id)
  }

  // 1) Google delete — prev에 있고 next에 없는 google_event_id
  for (const id of prevById.keys()) {
    if (nextIds.has(id)) continue
    try {
      await cal.events.delete({ calendarId: vacationCal.rawCalId, eventId: id })
    } catch (err: unknown) {
      const code = (err as { code?: number; status?: number })?.code
                  ?? (err as { code?: number; status?: number })?.status
      if (code !== 404 && code !== 410) {
        console.error('[vacation-sync] delete failed:', id, err)
      }
    }
  }

  // 2) next 각 entry 처리 — insert / update / 변경 없음
  let changed = prevById.size > 0 && Array.from(prevById.keys()).some(id => !nextIds.has(id))
  const updatedNext: LeaveTimeline = []

  for (const entry of next) {
    if (!entry.google_event_id) {
      // 새 entry — insert
      try {
        const body = buildVacationEventBody(leaveDate, userDisplayName, entry)
        const ins = await cal.events.insert({ calendarId: vacationCal.rawCalId, requestBody: body })
        const newId = ins.data.id ?? null
        if (newId) {
          updatedNext.push({ ...entry, google_event_id: newId })
          changed = true
          continue
        }
      } catch (err) {
        console.error('[vacation-sync] insert failed:', entry.label, err)
      }
      // insert 실패 — entry 그대로
      updatedNext.push(entry)
    } else {
      const prevEntry = prevById.get(entry.google_event_id)
      if (prevEntry && entryChanged(prevEntry, entry)) {
        try {
          const body = buildVacationEventBody(leaveDate, userDisplayName, entry)
          await cal.events.update({
            calendarId: vacationCal.rawCalId,
            eventId: entry.google_event_id,
            requestBody: body,
          })
          changed = true
        } catch (err) {
          console.error('[vacation-sync] update failed:', entry.google_event_id, err)
        }
      }
      updatedNext.push(entry)
    }
  }

  return {
    changed,
    updatedTimeline: changed ? updatedNext : null,
    skipped: false,
  }
}
