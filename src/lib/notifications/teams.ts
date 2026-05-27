/**
 * Teams notification gateway
 * N-Click server -> Make Custom Webhook -> Microsoft Teams (Reply to Channel Message)
 *
 * - MAKE_WEBHOOK_URL is server-only (never exposed to client)
 * - Notification failures never block main functionality
 * - 10-second timeout on webhook calls
 * - Per-event-type ON/OFF via environment variables
 * - Routing: (department + teamName + reportType) -> TeamsReplyTarget
 */

import { buildMessage } from './messages'
import {
  getTeamsReplyTarget,
  resolveTeamsRouteReportType,
  normalizeTeamName,
  type TeamsReplyTarget,
  type ReportType,
} from './teams-routing'
import { createAdminClient } from '@/lib/supabase/admin'
import { envOverride } from '@/lib/utils/env-override'
import type {
  EventType,
  WorklogNotifyPayload,
  WorklogUpdateNotifyPayload,
  WorklogDeletedNotifyPayload,
  CheckinNotifyPayload,
  LocationChangedNotifyPayload,
  BreakNotifyPayload,
  AccountPendingNotifyPayload,
  DailyCheckinReminderData,
  MissingReportNudgePayload,
  MorningSummaryData,
} from './types'

const EVENT_ENV_MAP: Record<EventType, string> = {
  worklog_submitted:          'ENABLE_WORKLOG_SUBMIT_NOTIFY',
  checkout_resubmitted:       'ENABLE_WORKLOG_SUBMIT_NOTIFY',
  worklog_updated:            'ENABLE_WORKLOG_UPDATE_NOTIFY',
  worklog_updated_checkin:    'ENABLE_WORKLOG_UPDATE_NOTIFY',
  worklog_updated_checkout:   'ENABLE_WORKLOG_UPDATE_NOTIFY',
  worklog_deleted:            'ENABLE_WORKLOG_DELETE_NOTIFY',
  checkin_submitted:          'ENABLE_CHECKIN_NOTIFY',
  location_changed:           'ENABLE_LOCATION_CHANGE_NOTIFY',
  break_started:              'ENABLE_BREAK_NOTIFY',
  break_ended:                'ENABLE_BREAK_NOTIFY',
  account_pending:            'ENABLE_ACCOUNT_NOTIFY',
  daily_checkin_reminder_20:  'ENABLE_DAILY_REMINDER_NOTIFY',
  daily_checkin_reminder_22:  'ENABLE_DAILY_REMINDER_NOTIFY',
  daily_morning_summary:      'ENABLE_DAILY_REMINDER_NOTIFY',
  missing_report_nudge:       'ENABLE_MISSING_REPORT_NUDGE_NOTIFY',
}

function toTeamsHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    // markdown 링크 [text](url) → <a href="url">text</a>
    // 이전 escape 단계에서 본문의 < > 가 이미 &lt; &gt; 로 치환됐으므로
    // 여기서 새로 삽입하는 <a>, </a> 태그는 안전합니다.
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\n/g, "<br>")
}

/**
 * markdown 원문을 plain text로 변환합니다.
 * - [text](url) → "text\nurl" 두 줄로 분리 → Teams의 URL 자동 linkify가 동작
 * - HTML이 지원되지 않는 채널/Content Type 설정에서의 fallback 용도
 */
function toPlainText(text: string): string {
  return text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1\n$2')
}

function isEnabled(eventType: EventType): boolean {
  // Preview 환경에서 `_2` override가 있으면 우선 적용 (Vercel 같은 이름 변수 제약 회피).
  if (envOverride('ENABLE_TEAMS_NOTIFY') === 'false') return false
  const key = EVENT_ENV_MAP[eventType]
  return envOverride(key) !== 'false'
}

// ─── Make Webhook 전송 ────────────────────────────────────────────────────────

interface MakePayload {
  teamId: string
  channelId: string
  /** v1.50: 채널 새 메시지(Power Automate) 방식 라우팅은 NULL 허용. */
  messageId: string | null
  /**
   * Teams 본문(HTML 형식).
   * - Make의 Microsoft Teams 모듈에서 Content Type을 HTML로 설정하여 매핑하세요.
   * - <a href="…">…</a> 형태의 hyperlink, <br> 줄바꿈이 포함됩니다.
   */
  message: string
  /** `message`와 동일한 HTML 본문 (이전 시나리오 호환용 alias) */
  messageHtml: string
  /**
   * Plain text 본문 (HTML 미지원 환경 fallback).
   * - markdown 링크는 "텍스트\nURL" 두 줄로 풀려 있어 Teams autolinkify로 클릭 가능.
   */
  messageText: string
  eventType: EventType
}

