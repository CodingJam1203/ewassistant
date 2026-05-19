/**
 * 캘린더 이벤트 → N-Click 사용자 매핑.
 *
 * 매핑 소스 (우선순위):
 *   1. iCal ATTENDEE 이메일 → user_profiles.email 직접 매칭 (회의 케이스)
 *   2. title 한국어 이름 parse → user_profiles.display_name 매칭 (휴가 케이스)
 *      - "[김재민] 휴가", "[김재민, 박솔내] 미팅" 같은 패턴 인식
 *      - 또는 본문에 이름 단독 (말끝 2글자 이상)
 *   3. (Phase 2) org_tags alias 매핑 — "[A파트]" 등
 *
 * 반환: 매칭된 user_profiles.email 배열 (정규화: lowercase + dedup)
 */

import type { SupabaseClient } from '@supabase/supabase-js'

interface UserLookupRow {
  email: string
  display_name: string | null
}

/**
 * 활성 사용자 lookup map 생성.
 * cron sync 1회 호출당 1번만 fetch (캐싱 가능 — 단순 in-memory).
 */
export async function loadUserLookup(adminClient: SupabaseClient): Promise<{
  byEmail: Map<string, UserLookupRow>
  byName:  Map<string, UserLookupRow[]>
}> {
  const { data, error } = await adminClient
    .from('user_profiles')
    .select('email, display_name')
    .eq('is_active', true)

  const byEmail = new Map<string, UserLookupRow>()
  const byName  = new Map<string, UserLookupRow[]>()
  if (error || !data) return { byEmail, byName }

  for (const row of data) {
    const email = (row.email ?? '').toLowerCase().trim()
    const name  = (row.display_name ?? '').trim()
    if (!email) continue
    const obj: UserLookupRow = { email, display_name: name || null }
    byEmail.set(email, obj)
    if (name) {
      const list = byName.get(name) ?? []
      list.push(obj)
      byName.set(name, list)
    }
  }
  return { byEmail, byName }
}

/** title에서 대괄호 안 이름 토큰 추출. "[김재민, 박솔내]" → ['김재민', '박솔내'] */
function extractBracketNames(title: string): string[] {
  const m = title.match(/\[([^\]]+)\]/)
  if (!m) return []
  return m[1]
    .split(/[,+&·\/]/)
    .map(s => s.trim())
    .filter(s => s.length >= 2 && /^[가-힣A-Za-z]+$/.test(s))
}

interface MatchInput {
  title: string
  attendeeEmails: string[]
}

/** 이벤트 1건 → matched user emails */
export function matchUsers(
  ev: MatchInput,
  lookup: { byEmail: Map<string, UserLookupRow>; byName: Map<string, UserLookupRow[]> },
): string[] {
  const matched = new Set<string>()

  // 1) attendee 이메일 매칭
  for (const e of ev.attendeeEmails) {
    const u = lookup.byEmail.get(e.toLowerCase().trim())
    if (u) matched.add(u.email)
  }

  // 2) title 대괄호 안 이름 매칭
  const names = extractBracketNames(ev.title ?? '')
  for (const n of names) {
    const list = lookup.byName.get(n)
    if (list && list.length > 0) {
      for (const u of list) matched.add(u.email)
    }
  }

  return Array.from(matched).sort()
}

/**
 * 이벤트 inferred_type 결정.
 *   - calendar_type이 'vacation'·'birthday'면 그대로
 *   - 'meeting'이지만 title에 "휴가/연차/반차" 포함 → 'vacation'
 *   - 'other'는 title parse fallback
 */
export function inferEventType(
  calendarType: 'meeting' | 'vacation' | 'birthday' | 'other',
  title: string,
): 'meeting' | 'vacation' | 'birthday' | 'other' {
  if (calendarType === 'vacation' || calendarType === 'birthday') return calendarType
  if (/휴가|연차|반차|오전반차|오후반차/.test(title)) return 'vacation'
  if (calendarType === 'meeting') return 'meeting'
  return 'other'
}
