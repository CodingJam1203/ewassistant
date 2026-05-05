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
  type TeamsReplyTarget,
  type ReportType,
} from './teams-routing'
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
}

async function sendToMake(eventType: EventType, payload: MakePayload): Promise<void> {
  const webhookUrl = process.env.MAKE_WEBHOOK_URL
  if (!webhookUrl) {
    console.log('[Teams] MAKE_WEBHOOK_URL not set — skipping ' + eventType)
    return
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 3000)

  try {
    const res = await fetch(webhookUrl, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
      signal:  controller.signal,
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '(no response)')
      console.warn('[Teams] Make error ' + eventType + ' HTTP ' + res.status + ': ' + text)
    }
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') {
      console.warn('[Teams] Make timeout — ' + eventType)
    } else {
      console.warn('[Teams] Make request failed — ' + eventType + ':', err)
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
  messagePayload: unknown
): Promise<void> {
  if (!isEnabled(eventType)) return

  if (!department || !teamName) {
    console.log('[Teams] No division/team — skipping ' + eventType)
    return
  }

  const target = getTeamsReplyTarget({ department, teamName, reportType })
  if (!target) {
    console.log('[Teams] Route target not found — ' + eventType + ' / ' + department + ' / ' + teamName + ' / ' + reportType)
    return
  }

  try {
    const message = buildMessage(eventType, messagePayload)
    await sendToMake(eventType, { ...target, message })
  } catch (err) {
    console.warn('[Teams] Message build/send failed — ' + eventType + ':', err)
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