async function logNotification(
  eventType: string,
  status: 'SUCCESS' | 'FAILURE' | 'SKIPPED',
  department: string | null,
  teamName: string | null,
  targetId: string | null,
  payload: any,
  errorMessage: string | null
) {
  try {
    const adminClient = createAdminClient()
    const { error } = await adminClient.from('notification_logs').insert({
      event_type: eventType,
      status,
      department,
      team_name: teamName,
      target_id: targetId,
      payload,
      error_message: errorMessage,
    })
    if (error) {
      console.error('[Teams] Supabase Insert Error for notification_logs:', error)
    }
  } catch (err) {
    console.error('[Teams] Failed to log notification to DB:', err)
  }
}

async function sendToMake(
  eventType: EventType,
  payload: MakePayload,
  department: string,
  teamName: string,
  /** v1.50: 라우팅별 webhook URL override. NULL이면 env MAKE_WEBHOOK_URL 사용. */
  overrideWebhookUrl?: string | null,
): Promise<void> {
  const webhookUrl = overrideWebhookUrl || envOverride('MAKE_WEBHOOK_URL')
  if (!webhookUrl) {
    console.log('[Teams] webhook URL not configured (routing + default) — skipping ' + eventType)
    return
  }

  // 2026-05-19 v1.22: timeout 시 retry 비활성화 — 최수빈 5/19 18:29/18:40 중복 알림 fix.
  // 종전 정책(timeout도 retry)은 Make webhook이 메시지 받고 처리 중인데 응답이 늦으면
  // 우리는 fail로 인지하고 retry → Make는 또 받음 → Teams 중복 발송.
  // 변경:
  //   - timeout: at-least-once → at-most-once. 우리는 1회만 호출, log는 FAILURE로 남지만
  //     Make는 받았을 가능성 높음 (실제 알림은 정상 도착). 중복 발송 0건 보장.
  //   - 5xx만 retry 대상 (네트워크 일시 장애 회복용)
  //   - 4xx 영구 실패 즉시 중단 (기존과 동일)
  //   - 각 시도 fetch timeout 15s로 확장 (10s→15s, Make 시나리오 응답 시간 여유 확보)
  // 최악 wall-time: 15×3 + 0.5 + 1 = 46.5s → 호출처 maxDuration 60s.
  const MAX_ATTEMPTS = 3
  const RETRY_DELAYS_MS = [500, 1000]
  const FETCH_TIMEOUT_MS = 15000
  let lastError: string | null = null

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

    try {
      const res = await fetch(webhookUrl, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
        signal:  controller.signal,
      })

      console.log('[Teams notify result]', {
        eventType,
        attempt,
        status: res.status,
        ok: res.ok,
      })

      if (res.ok) {
        const note = attempt > 1 ? `재시도 ${attempt}회차 성공` : null
        await logNotification(eventType, 'SUCCESS', department, teamName, payload.channelId, payload, note)
        return
      }

      const text = await res.text().catch(() => '(no response)')
      lastError = `HTTP ${res.status}: ${text}`

      // 4xx — 영구 실패. 재시도해도 결과 동일 → 즉시 종료.
      if (res.status >= 400 && res.status < 500) {
        console.warn(`[Teams] Make 4xx ${eventType}: ${lastError} (재시도 없음)`)
        await logNotification(
          eventType, 'FAILURE', department, teamName, payload.channelId, payload,
          `${lastError} (4xx — 재시도 없음)`,
        )
        return
      }

      // 5xx — 재시도 대상
      console.warn(`[Teams] Make 5xx ${eventType} attempt ${attempt}/${MAX_ATTEMPTS}: ${lastError}`)
    } catch (err: unknown) {
      const isAbort = err instanceof Error && err.name === 'AbortError'
      lastError = isAbort ? 'Timeout' : (err instanceof Error ? err.message : String(err))
      console.warn(`[Teams] Make ${isAbort ? 'timeout' : 'error'} ${eventType} attempt ${attempt}/${MAX_ATTEMPTS}: ${lastError}`)

      // 2026-05-19 v1.22: timeout 시 retry 중단 — Make는 메시지를 이미 받았을 가능성이
      // 높아 retry하면 중복 발송 위험. 로그는 FAILURE로 남지만 실제 알림은 정상 도착.
      if (isAbort) {
        await logNotification(
          eventType, 'FAILURE', department, teamName, payload.channelId, payload,
          `${lastError} (timeout — retry 없음, 중복 발송 방지)`,
        )
        return
      }
      // 네트워크 에러는 retry (Make에 도달 안 했을 가능성)
    } finally {
      clearTimeout(timer)
    }

    // 마지막 시도면 backoff 없이 종료
    if (attempt < MAX_ATTEMPTS) {
      await new Promise(r => setTimeout(r, RETRY_DELAYS_MS[attempt - 1]))
    }
  }

  // 모든 시도 실패
  const finalMsg = `${lastError ?? 'unknown'} (${MAX_ATTEMPTS}회 시도 모두 실패)`
  console.warn(`[Teams] Make all attempts failed — ${eventType}: ${finalMsg}`)
  await logNotification(eventType, 'FAILURE', department, teamName, payload.channelId, payload, finalMsg)
}

