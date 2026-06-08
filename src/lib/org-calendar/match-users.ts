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
  team_id: string | null
  label: string | null
  alias_patterns: string[] | null
  member_emails: string[] | null
}

/**
 * scopeKey 만들기 — `${divisionId}::${teamId ?? ''}`.
 * 같은 alias label이 본부 안에서도 팀마다 다른 멤버를 가리키는 케이스("[A파트]" 등) 대응.
 * team_id 없는 tag는 본부 공용으로 fallback 검색 대상.
 */
export function makeTagScopeKey(divisionId: string, teamId: string | null): string {
  return `${divisionId}::${teamId ?? ''}`
}

export interface UserLookup {
  byEmail: Map<string, UserLookupRow>
  byName:  Map<string, UserLookupRow[]>
  byNameSuffix: Map<string, UserLookupRow[]>  // 풀네임 마지막 2글자 (Apps Script 호환)
  /**
   * scopeKey → (alias → lowercase email[]). 매칭 시 team scope 우선 → division 공용 fallback.
   * 한 alias가 같은 scope 안 여러 tag에 등장하면 email들이 union(dedup).
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
    adminClient.from('org_tags').select('division_id, team_id, label, alias_patterns, member_emails').eq('is_active', true),
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
      const teamId  = row.team_id  // null이면 본부 공용
      const aliases = row.alias_patterns ?? []
      const emails  = (row.member_emails ?? []).map(e => e.toLowerCase().trim()).filter(Boolean)
      if (!divId || emails.length === 0) continue
      // label도 묵시적 alias로 등록 — 캘린더 이벤트 제목에 라벨 풀텍스트(`마이스팀 A파트(승현팟)`)를
      // 그대로 쓰는 케이스 대응. alias_patterns 어느 하나만 있어도 진행하지만, 둘 다 비면 skip.
      const labelKey = (row.label ?? '').trim()
      if (aliases.length === 0 && !labelKey) continue
      const scopeKey = makeTagScopeKey(divId, teamId)
      let scopeMap = byTagAlias.get(scopeKey)
      if (!scopeMap) {
        scopeMap = new Map<string, string[]>()
        byTagAlias.set(scopeKey, scopeMap)
      }
      const allKeys = labelKey ? [labelKey, ...aliases] : aliases
      for (const a of allKeys) {
        const key = (a ?? '').trim()
        if (!key) continue
        const existing = scopeMap.get(key) ?? []
        // dedup union
        const merged = Array.from(new Set([...existing, ...emails]))
        scopeMap.set(key, merged)
      }
    }
  }

  return { byEmail, byName, byNameSuffix, byTagAlias }
}

/**
 * title에서 대괄호 안 이름 토큰 추출.
 *   "[김재민, 박솔내]"                          → ['김재민', '박솔내']
 *   "[마이스팀 A파트(승현팟), 최종현]" → ['마이스팀 A파트(승현팟)', '최종현']
 *
 * 토큰에 공백·괄호가 섞여 있어도 그대로 보존 — 이후 단계에서 org_tags의 라벨/alias로
 * 정확 매칭 시도하므로 사전 sanitize 하지 않는다. 단 길이 2 미만이거나 한글/영문이
 * 하나도 없는 토큰(빈 칸·숫자·구두점만)은 제거.
 */
function extractBracketNames(title: string): string[] {
  const m = title.match(/\[([^\]]+)\]/)
  if (!m) return []
  return m[1]
    .split(/[,+&·\/]/)
    .map(s => s.trim())
    .filter(s => s.length >= 2 && /[가-힣A-Za-z]/.test(s))
}

/**
 * v1.83.19 — title 시작이 "한글이름 -" / "한글이름:" / "한글이름 " 패턴이면 첫 토큰 추출.
 *   예: "이정영 - 워크샵 TFT 회의" → "이정영"
 *   예: "고려대 삼성E&A 설명회"   → "고려대" (사용자 정확 일치 X → 후속 단계에서 매칭 0)
 *   예: "이성훈 - 이정영 미팅"   → "이성훈" (첫 토큰만 — 중간 이름은 매칭 X)
 *
 * 보수적 룰:
 *   - 한글 2~4글자만 추출 (영문/숫자/대괄호 X)
 *   - 직후가 공백/하이픈/콜론/중점 등 구분자여야 함 (이름의 일부가 아니라 분리된 토큰)
 *   - 매칭은 matchUsers에서 byName 풀네임 정확 일치만 적용 → 잘못된 사용자 매칭 방지
 */
function extractLeadingName(title: string): string | null {
  const m = title.trim().match(/^([가-힣]{2,4})(?=[\s\-:·,|])/)
  return m ? m[1] : null
}

interface MatchInput {
  title: string
  attendeeEmails: string[]
  /** Phase 3: alias 매칭 scope. 이벤트가 속한 캘린더의 division. */
  divisionId: string
  /** Phase 3 후속: team_id가 있으면 그 팀의 alias 우선, fallback으로 division 공용 검색 */
  teamId?: string | null
}

