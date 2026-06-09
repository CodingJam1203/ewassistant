import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireActiveUser } from '@/lib/admin-check'

// GET /api/org — 본부+팀 전체 구조 (활성 로그인 사용자 공통)
export async function GET() {
  try {
    const user = await requireActiveUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized or inactive account' }, { status: 403 })
    }

    const supabase = await createClient()

    // v1.77 — read_only_calendar 컬럼 추가 응답
    const { data: divisions, error: divError } = await supabase
      .from('org_divisions')
      .select('id, name, sort_order, notify_on_advance_checkin, read_only_calendar')
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true })

    if (divError) throw divError

    const { data: teams, error: teamError } = await supabase
      .from('org_teams')
      .select('id, division_id, name, sort_order, use_check_in_complete, sheet_source_id, calendar_mode, notify_morning_07, notify_reminder_20, notify_reminder_22, use_leader_review')
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true })

    if (teamError) throw teamError

    // v1.77 — 본부별 시트 URL (read_only_calendar=true일 때 클라가 일정 chip 클릭 redirect용)
    const { data: sheetSources, error: sheetErr } = await supabase
      .from('org_sheet_sources')
      .select('division_id, spreadsheet_url')
      .eq('is_active', true)
      .not('spreadsheet_url', 'is', null)
    if (sheetErr) {
      console.warn('[/api/org GET] sheet_sources fetch failed (ignored):', sheetErr.message)
    }
    const sheetUrlByDiv = new Map<string, string>()
    for (const s of sheetSources ?? []) {
      const divId = s.division_id as string | null
      const url = s.spreadsheet_url as string | null
      if (divId && url && !sheetUrlByDiv.has(divId)) {
        sheetUrlByDiv.set(divId, url)
      }
    }

    // 본부별 팀 그룹화 + sheet_url 첨부
    const result = (divisions ?? []).map(div => ({
      ...div,
      sheet_url: sheetUrlByDiv.get(div.id as string) ?? null,
      teams: (teams ?? []).filter(t => t.division_id === div.id),
    }))

    // 조직 구조는 거의 변경 없음 — 60초 캐시 + 24h stale-while-revalidate
    return NextResponse.json(result, {
      headers: {
        'Cache-Control': 'private, max-age=60, stale-while-revalidate=86400',
      },
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[/api/org GET]', message)
    return NextResponse.json({ error: '서버 에러가 발생했습니다.' }, { status: 500 })
  }
}