// ─── 라우팅 후 전송 ───────────────────────────────────────────────────────────

async function routeAndSend(
  eventType: EventType,
  department: string | null | undefined,
  teamName: string | null | undefined,
  reportType: ReportType,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  messagePayload: any
): Promise<void> {
  if (!isEnabled(eventType)) return

  const scheduledWorkDate = messagePayload?.scheduledWorkDate || messagePayload?.expectedStartDate || undefined

  if (!department || !teamName) {
    console.warn('[Teams notify skipped]', {
      reason: 'Missing organization',
      eventType,
      userName: messagePayload?.name,
      department,
      teamName,
      reportType,
      scheduledWorkDate
    })
    await logNotification(eventType, 'SKIPPED', department || null, teamName || null, null, messagePayload, 'Missing organization')
    return
  }

  const normalizedTeam = normalizeTeamName(teamName)
  const target = await getTeamsReplyTarget({ department, teamName: normalizedTeam, reportType })
  if (!target) {
    console.warn('[Teams notify skipped]', {
      reason: 'Route target not found',
      eventType,
      userName: messagePayload?.name,
      department,
      teamName: normalizedTeam,
      reportType,
      scheduledWorkDate
    })
    await logNotification(eventType, 'SKIPPED', department, normalizedTeam, null, messagePayload, 'Route target not found')
    return
  }

  console.log('[Teams notify attempt]', {
    eventType,
    userName: messagePayload?.name,
    department,
    teamName: normalizedTeam,
    reportType,
    scheduledWorkDate,
    todayKST: new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10), // For quick logging reference
    teamId: target.teamId,
    channelId: target.channelId,
    messageId: target.messageId,
    hasWebhookUrl: !!envOverride('MAKE_WEBHOOK_URL'),
    enabled: envOverride('ENABLE_TEAMS_NOTIFY')
  })

  try {
    const messageRaw = buildMessage(eventType, messagePayload)   // markdown 원문
    const messageHtml = toTeamsHtml(messageRaw)                  // HTML(<a>, <br>)
    const messageText = toPlainText(messageRaw)                  // plain text fallback
    // v1.50: 라우팅별 webhook URL 분기. payload에는 webhookUrl 필드 안 보냄 (Power
    // Automate 워크플로우는 받지 않는 필드).
    const { webhookUrl: routeWebhookUrl, ...targetForPayload } = target
    await sendToMake(
      eventType,
      {
        ...targetForPayload,
        message: messageHtml,   // primary: HTML 본문 (Content Type: HTML 권장)
        messageHtml,            // back-compat alias
        messageText,            // plain text fallback
        eventType,
      },
      department,
      normalizedTeam,
      routeWebhookUrl ?? null,
    )
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    console.warn('[Teams] Message build/send failed — ' + eventType + ':', err)
    await logNotification(eventType, 'FAILURE', department, normalizedTeam, target.channelId, messagePayload, 'Build failed: ' + errMsg)
  }
}

// ─── 공개 wrapper 함수들 ──────────────────────────────────────────────────────

