/**
 * Teams notification gateway
 * N-Click server -> Make Custom Webhook -> Microsoft Teams
 *
 * - MAKE_WEBHOOK_URL is server-only (never exposed to client)
 * - Notification failures never block main functionality
 * - 3-second timeout on webhook calls
 * - Per-event-type ON/OFF via environment variables
 */

import { buildMessage } from './messages'
import type {
  EventType,
  WorklogNotifyPayload,
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

async function sendToMake(eventType: EventType, message: string): Promise<void> {
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
      body:    JSON.stringify({ eventType, message }),
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

export async function notifyTeams(eventType: EventType, payload: unknown): Promise<void> {
  if (!isEnabled(eventType)) return
  try {
    const message = buildMessage(eventType, payload)
    await sendToMake(eventType, message)
  } catch (err) {
    console.warn('[Teams] Message build/send failed — ' + eventType + ':', err)
  }
}

export function notifyWorkLogSubmitted(payload: WorklogNotifyPayload): void {
  notifyTeams('worklog_submitted', payload).catch(err =>
    console.warn('[Teams] worklog_submitted failed:', err)
  )
}

export function notifyWorkLogUpdated(payload: WorklogNotifyPayload): void {
  notifyTeams('worklog_updated', payload).catch(err =>
    console.warn('[Teams] worklog_updated failed:', err)
  )
}

export function notifyWorkLogDeleted(payload: WorklogDeletedNotifyPayload): void {
  notifyTeams('worklog_deleted', payload).catch(err =>
    console.warn('[Teams] worklog_deleted failed:', err)
  )
}

export function notifyCheckinSubmitted(payload: CheckinNotifyPayload): void {
  notifyTeams('checkin_submitted', payload).catch(err =>
    console.warn('[Teams] checkin_submitted failed:', err)
  )
}

export function notifyLocationChanged(payload: LocationChangedNotifyPayload): void {
  notifyTeams('location_changed', payload).catch(err =>
    console.warn('[Teams] location_changed failed:', err)
  )
}

export function notifyBreakStarted(payload: BreakNotifyPayload): void {
  notifyTeams('break_started', payload).catch(err =>
    console.warn('[Teams] break_started failed:', err)
  )
}

export function notifyBreakEnded(payload: BreakNotifyPayload): void {
  notifyTeams('break_ended', payload).catch(err =>
    console.warn('[Teams] break_ended failed:', err)
  )
}

export function notifyAccountPending(payload: AccountPendingNotifyPayload): void {
  notifyTeams('account_pending', payload).catch(err =>
    console.warn('[Teams] account_pending failed:', err)
  )
}

export async function notifyDailyCheckinReminder(
  type: 'daily_checkin_reminder_20' | 'daily_checkin_reminder_22',
  payload: DailyCheckinReminderData
): Promise<void> {
  return notifyTeams(type, payload)
}

export async function notifyMorningSummary(payload: MorningSummaryData): Promise<void> {
  return notifyTeams('daily_morning_summary', payload)
}
