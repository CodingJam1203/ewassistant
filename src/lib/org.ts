/**
 * 조직(본부/팀) 공통 헬퍼.
 *
 * 핵심 개념 — "본부 직속" (division-direct):
 *   본부(division)에는 속하지만 팀(team)이 배정되지 않은 인원.
 *   데이터상 `division` 채워짐 + `team` 비어있음(NULL/'')으로 표현한다.
 *   별도 org_teams row를 만들지 않고 코드 레벨 가상 그룹으로 취급한다.
 *
 * 알림 라우팅:
 *   본부 직속 인원의 출/퇴근 보고는 라우팅할 팀 채널이 없으므로,
 *   admin이 인원별로 지정한 `notify_team`(user_profiles)으로 치환해 라우팅한다.
 *   → resolveRoutingTeam() 참고.
 *
 * 역할(role) 주의:
 *   `role='leader' + team 없음`은 admin-check.ts에서 본부장(division scope)으로 해석한다.
 *   본부 직속 *일반 멤버*는 `role='member' + team 없음`이라 role 필드로 자연 구분된다.
 */

/** 본부 직속 가상 그룹 라벨 (뷰·필터 공통). */
export const DIVISION_DIRECT_LABEL = '본부 직속'

/**
 * 팀 필터 드롭다운에서 "본부 직속(team 없음)"만 조회하기 위한 sentinel 값.
 * 일반 팀명과 충돌하지 않도록 prefix 사용. 백엔드에서 team IS NULL/'' 조건으로 변환.
 */
export const DIVISION_DIRECT_FILTER = '__division_direct__'

function isBlank(v: string | null | undefined): boolean {
  return !v || v.trim() === ''
}

/** 본부 직속 여부 — division 있음 + team 없음. */
export function isDivisionDirect(p: { division?: string | null; team?: string | null }): boolean {
  return !isBlank(p.division) && isBlank(p.team)
}

/**
 * 알림 라우팅용 effective team 결정.
 * team이 있으면 그대로, 없으면 notify_team으로 fallback. 둘 다 없으면 '' (라우팅 skip → SKIPPED 로깅).
 */
export function resolveRoutingTeam(
  team?: string | null,
  notifyTeam?: string | null,
): string {
  const t = (team ?? '').trim()
  if (t) return t
  return (notifyTeam ?? '').trim()
}