// 2026-05-19 v1.21: 모든 notify 함수를 Promise<void> 반환으로 통일. 호출처에서 await
// 처리해 Vercel function이 sendToMake retry 완주를 보장. v1.10에서 notifyLocationChanged만
// 처리했었고 나머지 fire-and-forget 함수들은 그대로 두어 최승현 5/19 18:23 알림 누락 발생.
export async function notifyWorkLogSubmitted(payload: WorklogNotifyPayload): Promise<void> {
  try {
    await routeAndSend(
      'worklog_submitted',
      payload.division,
      payload.team,
      '퇴근보고',
      payload
    )
  } catch (err) {
    console.warn('[Teams] worklog_submitted failed:', err)
  }
}

export async function notifyCheckoutResubmitted(payload: WorklogNotifyPayload): Promise<void> {
  try {
    await routeAndSend(
      'checkout_resubmitted',
      payload.division,
      payload.team,
      '퇴근보고',
      payload
    )
  } catch (err) {
    console.warn('[Teams] checkout_resubmitted failed:', err)
  }
}

/**
 * @deprecated 신규 코드는 notifyWorkLogUpdatedSplit 사용.
 * 호환용으로 유지. leave_date 기반 분기.
 */
export async function notifyWorkLogUpdated(payload: WorklogUpdateNotifyPayload): Promise<void> {
  const reportType = resolveTeamsRouteReportType({
    action: 'update',
    leaveDate: payload.leaveDate,
  })
  try {
    await routeAndSend(
      'worklog_updated',
      payload.division,
      payload.team,
      reportType,
      payload
    )
  } catch (err) {
    console.warn('[Teams] worklog_updated failed:', err)
  }
}

/**
 * 수정 알림을 출근/퇴근 보고 유형별로 **분리해서 발송**.
 *
 * - changedFields의 kind로 그룹화 (check_in / check_out)
 * - check_in 그룹 있으면 → 출근보고 채널에 'worklog_updated_checkin'
 * - check_out 그룹 있으면 → 퇴근보고 채널에 'worklog_updated_checkout'
 * - 동시 변경 시 두 알림 각각 별도 발송
 *
 * leave_date 기반 분기는 더 이상 사용하지 않음.
 */
export async function notifyWorkLogUpdatedSplit(payload: WorklogUpdateNotifyPayload): Promise<void> {
  const checkInFields  = payload.changedFields.filter(f => f.kind === 'check_in')
  const checkOutFields = payload.changedFields.filter(f => f.kind === 'check_out')

  const tasks: Promise<unknown>[] = []

  // 출근보고 영역 변경 → 출근보고 채널
  if (checkInFields.length > 0) {
    tasks.push(
      routeAndSend(
        'worklog_updated_checkin',
        payload.division,
        payload.team,
        '출근보고',
        { ...payload, changedFields: checkInFields }
      ).catch(err => console.warn('[Teams] worklog_updated_checkin failed:', err))
    )
  }

  // 퇴근보고 영역 변경 → 퇴근보고 채널
  if (checkOutFields.length > 0) {
    tasks.push(
      routeAndSend(
        'worklog_updated_checkout',
        payload.division,
        payload.team,
        '퇴근보고',
        { ...payload, changedFields: checkOutFields }
      ).catch(err => console.warn('[Teams] worklog_updated_checkout failed:', err))
    )
  }

  if (tasks.length === 0) {
    console.log('[Teams] worklog updated but no classifiable changes — skipping notification')
    return
  }

  // 동시 변경 시 두 알림 병렬 발송. allSettled로 한 쪽 실패가 다른 쪽 막지 않게.
  await Promise.allSettled(tasks)
}

export async function notifyWorkLogDeleted(payload: WorklogDeletedNotifyPayload): Promise<void> {
  // partial delete는 scope에 맞춰 라우팅:
  //   check_in 삭제  → 출근보고 채널 (그 row의 출근보고 thread)
  //   check_out 삭제 → 퇴근보고 채널 (기존 동작 동일)
  //   scope 없음     → 기존 동작 (퇴근보고 채널) — backward compat
  const reportType: '출근보고' | '퇴근보고' =
    payload.scope === 'check_in' ? '출근보고' : '퇴근보고'
  try {
    await routeAndSend(
      'worklog_deleted',
      payload.division,
      payload.team,
      reportType,
      payload
    )
  } catch (err) {
    console.warn('[Teams] worklog_deleted failed:', err)
  }
}

