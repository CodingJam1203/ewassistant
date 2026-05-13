/**
 * GET /api/cron/calendar-warm
 * 시간당 cron — 외부 Google Sheets 캘린더를 통째로 fetch해 leave_calendar_cache에 채워둠.
 *
 * 효과:
 *   - 사용자는 항상 캐시 hit만 받음 (Apps Script 호출 대기 0)
 *   - 캘린더뷰 진입이 즉시 응답 (~100ms)
 *   - Apps Script 부하: 사용자 트래픽과 무관하게 시간당 1회 고정
 *
 * 범위: 오늘 기준 -30 ~ +60일 (총 90일).
 *   - 과거 30일: 지난 한 달 회고용
 *   - 미래 60일: 휴가/일정 사전 등록 가시성
 *
 * 인증: 다른 cron들과 동일하게 Bearer ${CRON_SECRET}.
 *
 * 단일 Apps Script batch 호출(?from=&to=)로 처리 — 시트 read 1회.
 * 시트 측 Apps Script가 batch 미지원이면 fallback으로 forceRefreshCalendar를 day-by-day.
 */

import { NextResponse } from 'next/server'
import {
  getCalendarRangeBatch,
  isCalendarEnabled,
} from '@/lib/leave-calendar'

// Vercel Hobby 기본 함수 timeout 10s — batch 전체 처리에 필요한 만큼 늘림
export const maxDuration = 60

/** KST 기준 오늘 날짜 (YYYY-MM-DD) */
function getKstDate(offsetDays = 0): string {
  const d = new Date(Date.now() + 9 * 60 * 60 * 1000)
  d.setUTCDate(d.getUTCDate() + offsetDays)
  return d.toISOString().slice(0, 10)
}

const PAST_DAYS = 30
const FUTURE_DAYS = 60

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  const secret = process.env.CRON_SECRET
  if (!secret) {
    console.error('[cron/calendar-warm] CRON_SECRET env not set — rejecting all requests')
    return NextResponse.json({ error: 'Server misconfiguration' }, { status: 500 })
  }
  if (authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!isCalendarEnabled()) {
    return NextResponse.json({ enabled: false, message: 'LEAVE_CALENDAR_WEBHOOK_URL not set' })
  }

  // 1) 날짜 enumerate (KST 기준)
  const dates: string[] = []
  for (let i = -PAST_DAYS; i <= FUTURE_DAYS; i++) {
    dates.push(getKstDate(i))
  }

  // 2) Batch 호출 — Apps Script 신 ver(?from=&to=)이면 1회 호출로 끝남.
  //    구 ver이면 internal에서 per-date fallback 발생 (느리지만 동작).
  const startedAt = Date.now()
  let batchSucceeded = 0
  let batchFailed = 0

  try {
    // cron은 Apps Script 느림 (30~100s) → 50초까지 대기. Vercel maxDuration=60s 안에 끝.
    const batchResult = await getCalendarRangeBatch(dates, {
      timeoutMs: 50_000,
      allowAppsScriptFallback: true,  // cron 전용 — Apps Script 호출 OK
    })
    for (const date of dates) {
      if (batchResult[date]) batchSucceeded++
      else batchFailed++
    }

    // 3) batch 실패한 날짜는 다음 cron(1시간 후) 재시도. 즉시 per-date fallback은 안 함.
    //    이유: per-date 호출이 Apps Script 부하 N배. 다음 시간에 batch로 재시도가 더 효율적.
    if (batchFailed > 0) {
      console.warn(`[cron/calendar-warm] ${batchFailed} dates failed in batch — will retry next hour`)
    }

    const elapsedMs = Date.now() - startedAt
    return NextResponse.json({
      ok: true,
      total: dates.length,
      succeeded: batchSucceeded,
      failed: batchFailed,
      elapsedMs,
      range: { from: dates[0], to: dates[dates.length - 1] },
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[cron/calendar-warm] error:', message)
    return NextResponse.json({ ok: false, error: 'warm cache failed' }, { status: 500 })
  }
}