/** 이벤트 1건 → matched user emails */
export function matchUsers(ev: MatchInput, lookup: UserLookup): string[] {
  const matched = new Set<string>()

  // 1) attendee 이메일 매칭
  for (const e of ev.attendeeEmails) {
    const u = lookup.byEmail.get(e.toLowerCase().trim())
    if (u) matched.add(u.email)
  }

  // v1.83.19 — 3) title 시작 첫 토큰이 풀네임이면 매칭 (대괄호 없는 컨벤션 지원).
  //   예: "이정영 - 워크샵 TFT 회의" → 이정영 매칭.
  //   풀네임 정확 일치만 적용(suffix X) → 잘못된 매칭 위험 차단.
  //   기존 대괄호/attendee 매칭과 합집합(Set)으로 dedupe.
  const leadingName = extractLeadingName(ev.title ?? '')
  if (leadingName) {
    const list = lookup.byName.get(leadingName)
    if (list && list.length > 0) {
      for (const u of list) matched.add(u.email)
    }
  }

  // 2) title 대괄호 안 토큰 매칭 — 풀네임 → suffix → alias 순서.
  //    같은 토큰은 첫 매칭 단계에서 종료 (다른 단계로 안 넘어감).
  const names = extractBracketNames(ev.title ?? '')

  // alias scope 우선순위: team(있을 때) → division 공용
  const aliasScopes: Map<string, string[]>[] = []
  if (ev.teamId) {
    const teamMap = lookup.byTagAlias.get(makeTagScopeKey(ev.divisionId, ev.teamId))
    if (teamMap) aliasScopes.push(teamMap)
  }
  const divMap = lookup.byTagAlias.get(makeTagScopeKey(ev.divisionId, null))
  if (divMap) aliasScopes.push(divMap)

  for (const n of names) {
    // 2-1) 풀네임 (예: "박솔내" → "박솔내" user)
    const fullList = lookup.byName.get(n)
    if (fullList && fullList.length > 0) {
      for (const u of fullList) matched.add(u.email)
      continue
    }
    // 2-2) 마지막 2글자 suffix — "솔내" → 풀네임 끝이 "솔내"인 user들 (Apps Script 호환).
    // 이름 형태(순수 한글/영문) 토큰에만 적용. 공백·괄호가 섞인 라벨 토큰
    // ("마이스팀 A파트(승현팟)")에 suffix 휴리스틱을 쓰면 "팟)" 같은 의미 없는 suffix가
    // 우연히 매칭될 수 있으므로 alias 단계로 바로 넘어간다.
    const isNameLike = /^[가-힣A-Za-z]+$/.test(n)
    if (isNameLike && n.length >= 2) {
      const suffix = n.slice(-2)
      const sList = lookup.byNameSuffix.get(suffix)
      if (sList && sList.length > 0) {
        for (const u of sList) matched.add(u.email)
        continue
      }
    }
    // 2-3) org_tags alias — team scope 우선, division 공용 fallback. 첫 매칭 win.
    for (const scopeMap of aliasScopes) {
      const emails = scopeMap.get(n)
      if (emails && emails.length > 0) {
        for (const em of emails) matched.add(em)
        break
      }
    }
  }

  return Array.from(matched).sort()
}

export type EventClassification = 'by_type' | 'by_title'
export type InferredType = 'meeting' | 'vacation' | 'birthday' | 'other'

/**
 * 휴가로 인식할 제목 텍스트. 본부 제목 컨벤션에 맞춰 확장 가능.
 *
 * v1.83.21 (사용자 결정):
 *   - '오프' 완전 제거 (오프닝/킥오프/오프사이트 false positive 광범위 + 휴가 의미 불명확)
 *   - '병가', '경조', '경조사' 추가
 */
const VACATION_KEYWORDS = /휴가|연차|반차|오전반차|오후반차|월차|반반차|연월차|공가|안식월|병가|경조사|경조/

function normalizeNclickType(raw: string | null | undefined): InferredType | null {
  if (raw === 'meeting' || raw === 'vacation' || raw === 'birthday' || raw === 'other') return raw
  return null
}

/**
 * 이벤트 inferred_type 결정.
 *
 * 우선순위:
 *   1. N-Click 속성(extendedProperties.nclickType) — 최우선.
 *   2. 생일 캘린더 → birthday.
 *   3. 분류 모드(event_classification):
 *      - 'by_type'  (분리 운영, 기본): **캘린더 유형 그대로** — 사용자가 등록한 캘린더 유형 신뢰.
 *           v1.83.21 (사용자 결정): hasVacationText 자동 보정 제거. 안내 문구 "캘린더 유형 그대로 분류"와 일치.
 *           미팅 캘린더에 휴가 잘못 등록한 케이스는 사용자가 캘린더를 옮겨야 함.
 *           오프닝/킥오프 같은 텍스트가 휴가로 잘못 분류되던 false positive 해소.
 *      - 'by_title' (통합 운영): 제목에 휴가 텍스트 있을 때만 vacation, 없으면 meeting/other.
 */
export function inferEventType(
  calendarType: InferredType,
  title: string,
  classification: EventClassification = 'by_type',
  nclickType?: string | null,
): InferredType {
  // 1) N-Click 속성 최우선
  const nt = normalizeNclickType(nclickType)
  if (nt) return nt

  // 2) 생일 캘린더
  if (calendarType === 'birthday') return 'birthday'

  // 3) 분류 모드
  if (classification === 'by_title') {
    // 통합 운영 — 제목에 휴가 텍스트 있을 때만 휴가. 없으면 회의성으로.
    const hasVacationText = VACATION_KEYWORDS.test(title ?? '')
    if (hasVacationText) return 'vacation'
    return calendarType === 'other' ? 'other' : 'meeting'
  }

  // v1.83.21 — by_type (분리 운영): 캘린더 유형 그대로. 텍스트 체크 X (사용자 안내 문구 일치).
  if (calendarType === 'vacation') return 'vacation'
  if (calendarType === 'meeting') return 'meeting'
  return 'other'
}
