// Teams 라우팅 테이블 및 라우팅 결정 함수
// Make Webhook payload: { teamId, channelId, messageId, message }

export type ReportType = '출근보고' | '퇴근보고'
export type NotificationAction = 'create' | 'update'
import { getKstTodayDateString } from '@/lib/utils/date'

export interface TeamsReplyTarget {
  teamId: string
  channelId: string
  messageId: string
}

export interface NotificationContext {
  action: NotificationAction
  /** work_log의 leave_date (YYYY-MM-DD, KST 기준). update 분기에 사용. */
  leaveDate?: string
}

// ─── 라우팅 테이블 ────────────────────────────────────────────────────────────

interface RoutingEntry {
  department: string
  teamName: string
  reportType: ReportType
  target: TeamsReplyTarget
}

const ROUTING_TABLE: RoutingEntry[] = [
  // ── HR임팩트본부 / 출근보고
  { department: 'HR임팩트본부', teamName: '디자인크리에이티브3파트', reportType: '출근보고',
    target: { teamId: 'c2dcd308-5ef9-4c2f-a038-2db41410180e', channelId: '19:d70449b5ffec46338662a94f06d1e9be@thread.tacv2', messageId: '1767335177747' } },
  { department: 'HR임팩트본부', teamName: '컬처커뮤니케이션팀', reportType: '출근보고',
    target: { teamId: 'c2dcd308-5ef9-4c2f-a038-2db41410180e', channelId: '19:d70449b5ffec46338662a94f06d1e9be@thread.tacv2', messageId: '1767335241492' } },
  { department: 'HR임팩트본부', teamName: 'HR비즈니스팀', reportType: '출근보고',
    target: { teamId: 'c2dcd308-5ef9-4c2f-a038-2db41410180e', channelId: '19:d70449b5ffec46338662a94f06d1e9be@thread.tacv2', messageId: '1767335269415' } },
  { department: 'HR임팩트본부', teamName: '마이스팀', reportType: '출근보고',
    target: { teamId: 'c2dcd308-5ef9-4c2f-a038-2db41410180e', channelId: '19:d70449b5ffec46338662a94f06d1e9be@thread.tacv2', messageId: '1767335293381' } },

  // ── HR임팩트본부 / 퇴근보고
  { department: 'HR임팩트본부', teamName: '디자인크리에이티브3파트', reportType: '퇴근보고',
    target: { teamId: 'c2dcd308-5ef9-4c2f-a038-2db41410180e', channelId: '19:565876b6b37a4c93bf0ca3d744f07c2b@thread.tacv2', messageId: '1774263829550' } },
  { department: 'HR임팩트본부', teamName: '컬처커뮤니케이션팀', reportType: '퇴근보고',
    target: { teamId: 'c2dcd308-5ef9-4c2f-a038-2db41410180e', channelId: '19:565876b6b37a4c93bf0ca3d744f07c2b@thread.tacv2', messageId: '1774263959914' } },
  { department: 'HR임팩트본부', teamName: 'HR비즈니스팀', reportType: '퇴근보고',
    target: { teamId: 'c2dcd308-5ef9-4c2f-a038-2db41410180e', channelId: '19:565876b6b37a4c93bf0ca3d744f07c2b@thread.tacv2', messageId: '1774264072699' } },
  { department: 'HR임팩트본부', teamName: '마이스팀', reportType: '퇴근보고',
    target: { teamId: 'c2dcd308-5ef9-4c2f-a038-2db41410180e', channelId: '19:565876b6b37a4c93bf0ca3d744f07c2b@thread.tacv2', messageId: '1774264121746' } },

  // ── HR마케팅본부 / 출근보고
  { department: 'HR마케팅본부', teamName: '디자인크리에이티브2파트', reportType: '출근보고',
    target: { teamId: 'd6cf3fb4-4410-4563-9a16-18e15022fe64', channelId: '19:553ec7e116f44d73904d867cd1b90555@thread.tacv2', messageId: '1766558901940' } },
  { department: 'HR마케팅본부', teamName: 'HR마케팅1팀', reportType: '출근보고',
    target: { teamId: 'd6cf3fb4-4410-4563-9a16-18e15022fe64', channelId: '19:553ec7e116f44d73904d867cd1b90555@thread.tacv2', messageId: '1766558952328' } },
  { department: 'HR마케팅본부', teamName: 'HR마케팅2팀', reportType: '출근보고',
    target: { teamId: 'd6cf3fb4-4410-4563-9a16-18e15022fe64', channelId: '19:553ec7e116f44d73904d867cd1b90555@thread.tacv2', messageId: '1766559040022' } },
  { department: 'HR마케팅본부', teamName: 'HR마케팅3팀', reportType: '출근보고',
    target: { teamId: 'd6cf3fb4-4410-4563-9a16-18e15022fe64', channelId: '19:553ec7e116f44d73904d867cd1b90555@thread.tacv2', messageId: '1766559055148' } },

  // ── HR마케팅본부 / 퇴근보고
  { department: 'HR마케팅본부', teamName: '디자인크리에이티브2파트', reportType: '퇴근보고',
    target: { teamId: 'd6cf3fb4-4410-4563-9a16-18e15022fe64', channelId: '19:63dcfe997cc546be87707acb83a0da80@thread.tacv2', messageId: '1766559649568' } },
  { department: 'HR마케팅본부', teamName: 'HR마케팅1팀', reportType: '퇴근보고',
    target: { teamId: 'd6cf3fb4-4410-4563-9a16-18e15022fe64', channelId: '19:63dcfe997cc546be87707acb83a0da80@thread.tacv2', messageId: '1766559655046' } },
  { department: 'HR마케팅본부', teamName: 'HR마케팅2팀', reportType: '퇴근보고',
    target: { teamId: 'd6cf3fb4-4410-4563-9a16-18e15022fe64', channelId: '19:63dcfe997cc546be87707acb83a0da80@thread.tacv2', messageId: '1766559660840' } },
  { department: 'HR마케팅본부', teamName: 'HR마케팅3팀', reportType: '퇴근보고',
    target: { teamId: 'd6cf3fb4-4410-4563-9a16-18e15022fe64', channelId: '19:63dcfe997cc546be87707acb83a0da80@thread.tacv2', messageId: '1766559666784' } },
]

