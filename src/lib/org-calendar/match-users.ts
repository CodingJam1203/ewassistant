/**
 * 캘린더 이벤트 → N-Click 사용자 매핑.
 *
 * 매핑 소스 (우선순위, 모두 시도 후 dedup):
 *   1. iCal ATTENDEE 이메일 → user_profiles.email 직접 매칭 (회의 케이스)
 *   2. title 대괄호 안 토큰 → user_profiles.display_name 풀네임 매칭
 *   3. title 대괄호 안 토큰 마지막 2글자(suffix) → display_name suffix 매칭 (Apps Script 호환)
 *   4. title 대괄호 안 토큰 → org_tags.alias_patterns 매칭 (Phase 3, 본부 단위 scope)
 *      - alias가 잡히면 그 tag의 member_emails 전부 expand
 *
 * 반환: 매칭된 user_profiles.email 배열 (정규화: lowercase + dedup)
 */

import type { SupabaseClient } from '@supabase/supabase-js'

interface UserLookupRow {
  email: string
  display_name: string | null
}

interface OrgTagRow {
  division_id: string
  alias_patterns: string[] | null
  member_emails: string[] | null
}

export interface UserLookup {
  byEmail: Map<string, UserLookupRow>
  byName:  Map<string, UserLookupRow[]>
  byNameSuffix: Map<string, UserLookupRow[]>  // 풀네임 마지막 2글자 (Apps Script 호환)
  /**
   * 본부별 alias → expand 대상 email[]. Phase 3.
   * key: divisionId, value: Map<alias 문자열, lowercase email 배열>.
   * 한 alias가 여러 tag에 등장하면 email들이 union(dedup).
   */
  byTagAlias: Map<string, Map<string, string[]>>
}

/**
 * 활성 사용자 + org_tags lookup map 생성.
 * sync 1회 호출당 1번만 fetch — match-users는 동기 함수.
 */
export async function loadUserLookup(adminClient: SupabaseClient): Promise<UserLookup> {
  // 사용자 + tag 병렬 fetch
  const [usersRes, tagsRes] = await Promise.all([
    adminClient.from('user_profiles').select('email, display_name').eq('is_active', true),
    adminClient.from('org_tags').select('division_id, alias_patterns, member_emails').eq('is_active', true),
  ])

  const byEmail = new Map<string, UserLookupRow>()
  const byName  = new Map<string, UserLookupRow[]>()
  const byNameSuffix = new Map<string, UserLookupRow[]>()
  const byTagAlias   = new Map<string, Map<string, string[]>>()

  if (!usersRes.error && usersRes.data) {
    for (const row of usersRes.data) {
      const email = (row.email ?? '').toLowerCase().trim()
      const name  = (row.display_name ?? '').trim()
      if (!email) continue
      const obj: UserLookupRow = { email, display_name: name || null }
      byEmail.set(email, obj)
      if (name) {
        const list = byName.get(name) ?? []
        list.push(obj)
        byName.set(name, list)
        if (name.length >= 2) {
          const suffix = name.slice(-2)
          const sList = byNameSuffix.get(suffix) ?? []
          sList.push(obj)
          byNameSuffix.set(suffix, sList)
        }
      }
    }
  }

  if (!tagsRes.error && tagsRes.data) {
    for (const row of tagsRes.data as OrgTagRow[]) {
      const divId   = row.division_id
      const aliases = row.alias_patterns ?? []
      const emails  = (row.member_emails ?? []).map(e => e.toLowerCase().trim()).filter(Boolean)
      if (!divId || aliases.length === 0 || emails.length === 0) continue
      let divMap = byTagAlias.get(divId)
      if (!divMap) {
        divMap = new Map<string, string[]>()
        byTagAlias.set(divId, divMap)
      }
      for (const a of aliases) {
        const key = (a ?? '').trim()
        if (!key) continue
        const existing = divMap.get(key) ?? []
        // dedup union
        const merged = Array.from(new Set([...existing, ...emails]))
        divMap.set(key, merged)
      }
    }
  }

  return { byEmail, byName, byNameSuffix, byTagAlias }
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
  /** Phase 3: alias 매칭은 본부 단위 scope. 이벤트가 속한 캘린더의 division. */
  divisionId: string
}

/** 이벤트 1건 → matched user emails */
export function matchUsers(ev: MatchInput, lookup: UserLookup): string[] {
  const matched = new Set<string>()

  // 1) attendee 이메일 매칭
  for (const e of ev.attendeeEmails) {
    const u = lookup.byEmail.get(e.toLowerCase().trim())
    if (u) matched.add(u.email)
  }

  // 2) title 대괄호 안 토큰 매칭 — 풀네임 → suffix → alias 순서로 시도.
  //    하나의 단계라도 잡히면 그 토큰은 거기서 처리 종료 (다른 단계로 안 넘어감).
  const names = extractBracketNames(ev.title ?? '')
  const tagMap = lookup.byTagAlias.get(ev.divisionId) ?? null

  for (const n of names) {
    // 2-1) 풀네임 (예: "박솔내" → "박솔내" user)
    const fullList = lookup.byName.get(n)
    if (fullList && fullList.length > 0) {
      for (const u of fullList) matched.add(u.email)
      continue
    }
    // 2-2) 마지막 2글자 suffix — "솔내" → 풀네임 끝이 "솔내"인 user들 (Apps Script 호환)
    if (n.length >= 2) {
      const suffix = n.slice(-2)
      const sList = lookup.byNameSuffix.get(suffix)
      if (sList && sList.length > 0) {
        for (const u of sList) matched.add(u.email)
        continue
      }
    }
    // 2-3) org_tags alias — 본부별. "[A파트]" 같은 그룹/파트 매칭
    if (tagMap) {
      const emails = tagMap.get(n)
      if (emails && emails.length > 0) {
        for (const em of emails) matched.add(em)
        // continue 생략 — 다음 토큰으로
      }
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
