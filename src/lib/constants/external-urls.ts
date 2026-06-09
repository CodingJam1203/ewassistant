/**
 * v1.77 — 외부 시스템 URL 상수.
 *
 * 본부별 read_only_calendar=true인 경우 휴가 등록/수정을 N-Click 대신 외부 시스템으로 라우팅.
 */

/**
 * NPM(전자결재) 휴가 상신 페이지 URL.
 * 본부 무관 단일 URL. 정책 ON 본부 사용자가 "휴가 등록" / "이 휴가 취소" 등 클릭 시
 * confirm 후 새 탭으로 이동.
 *
 * 변경 절차: 이 값 수정 → commit → 배포. URL 거의 안 바뀜.
 */
export const NPM_VACATION_URL = 'https://intra.univ.me/Approval/AprCreateDoc'