// ─── KST 오늘 날짜 ────────────────────────────────────────────────────────────

export function getTodayKST(): string {
  return getKstTodayDateString()
}

// ─── 팀명 정규화 ──────────────────────────────────────────────────────────────

export function normalizeTeamName(teamName: string): string {
  if (!teamName) return ''
  let normalized = teamName.trim()
  const ALIAS_MAP: Record<string, string> = {
    '디크3파트': '디자인크리에이티브3파트',
    '디크2파트': '디자인크리에이티브2파트',
    '컬컴팀': '컬처커뮤니케이션팀',
    '비즈팀': 'HR비즈니스팀',
    '마1팀': 'HR마케팅1팀',
    '마2팀': 'HR마케팅2팀',
    '마3팀': 'HR마케팅3팀',
  }
  return ALIAS_MAP[normalized] || normalized
}

// ─── 라우팅 대상 조회 ─────────────────────────────────────────────────────────

export function getTeamsReplyTarget(params: {
  department: string
  teamName: string
  reportType: ReportType
}): TeamsReplyTarget | null {
  const normalizedTeam = normalizeTeamName(params.teamName)
  const entry = ROUTING_TABLE.find(
    r => r.department === params.department &&
         r.teamName   === normalizedTeam &&
         r.reportType === params.reportType
  )
  return entry?.target ?? null
}

// ─── 라우팅용 reportType 결정 ────────────────────────────────────────────────

/**
 * 퇴근보고 수정(update) 알림이 어느 채널로 갈지 결정합니다.
 *
 * 정책:
 *   - leave_date == today (KST): 퇴근보고 채널
 *       (같은 날 작성·수정 → 그날의 퇴근 thread에 함께 묶이도록)
 *   - leave_date != today (이전 날짜를 오늘 정정): 출근보고 채널
 *       (오늘 출근 thread에 어제/그제 보고가 정정됐음을 노출)
 *
 * 호출처는 현재 notifyWorkLogUpdated 한 곳입니다.
 * action='create' 인 경우는 호출자가 직접 reportType을 지정하므로 이 함수를 거치지 않습니다.
 */
export function resolveTeamsRouteReportType(context: NotificationContext): ReportType {
  const todayKST = getTodayKST()
  const leaveDate = context.leaveDate ?? ''

  let resolvedReportType: ReportType
  if (leaveDate && leaveDate === todayKST) {
    resolvedReportType = '퇴근보고'
  } else if (leaveDate) {
    resolvedReportType = '출근보고'
  } else {
    // leaveDate를 받지 못한 예외 케이스 — 안전하게 퇴근보고로
    resolvedReportType = '퇴근보고'
  }

  console.log('[Teams routing date check]', {
    nowUTC: new Date().toISOString(),
    todayKST,
    leaveDate,
    action: context.action,
    resolvedReportType,
  })

  return resolvedReportType
}
