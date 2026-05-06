// Teams 라우팅 테이블 및 라우팅 결정 함수
// Make Webhook payload: { teamId, channelId, messageId, message }
//
// 데이터 소스:
//   1) DB teams_routing (관리자가 /admin/teams-routing에서 관리)
//   2) 코드 fallback (DB 비어있거나 오류 시 — 첫 배포 직전 안전망)
//   in-memory 캐시 60초 TTL.

export type ReportType = '출근보고' | '퇴근보고'
export type NotificationAction = 'create' | 'update'
import { getKstTodayDateString } from '@/lib/utils/date'
import { createAdminClient } from '@/lib/supabase/admin'

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

/**
 * 코드 fallback 테이블 — DB 조회 실패 / 비어있을 때만 사용.
 * DB seed가 들어간 뒤에는 사실상 사용되지 않음. 안전망.
 */
const FALLBACK_TABLE: RoutingEntry[] = [
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

// ─── 라우팅 대상 조회 (DB 우선, 60초 캐시, 실패 시 코드 fallback) ───────────

interface CachedRoutes {
  routes: RoutingEntry[]
  loadedAt: number
  /** DB 조회 성공 여부 — false면 fallback */
  fromDb: boolean
}

const CACHE_TTL_MS = 60 * 1000  // 60초
let cache: CachedRoutes | null = null

/** DB → RoutingEntry[] 로드 (실패 시 null) */
async function loadRoutesFromDb(): Promise<RoutingEntry[] | null> {
  try {
    const admin = createAdminClient()
    const { data, error } = await admin
      .from('teams_routing')
      .select('department, team_name, report_type, team_id, channel_id, message_id, is_active')
      .eq('is_active', true)
    if (error) {
      console.warn('[teams-routing] DB load failed, using fallback:', error.message)
      return null
    }
    return (data ?? []).map(r => ({
      department: r.department,
      teamName:   r.team_name,
      reportType: r.report_type as ReportType,
      target: {
        teamId:    r.team_id,
        channelId: r.channel_id,
        messageId: r.message_id,
      },
    }))
  } catch (err) {
    console.warn('[teams-routing] DB load exception, using fallback:', err)
    return null
  }
}

/** 캐시 우선 조회. expired면 비동기 갱신 */
async function getRoutes(): Promise<RoutingEntry[]> {
  const now = Date.now()
  if (cache && now - cache.loadedAt < CACHE_TTL_MS) {
    return cache.routes
  }
  const fromDb = await loadRoutesFromDb()
  if (fromDb && fromDb.length > 0) {
    cache = { routes: fromDb, loadedAt: now, fromDb: true }
  } else {
    cache = { routes: FALLBACK_TABLE, loadedAt: now, fromDb: false }
  }
  return cache.routes
}

/** 캐시 강제 무효화 — 관리자 페이지에서 routing 변경 시 호출 */
export function invalidateRoutingCache(): void {
  cache = null
}

/**
 * 라우팅 대상 1건 조회.
 * DB 우선 → 실패 시 코드 fallback. 60초 캐시.
 */
export async function getTeamsReplyTarget(params: {
  department: string
  teamName: string
  reportType: ReportType
}): Promise<TeamsReplyTarget | null> {
  const normalizedTeam = normalizeTeamName(params.teamName)
  const routes = await getRoutes()
  const entry = routes.find(
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
