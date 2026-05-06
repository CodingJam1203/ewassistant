/**
 * Teams notification gateway
 * N-Click server -> Make Custom Webhook -> Microsoft Teams (Reply to Channel Message)
 *
 * - MAKE_WEBHOOK_URL is server-only (never exposed to client)
 * - Notification failures never block main functionality
 * - 3-second timeout on webhook calls
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
  MorningSummaryData,
} from './types'

const EVENT_ENV_MAP: Record<EventType, string> = {
  worklog_submitted:          'ENABLE_WORKLOG_SUBMIT_NOTIFY',
  checkout_resubmitted:       'ENABLE_WORKLOG_SUBMIT_NOTIFY',
  worklog_updated:            'ENABLE_WORKLOG_UPDATE_NOTIFY',
  worklog_deleted:            'ENABLE_WORKLOG_DELETE_NOTIFY',
  checkin_submitted:          'ENABLE_CHECKIN_NOTIFY',
  location_changed:           'ENABLE_LOCATION_CHANGE_NOTIFY',
  break_started:              'ENABLE_BREAK_NOTIFY',
  break_ended:                'ENABLE_BREAK_NOTIFY',
  account_pending:            'ENABLE_ACCOUNT_NOTIFY',
  daily_checkin_reminder_20:  'ENABLE_DAILY_REMINDER_NOTIFY',
  daily_checkin_reminder_22:  'ENABLE_DAILY_REMINDER_NOTIFY',
  daily_morning_summary:      'ENABLE_DAILY_REMINDER_NOTIFY',
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
  if (process.env.ENABLE_TEAMS_NOTIFY === 'false') return false
  const key = EVENT_ENV_MAP[eventType]
  return process.env[key] !== 'false'
}

// ─── Make Webhook 전송 ────────────────────────────────────────────────────────

interface MakePayload {
  teamId: string
  channelId: string
  messageId: string
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
  teamName: string
): Promise<void> {
  const webhookUrl = process.env.MAKE_WEBHOOK_URL
  if (!webhookUrl) {
    console.log('[Teams] MAKE_WEBHOOK_URL not set — skipping ' + eventType)
    return
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 3000)

  // console.log('[Teams] Webhook Payload:', JSON.stringify(payload, null, 2))

  try {
    const res = await fetch(webhookUrl, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
      signal:  controller.signal,
    })
    
    console.log('[Teams notify result]', {
      eventType,
      status: res.status,
      ok: res.ok
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '(no response)')
      const errorMsg = 'HTTP ' + res.status + ': ' + text
      console.warn('[Teams] Make error ' + eventType + ' ' + errorMsg)
      await logNotification(eventType, 'FAILURE', department, teamName, payload.channelId, payload, errorMsg)
    } else {
      await logNotification(eventType, 'SUCCESS', department, teamName, payload.channelId, payload, null)
    }
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err)
    if (err instanceof Error && err.name === 'AbortError') {
      console.warn('[Teams] Make timeout — ' + eventType)
      await logNotification(eventType, 'FAILURE', department, teamName, payload.channelId, payload, 'Timeout')
    } else {
      console.warn('[Teams] Make request failed — ' + eventType + ':', err)
      await logNotification(eventType, 'FAILURE', department, teamName, payload.channelId, payload, errMsg)
    }
  } finally {
    clearTimeout(timer)
  }
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
    hasWebhookUrl: !!process.env.MAKE_WEBHOOK_URL,
    enabled: process.env.ENABLE_TEAMS_NOTIFY
  })

  try {
    const messageRaw = buildMessage(eventType, messagePayload)   // markdown 원문
    const messageHtml = toTeamsHtml(messageRaw)                  // HTML(<a>, <br>)
    const messageText = toPlainText(messageRaw)                  // plain text fallback
    await sendToMake(
      eventType,
      {
        ...target,
        message: messageHtml,   // primary: HTML 본문 (Content Type: HTML 권장)
        messageHtml,            // back-compat alias
        messageText,            // plain text fallback
        eventType,
      },
      department,
      normalizedTeam
    )
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    console.warn('[Teams] Message build/send failed — ' + eventType + ':', err)
    await logNotification(eventType, 'FAILURE', department, normalizedTeam, target.channelId, messagePayload, 'Build failed: ' + errMsg)
  }
}

// ─── 공개 wrapper 함수들 ──────────────────────────────────────────────────────

export function notifyWorkLogSubmitted(payload: WorklogNotifyPayload): void {
  routeAndSend(
    'worklog_submitted',
    payload.division,
    payload.team,
    '퇴근보고',
    payload
  ).catch(err => console.warn('[Teams] worklog_submitted failed:', err))
}

export function notifyCheckoutResubmitted(payload: WorklogNotifyPayload): void {
  routeAndSend(
    'checkout_resubmitted',
    payload.division,
    payload.team,
    '퇴근보고',
    payload
  ).catch(err => console.warn('[Teams] checkout_resubmitted failed:', err))
}

/**
 * @deprecated 신규 코드는 notifyWorkLogUpdatedSplit 사용.
 * 호환용으로 유지. leave_date 기반 분기.
 */
