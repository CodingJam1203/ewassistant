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
 *     → org_sheet_sources에서 department_key → source_id 매핑
 *     → leave_calendar_cache upsert (source별 row 분할)
 *     → org_sheet_sources.last_push_at 갱신
 *
 * Vercel 함수는 단순 cache write만 수행 → 60초 timeout 부담 X.
 *
 * 인증:
 *   Authorization: Bearer ${CALENDAR_PUSH_SECRET || CRON_SECRET}
 *
 * Body (Apps Script payload — 형식 변동 없음):
 *   {
 *     "days": {
 *       "YYYY-MM-DD": {
 *         "departments": {
 *           "<본부명>": [{ "name": "...", "cellValue": "..." }, ...]
 *         }
 *       }
 *     }
 *   }
 *
 * 캐시 키 (Phase A — source-aware):
 *   - 본부명 매칭된 source가 있으면: `calendar:<source_id>:YYYY-MM-DD`
 *   - 매칭 실패한 본부명은 legacy 형식: `calendar:YYYY-MM-DD` (backward compat)
 *   read 측은 두 형식 다 인식 (leave-calendar.ts).
 */

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const maxDuration = 30

interface PushPayload {
  days?: Record<string, {
    departments?: Record<string, Array<{ name?: string; cellValue?: string }>>
  }>
}

interface SheetSourceRow {
  id: string
  department_key: string
}

interface CacheRow {
  key: string
  data: { date: string; departments: Record<string, Array<{ name?: string; cellValue?: string }>> }
  updated_at: string
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

  const adminClient = createAdminClient()

  // Phase A — 활성 source의 department_key → source_id 매핑 fetch (단일 쿼리)
  const { data: sources, error: sourcesErr } = await adminClient
    .from('org_sheet_sources')
    .select('id, department_key')
    .eq('is_active', true)

  if (sourcesErr) {
    console.warn('[calendar/write-cache] sheet sources fetch failed (will fallback to legacy keys):', sourcesErr.message)
  }
  const sourceByKey = new Map<string, string>()
  for (const s of (sources ?? []) as SheetSourceRow[]) {
    sourceByKey.set(s.department_key, s.id)
  }

  const now = new Date().toISOString()
  const rows: CacheRow[] = []
  const usedSourceIds = new Set<string>()
  const unmatchedDepts = new Set<string>()

  for (const date of validDates) {
    const depts = body.days[date].departments ?? {}
    const legacyDepts: Record<string, Array<{ name?: string; cellValue?: string }>> = {}
    let hasLegacy = false

    for (const [deptName, entries] of Object.entries(depts)) {
      if (!Array.isArray(entries)) continue
      const sourceId = sourceByKey.get(deptName)
      if (sourceId) {
        // 새 format: source별 row 1건 (해당 본부 entries만)
        rows.push({
          key: `calendar:${sourceId}:${date}`,
          data: { date, departments: { [deptName]: entries } },
          updated_at: now,
        })
        usedSourceIds.add(sourceId)
      } else {
        // source 미등록 본부 → legacy row에 묶어 backward-compat 유지
        legacyDepts[deptName] = entries
        hasLegacy = true
        unmatchedDepts.add(deptName)
      }
    }

    if (hasLegacy) {
      rows.push({
        key: `calendar:${date}`,
        data: { date, departments: legacyDepts },
        updated_at: now,
      })
    }
  }

  const { error: upsertErr } = await adminClient
    .from('leave_calendar_cache')
    .upsert(rows, { onConflict: 'key' })

  if (upsertErr) {
    console.error('[calendar/write-cache] upsert error:', upsertErr.message)
    // last_push_error 갱신 시도 (best-effort)
    if (usedSourceIds.size > 0) {
      await adminClient
        .from('org_sheet_sources')
        .update({ last_push_error: upsertErr.message })
        .in('id', Array.from(usedSourceIds))
    }
    return NextResponse.json({ error: 'cache write failed' }, { status: 500 })
  }

  // 성공한 source들의 last_push_at 갱신 (best-effort)
  if (usedSourceIds.size > 0) {
    const { error: pushAtErr } = await adminClient
      .from('org_sheet_sources')
      .update({ last_push_at: now, last_push_error: null })
      .in('id', Array.from(usedSourceIds))
    if (pushAtErr) {
      console.warn('[calendar/write-cache] last_push_at update failed:', pushAtErr.message)
    }
  }

  if (unmatchedDepts.size > 0) {
    // source 미등록 본부 안내 — admin이 org_sheet_sources에 row 추가하면 다음 push부터 source-keyed로 분리됨.
    console.warn('[calendar/write-cache] unmatched department keys (using legacy key fallback):', [...unmatchedDepts].join(', '))
  }

  return NextResponse.json({
    ok: true,
    written: rows.length,
    dates: validDates.length,
    matchedSources: usedSourceIds.size,
    unmatchedDepts: unmatchedDepts.size,
    updatedAt: now,
  })
}
