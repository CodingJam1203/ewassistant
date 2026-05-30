/**
 * /api/admin/sheet-sources
 *   GET: 등록된 시트 source 목록 + 본부명 + 각 source의 캐시된 날짜 수 통계 + 매핑 팀 수
 *        + 등록 form 용 divisions 목록 (단일 fetch로 form 채우기)
 *   POST: 신규 시트 source 등록
 *
 * 권한: admin only
 */
import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-check'
import { createAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface SourceRow {
  id: string
  division_id: string
  label: string
  department_key: string
  spreadsheet_url: string | null
  is_active: boolean
  last_push_at: string | null
  last_push_error: string | null
  created_at: string
  updated_at: string
  division: { id: string; name: string; sort_order: number } | null
}

export async function GET() {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const client = createAdminClient()

  const [srcRes, divRes] = await Promise.all([
    client
      .from('org_sheet_sources')
      .select(`
        id, division_id, label, department_key, spreadsheet_url, is_active,
        last_push_at, last_push_error, created_at, updated_at,
        division:org_divisions(id, name, sort_order)
      `)
      .order('created_at', { ascending: true }),
    client
      .from('org_divisions')
      .select('id, name, sort_order')
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true }),
  ])

  const { data: sources, error: srcErr } = srcRes
  const { data: divisions } = divRes

  if (srcErr) {
    return NextResponse.json({ error: srcErr.message }, { status: 500 })
  }

  // 각 source별 캐시된 날짜 수 + 매핑된 팀 수 (best-effort)
  const sourceIds = (sources ?? []).map(s => s.id)
  const cachedCountsBySource = new Map<string, number>()
  const teamCountsBySource = new Map<string, number>()

  if (sourceIds.length > 0) {
    // 캐시된 날짜 수 — 한 번에 fetch 후 메모리에서 source별 count.
    const { data: cacheRows } = await client
      .from('leave_calendar_cache')
      .select('key')
      .like('key', 'calendar:%:%')  // 신규 형식만 (legacy 'calendar:DATE'는 source 미매핑)
    for (const r of (cacheRows ?? []) as Array<{ key: string }>) {
      // 'calendar:<source_id>:YYYY-MM-DD' parsing
      const m = /^calendar:([0-9a-f-]{36}):/i.exec(r.key)
      if (!m) continue
      const sid = m[1]
      cachedCountsBySource.set(sid, (cachedCountsBySource.get(sid) ?? 0) + 1)
    }

    // 매핑된 팀 수
    const { data: teams } = await client
      .from('org_teams')
      .select('sheet_source_id')
      .in('sheet_source_id', sourceIds)
    for (const t of (teams ?? []) as Array<{ sheet_source_id: string | null }>) {
      if (!t.sheet_source_id) continue
      teamCountsBySource.set(t.sheet_source_id, (teamCountsBySource.get(t.sheet_source_id) ?? 0) + 1)
    }
  }

  const rows = (sources ?? []).map((s) => {
    const src = s as unknown as SourceRow
    return {
      id: src.id,
      divisionId: src.division_id,
      label: src.label,
      departmentKey: src.department_key,
      spreadsheetUrl: src.spreadsheet_url,
      isActive: src.is_active,
      lastPushAt: src.last_push_at,
      lastPushError: src.last_push_error,
      createdAt: src.created_at,
      updatedAt: src.updated_at,
      division: src.division,
      cachedDates: cachedCountsBySource.get(src.id) ?? 0,
      mappedTeams: teamCountsBySource.get(src.id) ?? 0,
    }
  })

  return NextResponse.json({
    rows,
    divisions: divisions ?? [],
  })
}

/**
 * POST — 신규 시트 source 등록.
 * body: { division_id, label, department_key, is_active? }
 *   - department_key는 Apps Script payload의 departments[<key>]. 보통 본부명과 동일.
 *   - 같은 division_id 내 동일 department_key 중복 차단 (DB unique 제약).
 */
export async function POST(request: Request) {
  const adminUser = await requireAdmin()
  if (!adminUser) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json().catch(() => ({}))
  const division_id = typeof body.division_id === 'string' ? body.division_id.trim() : ''
  const label = typeof body.label === 'string' ? body.label.trim() : ''
  const department_key = typeof body.department_key === 'string' ? body.department_key.trim() : ''
  // v1.61 — 본부 시트 deep link URL (선택). 사용자 안내 박스의 [캘린더 시트 열기] 링크.
  const spreadsheet_url_raw = typeof body.spreadsheet_url === 'string' ? body.spreadsheet_url.trim() : ''
  const spreadsheet_url: string | null = spreadsheet_url_raw || null
  const is_active = body.is_active === false ? false : true

  if (!division_id) return NextResponse.json({ error: '본부를 선택해주세요.' }, { status: 400 })
  if (!label)       return NextResponse.json({ error: '라벨을 입력해주세요.' }, { status: 400 })
  if (!department_key) return NextResponse.json({ error: 'Apps Script payload key를 입력해주세요. (보통 본부명과 동일)' }, { status: 400 })
  if (spreadsheet_url && !/^https?:\/\//i.exec(spreadsheet_url)) {
    return NextResponse.json({ error: 'Spreadsheet URL은 https:// 형태여야 합니다.' }, { status: 400 })
  }

  const client = createAdminClient()
  const { data, error } = await client
    .from('org_sheet_sources')
    .insert({ division_id, label, department_key, spreadsheet_url, is_active })
    .select()
    .single()

  if (error) {
    if (error.code === '23503') return NextResponse.json({ error: '본부가 존재하지 않습니다.' }, { status: 400 })
    if (error.code === '23505') return NextResponse.json({ error: '같은 본부에 동일한 key의 source가 이미 있습니다.' }, { status: 409 })
    console.error('[admin/sheet-sources POST] error:', error)
    return NextResponse.json({ error: '시트 source 등록에 실패했습니다.' }, { status: 500 })
  }
  return NextResponse.json(data, { status: 201 })
}