export function notifyWorkLogUpdated(payload: WorklogUpdateNotifyPayload): void {
  const reportType = resolveTeamsRouteReportType({
    action: 'update',
    leaveDate: payload.leaveDate,
  })
  routeAndSend(
    'worklog_updated',
    payload.division,
    payload.team,
    reportType,
    payload
  ).catch(err => console.warn('[Teams] worklog_updated failed:', err))
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
export function notifyWorkLogUpdatedSplit(payload: WorklogUpdateNotifyPayload): void {
  const checkInFields  = payload.changedFields.filter(f => f.kind === 'check_in')
  const checkOutFields = payload.changedFields.filter(f => f.kind === 'check_out')

  // 출근보고 영역 변경 → 출근보고 채널
  if (checkInFields.length > 0) {
    routeAndSend(
      'worklog_updated_checkin',
      payload.division,
      payload.team,
      '출근보고',
      { ...payload, changedFields: checkInFields }
    ).catch(err => console.warn('[Teams] worklog_updated_checkin failed:', err))
  }

  // 퇴근보고 영역 변경 → 퇴근보고 채널
  if (checkOutFields.length > 0) {
    routeAndSend(
      'worklog_updated_checkout',
      payload.division,
      payload.team,
      '퇴근보고',
      { ...payload, changedFields: checkOutFields }
    ).catch(err => console.warn('[Teams] worklog_updated_checkout failed:', err))
  }

  if (checkInFields.length === 0 && checkOutFields.length === 0) {
    console.log('[Teams] worklog updated but no classifiable changes — skipping notification')
  }
}

export function notifyWorkLogDeleted(payload: WorklogDeletedNotifyPayload): void {
  routeAndSend(
    'worklog_deleted',
    payload.division,
    payload.team,
    '퇴근보고',
    payload
  ).catch(err => console.warn('[Teams] worklog_deleted failed:', err))
}

export function notifyCheckinSubmitted(payload: CheckinNotifyPayload): void {
  routeAndSend(
    'checkin_submitted',
    payload.division,
    payload.team,
    '출근보고',
    payload
  ).catch(err => console.warn('[Teams] checkin_submitted failed:', err))
}

export function notifyLocationChanged(payload: LocationChangedNotifyPayload): void {
  routeAndSend(
    'location_changed',
    payload.division,
    payload.team,
    '출근보고',
    payload
  ).catch(err => console.warn('[Teams] location_changed failed:', err))
}

export function notifyBreakStarted(payload: BreakNotifyPayload): void {
  routeAndSend(
    'break_started',
    payload.division,
    payload.team,
    '출근보고',
    payload
  ).catch(err => console.warn('[Teams] break_started failed:', err))
}

export function notifyBreakEnded(payload: BreakNotifyPayload): void {
  routeAndSend(
    'break_ended',
    payload.division,
    payload.team,
    '출근보고',
    payload
  ).catch(err => console.warn('[Teams] break_ended failed:', err))
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
