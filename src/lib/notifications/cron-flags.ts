/**
 * v1.51 (2026-05-27) — 팀별 cron 알림 ON/OFF 플래그 조회.
 *
 * 정책:
 *   - org_teams 의 notify_morning_07 / notify_reminder_20 / notify_reminder_22 컬럼 (default true).
 *   - 3개 cron 라우트(morning-summary 07 / reminder-20 / reminder-22)에서 팀 그룹 iteration 시
 *     해당 플래그 false면 그 팀만 skip.
 *   - 본부 직속(team=NULL) 인원은 notify_team의 effective team 그룹에 합류하므로 자동으로
 *     그 팀 플래그에 따라감.
 *
 * 조회 키 = `${division}||${team}` — cron 라우트 teamGroups Map 키와 정합 맞춤.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export type CronFlagKey = 'notify_morning_07' | 'notify_reminder_20' | 'notify_reminder_22'

export interface TeamCronFlags {
  notify_morning_07:  boolean
  notify_reminder_20: boolean
  notify_reminder_22: boolean
}

/**
 * org_divisions + org_teams 조회 → `${division}||${team}` 키로 cron 플래그 lookup map 반환.
 * 매핑 없는 팀(자유 입력 등 org_teams에 row 없음)은 map에 없음 — 호출처에서 default true로 처리.
 */
export async function loadTeamCronFlags(
  adminClient: SupabaseClient,
): Promise<Map<string, TeamCronFlags>> {
  const result = new Map<string, TeamCronFlags>()

  const [{ data: divs }, { data: teams }] = await Promise.all([
    adminClient.from('org_divisions').select('id, name'),
    adminClient
      .from('org_teams')
      .select('division_id, name, notify_morning_07, notify_reminder_20, notify_reminder_22'),
  ])

  if (!divs || !teams) return result

  const divNameById = new Map<string, string>()
  for (const d of divs as Array<{ id: string; name: string }>) {
    divNameById.set(d.id, d.name)
  }

  for (const t of teams as Array<{
    division_id: string
    name: string
    notify_morning_07: boolean | null
    notify_reminder_20: boolean | null
    notify_reminder_22: boolean | null
  }>) {
    const divName = divNameById.get(t.division_id)
    if (!divName) continue
    const key = `${divName}||${t.name}`
    result.set(key, {
      notify_morning_07:  t.notify_morning_07  ?? true,
      notify_reminder_20: t.notify_reminder_20 ?? true,
      notify_reminder_22: t.notify_reminder_22 ?? true,
    })
  }

  return result
}

/** flag map 에서 (division, team) 키로 특정 flag 값을 얻는다. 매핑 없으면 default true. */
export function isCronFlagOn(
  flags: Map<string, TeamCronFlags>,
  division: string,
  team: string,
  flagKey: CronFlagKey,
): boolean {
  const row = flags.get(`${division}||${team}`)
  if (!row) return true
  return row[flagKey]
}
