/**
 * GET /api/admin/google-calendar/test
 *
 * Phase 4.1 인증 인프라 검증용 일회성 endpoint.
 * 모든 active org_calendars에 대해 Google Calendar API로 metadata + 다가오는 이벤트 5건씩 조회.
 * 각 캘린더의 service account 공유 상태를 한 번에 확인.
 *
 * 권한: admin only.
 *
 * 응답:
 *   { ok, serviceAccountEmail, results: [{ label, googleCalendarId, status: 'ok'|'error', summary, eventCount, error? }] }
 */

import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-check'
import { createAdminClient } from '@/lib/supabase/admin'
import { getGoogleCalendarClient, getServiceAccountEmail, extractCalendarRawId } from '@/lib/google-calendar/client'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

interface ResultRow {
  label: string
  googleCalendarId: string
  status: 'ok' | 'error'
  summary?: string | null
  eventCount?: number
  error?: string
}

interface MyCalendarRow {
  id: string
  summary: string | null
  accessRole: string | null
}

export async function GET() {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const dbAdmin = createAdminClient()
  const { data: calendars, error } = await dbAdmin
    .from('org_calendars')
    .select('id, label, google_calendar_id, is_active')
    .eq('is_active', true)
    .order('label')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  let serviceAccountEmail: string | null = null
  try {
    serviceAccountEmail = getServiceAccountEmail()
  } catch (err) {
    return NextResponse.json({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      hint: 'GOOGLE_SERVICE_ACCOUNT_KEY env 가 등록되지 않았거나 JSON 파싱 실패',
    }, { status: 500 })
  }

  let cal
  try {
    cal = getGoogleCalendarClient()
  } catch (err) {
    return NextResponse.json({
      ok: false,
      serviceAccountEmail,
      error: err instanceof Error ? err.message : String(err),
    }, { status: 500 })
  }

  // 진단용: service account 본인에게 list된 모든 캘린더 조회.
  // 캘린더 ID 매칭 실패(공유 누락/오타) vs 정책 차단을 구분하는 데 사용.
  let myCalendars: MyCalendarRow[] = []
  let myCalendarsError: string | null = null
  try {
    const listed = await cal.calendarList.list({ maxResults: 250 })
    myCalendars = (listed.data.items ?? []).map(c => ({
      id: c.id ?? '',
      summary: c.summary ?? null,
      accessRole: c.accessRole ?? null,
    }))
  } catch (err) {
    myCalendarsError = err instanceof Error ? err.message : String(err)
  }

  const results: ResultRow[] = []
  const nowIso = new Date().toISOString()

  for (const c of calendars ?? []) {
    const rawId = extractCalendarRawId(c.google_calendar_id)
    try {
      const meta = await cal.calendars.get({ calendarId: rawId })
      const events = await cal.events.list({
        calendarId: rawId,
        timeMin: nowIso,
        maxResults: 5,
        singleEvents: true,
      })
      results.push({
        label: c.label,
        googleCalendarId: rawId,
        status: 'ok',
        summary: meta.data.summary ?? null,
        eventCount: events.data.items?.length ?? 0,
      })
    } catch (err: unknown) {
      // Google API 에러는 보통 status code 포함. 403 = 권한 없음(공유 안 됨)
      const message = err instanceof Error ? err.message : String(err)
      results.push({
        label: c.label,
        googleCalendarId: rawId,
        status: 'error',
        error: message,
      })
    }
  }

  const okCount = results.filter(r => r.status === 'ok').length
  return NextResponse.json({
    ok: okCount === results.length,
    serviceAccountEmail,
    summary: `${okCount}/${results.length} 캘린더 접근 OK`,
    results,
    // 진단 — service account 본인 calendarList.list 결과
    myCalendars,
    myCalendarsCount: myCalendars.length,
    myCalendarsError,
  })
}
