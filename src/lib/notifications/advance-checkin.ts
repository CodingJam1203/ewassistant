/**
 * v1.50 (2026-05-27) — 사전등록 알림 발송 헬퍼.
 *
 * 두 호출 지점이 공통으로 사용:
 *   1) /api/work-logs POST 의 D+1 사전등록 분기 (퇴근보고 + 명일 출근 동반 등록)
 *   2) /api/team-status/check-in POST 의 caseMode='none'/'future' 분기
 *      (당일 첫 출근보고, 미래 일자 사전등록)
 *
 * 정책:
 *   - 본부 `org_divisions.notify_on_advance_checkin=true`일 때만 발송
 *   - 발송 직전 사용자의 leave_date 일정(events) + 휴가(leaveLabel)를 캘린더 lookup으로 조회
 *   - notifyCheckinSubmitted(출근완료)와 별개로 둘 다 발송 (정책 P1)
 *
 * best-effort: 알림 발송 실패해도 호출처 흐름 막지 않음.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { notifyAdvanceCheckinSubmitted } from '@/lib/notifications/teams'
import { resolveRoutingTeam } from '@/lib/org'
import { fetchOrgCalendarLookup, toKstTime } from '@/lib/org-calendar/lookup'

interface MaybeAdvanceCheckinArgs {
  adminClient: SupabaseClient
  /** 사용자 이메일 (lowercase 보장) */
  userEmail: string
  /** 사용자 표시명 */
  userName: string
  /** 본부명 (라우팅용) */
  division: string | null
  /** 팀명 (라우팅용 — NULL이면 notify_team으로 치환) */
  team: string | null
  /** 본부 직속 인원의 알림 라우팅 팀 */
  notifyTeam?: string | null
  /** 사전등록한 출근 일자 */
  leaveDate: string
  /** 출근예정 시각 (HH:mm) */
  plannedStart: string
  /** 퇴근예정 시각 (HH:mm) */
  plannedEnd: string
  /** 예정 근무장소 라벨 */
  plannedLocation: string
  /** 메모 (work_content) */
  memo?: string | null
}

/**
 * 본부 플래그 켜져있으면 사전등록 알림 발송. 끄져있으면 silent skip.
 * 사용자 leaveDate 일정도 함께 조회해 메시지에 포함.
 */
export async function maybeNotifyAdvanceCheckin(args: MaybeAdvanceCheckinArgs): Promise<void> {
  const { adminClient, userEmail, userName, division, team, notifyTeam, leaveDate } = args
  if (!division) return

  try {
    // 1) 본부 플래그 조회
    const { data: divRow } = await adminClient
      .from('org_divisions')
      .select('notify_on_advance_checkin')
      .eq('name', division)
      .maybeSingle()
    if (!divRow?.notify_on_advance_checkin) return

    // 2) 사용자 leaveDate 일정 + 휴가 조회 (best-effort)
    let events: Array<{ startTime: string | null; endTime: string | null; title: string }> = []
    let leaveLabel: string | null = null
    try {
      const lookup = await fetchOrgCalendarLookup({
        adminClient,
        emails: [userEmail.toLowerCase()],
        dates: [leaveDate],
      })
      const rec = lookup.byEmail.get(userEmail.toLowerCase())
      const dayLookup = rec?.[leaveDate]
      if (dayLookup) {
        events = (dayLookup.events ?? []).map(ev => ({
          startTime: ev.startTime ?? (ev.isAllDay === false && ev.startAt ? toKstTime(ev.startAt) : null),
          endTime:   ev.endTime   ?? (ev.isAllDay === false && ev.endAt   ? toKstTime(ev.endAt)   : null),
          title:     ev.title ?? '',
        }))
        leaveLabel = dayLookup.leaveLabel ?? null
      }
    } catch (lookupErr) {
      console.warn('[advance-checkin] calendar lookup failed (non-fatal):', lookupErr)
    }

    // 3) 라우팅용 effective team (본부 직속이면 notify_team 치환)
    const effectiveTeam = resolveRoutingTeam(team ?? null, notifyTeam ?? null)

    // 4) 알림 발송
    await notifyAdvanceCheckinSubmitted({
      name: userName,
      leaveDate,
      plannedStart: args.plannedStart,
      plannedEnd:   args.plannedEnd,
      plannedLocation: args.plannedLocation,
      memo: args.memo ?? null,
      events,
      leaveLabel,
      division,
      team: effectiveTeam || null,
    })
  } catch (err) {
    // best-effort — 알림 실패가 work_logs 흐름 막지 않게.
    console.warn('[advance-checkin] notify failed (non-fatal):', err)
  }
}
