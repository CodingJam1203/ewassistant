/**
 * POST /api/calendar/write-cache
 *
 * Apps Script가 매시간 자가 트리거로 시트를 읽고 결과를 PUSH하는 수신 엔드포인트.
 *
 * 흐름:
 *   [Apps Script Time Trigger 매시간]
 *     → 시트 read + processDates (Apps Script 한도 6분, 충분)
 *     → UrlFetchApp.fetch(POST /api/calendar/write-cache, { days })
 *   [N-Click]
 *     → leave_calendar_cache upsert
 *
 * Vercel 함수는 단순 cache write만 수행 → 60초 timeout 부담 X.
 *
 * 인증:
 *   Authorization: Bearer ${CALENDAR_PUSH_SECRET || CRON_SECRET}
 *
 * Body:
 *   {
 *     "days": {
 *       "YYYY-MM-DD": {
 *         "departments": {
 *           "<본부명>": [{ "name": "...", "cellValue": "..." }, ...]
 *         }
 *       }
 *     }
 *   }
 */

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const maxDuration = 30

interface PushPayload {
  days?: Record<string, {
    departments?: Record<string, Array<{ name?: string; cellValue?: string }>>
  }>
}

export async function POST(request: Request) {
  const authHeader = request.headers.get('authorization')
  const secret = process.env.CALENDAR_PUSH_SECRET || process.env.CRON_SECRET
  if (!secret) {
    console.error('[calendar/write-cache] secret env not set')
    return NextResponse.json({ error: 'Server misconfiguration' }, { status: 500 })
  }
  if (authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: PushPayload | null = null
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!body?.days || typeof body.days !== 'object') {
    return NextResponse.json({ error: 'Missing days field' }, { status: 400 })
  }

  // 유효한 YYYY-MM-DD 키만 필터링
  const validDates = Object.keys(body.days).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d))
  if (validDates.length === 0) {
    return NextResponse.json({ error: 'No valid dates in body' }, { status: 400 })
  }

  // 한 번에 너무 많이 들어오면 거부 (Apps Script가 보통 91일치 보냄)
  if (validDates.length > 200) {
    return NextResponse.json({ error: 'Too many dates (max 200)' }, { status: 400 })
  }

  const now = new Date().toISOString()
  const rows = validDates.map(date => ({
    key: `calendar:${date}`,
    data: {
      date,
      departments: body!.days![date].departments ?? {},
    },
    updated_at: now,
  }))

  const adminClient = createAdminClient()
  const { error } = await adminClient
    .from('leave_calendar_cache')
    .upsert(rows, { onConflict: 'key' })

  if (error) {
    console.error('[calendar/write-cache] upsert error:', error.message)
    return NextResponse.json({ error: 'cache write failed', detail: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, written: rows.length, updatedAt: now })
}