export async function notifyCheckinSubmitted(payload: CheckinNotifyPayload): Promise<void> {
  try {
    await routeAndSend(
      'checkin_submitted',
      payload.division,
      payload.team,
      '출근보고',
      payload
    )
  } catch (err) {
    console.warn('[Teams] checkin_submitted failed:', err)
  }
}

export async function notifyLocationChanged(payload: LocationChangedNotifyPayload): Promise<void> {
  // 2026-05-19 v1.10: void → Promise<void>로 변경. 호출처(/api/team-status/location/notify)가
  // await로 처리해서 Vercel function이 sendToMake retry 완주 보장 (fire-and-forget grace
  // period 의존으로 인한 알림 지연 buge 회피).
  try {
    await routeAndSend(
      'location_changed',
      payload.division,
      payload.team,
      '출근보고',
      payload,
    )
  } catch (err) {
    console.warn('[Teams] location_changed failed:', err)
  }
}

export async function notifyBreakStarted(payload: BreakNotifyPayload): Promise<void> {
  try {
    await routeAndSend(
      'break_started',
      payload.division,
      payload.team,
      '출근보고',
      payload
    )
  } catch (err) {
    console.warn('[Teams] break_started failed:', err)
  }
}

export async function notifyBreakEnded(payload: BreakNotifyPayload): Promise<void> {
  try {
    await routeAndSend(
      'break_ended',
      payload.division,
      payload.team,
      '출근보고',
      payload
    )
  } catch (err) {
    console.warn('[Teams] break_ended failed:', err)
  }
}

export function notifyAccountPending(payload: AccountPendingNotifyPayload): void {
  if (!isEnabled('account_pending')) return
  // 라우팅 대상 미설정 — 이메일 대신 이름으로만 로깅 (서버 로그에도 PII 최소화)
  console.log('[Teams] account_pending — no routing target, skipping for:', payload.name)
}

// ─── cron 알림: 팀별 라우팅 테이블 사용 ─────────────────────────────────────
// 각 팀의 출근보고 스레드로 발송 (팀별 별도 메시지)

export async function notifyDailyCheckinReminder(
  type: 'daily_checkin_reminder_20' | 'daily_checkin_reminder_22',
  payload: DailyCheckinReminderData
): Promise<void> {
  return routeAndSend(type, payload.division, payload.team, '출근보고', payload)
}

export async function notifyMorningSummary(payload: MorningSummaryData): Promise<void> {
  return routeAndSend('daily_morning_summary', payload.division, payload.team, '출근보고', payload)
}

/**
 * 미보고 알림 — 미보고 현황 탭에서 리더/관리자가 수동 발송.
 *
 * 라우팅:
 *   - missing_all (전체 미보고) → 출근보고 채널
 *   - missing_checkout (퇴근만 누락) → 퇴근보고 채널
 *
 * 실패 시 호출자에게 상태 전달해야 하므로 동기 await + 결과 반환.
 */
export async function notifyMissingReport(
  payload: MissingReportNudgePayload,
): Promise<{ ok: boolean; reason?: string }> {
  const reportType: ReportType =
    payload.missingType === 'missing_all' ? '출근보고' : '퇴근보고'

  if (!isEnabled('missing_report_nudge')) {
    return { ok: false, reason: '알림 기능 비활성 (env)' }
  }
  if (!payload.division || !payload.team) {
    return { ok: false, reason: '대상자 본부/팀 정보 없음' }
  }

  const normalizedTeam = normalizeTeamName(payload.team)
  const target = await getTeamsReplyTarget({
    department: payload.division,
    teamName: normalizedTeam,
    reportType,
  })
  if (!target) {
    return { ok: false, reason: `라우팅 대상 없음 (${payload.division} / ${normalizedTeam} / ${reportType})` }
  }

  try {
    const messageRaw = buildMessage('missing_report_nudge', payload)
    const messageHtml = toTeamsHtml(messageRaw)
    const messageText = toPlainText(messageRaw)
    await sendToMake(
      'missing_report_nudge',
      {
        ...target,
        message: messageHtml,
        messageHtml,
        messageText,
        eventType: 'missing_report_nudge',
      },
      payload.division,
      normalizedTeam,
    )
    return { ok: true }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn('[Teams] missing_report_nudge failed:', msg)
    await logNotification(
      'missing_report_nudge', 'FAILURE',
      payload.division, normalizedTeam, target.channelId,
      payload, 'send failed: ' + msg,
    )
    return { ok: false, reason: '발송 실패: ' + msg }
  }
}
