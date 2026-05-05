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
    .replace(/\n/g, "<br>")
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
  message: string
  messageHtml?: string
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
    await adminClient.from('notification_logs').insert({
      event_type: eventType,
      status,
      department,
      team_name: teamName,
      target_id: targetId,
      payload,
      error_message: errorMessage,
    })
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
      userId: messagePayload?.updatedByEmail || messagePayload?.name,
      department,
      teamName,
      reportType,
      scheduledWorkDate
    })
    await logNotification(eventType, 'SKIPPED', department || null, teamName || null, null, messagePayload, 'Missing organization')
    return
  }

  const normalizedTeam = normalizeTeamName(teamName)
  const target = getTeamsReplyTarget({ department, teamName: normalizedTeam, reportType })
  if (!target) {
    console.warn('[Teams notify skipped]', {
      reason: 'Route target not found',
      eventType,
      userId: messagePayload?.updatedByEmail || messagePayload?.name,
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
    userId: messagePayload?.updatedByEmail || messagePayload?.name,
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
    const message = buildMessage(eventType, messagePayload)
    const messageHtml = toTeamsHtml(message)
    await sendToMake(eventType, { ...target, message, messageHtml, eventType }, department, normalizedTeam)
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

export function notifyWorkLogUpdated(payload: WorklogUpdateNotifyPayload): void {
  const reportType = resolveTeamsRouteReportType({
    action: 'update',
    originalReportType: payload.originalReportType,
    scheduledWorkDate: payload.scheduledWorkDate ?? undefined,
  })
  routeAndSend(
    'worklog_updated',
    payload.division,
    payload.team,
    reportType,
    payload
  ).catch(err => console.warn('[Teams] worklog_updated failed:', err))
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
    '퇴근보고',
    payload
  ).catch(err => console.warn('[Teams] location_changed failed:', err))
}

export function notifyBreakStarted(payload: BreakNotifyPayload): void {
  routeAndSend(
    'break_started',
    payload.division,
    payload.team,
    '퇴근보고',
    payload
  ).catch(err => console.warn('[Teams] break_started failed:', err))
}

export function notifyBreakEnded(payload: BreakNotifyPayload): void {
  routeAndSend(
    'break_ended',
    payload.division,
    payload.team,
    '퇴근보고',
    payload
  ).catch(err => console.warn('[Teams] break_ended failed:', err))
}

export function notifyAccountPending(payload: AccountPendingNotifyPayload): void {
  if (!isEnabled('account_pending')) return
  console.log('[Teams] account_pending — no routing target, skipping for:', payload.email)
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
