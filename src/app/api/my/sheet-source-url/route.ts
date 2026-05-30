/**
 * GET /api/my/sheet-source-url (v1.61, 2026-05-30)
 *
 * 사용자 본부에 매핑된 org_sheet_sources 중 spreadsheet_url이 있는 1건의 URL 반환.
 * 안내 박스의 [캘린더 시트 열기] deep link에 사용.
 *
 * 매칭 우선순위:
 *   - user_profiles.division → org_divisions.id → org_sheet_sources(is_active=true, spreadsheet_url IS NOT NULL)
 *   - 본부에 source가 여러 개면 created_at 가장 오래된 것 1건
 *
 * 응답: { url: string | null }
 * 캐싱: 30s private + SWR 300s — 본부 매핑 자주 안 바뀜.
 */
import { NextResponse } from 'next/server'
import { requireActiveUser } from '@/lib/admin-check'
import { createAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'

export async function GET() {
  const user = await requireActiveUser()
  if (!user) return NextResponse.json({ url: null })

  const admin = createAdminClient()
  const { data: profile } = await admin
    .from('user_profiles')
    .select('division')
    .eq('email', user.email!)
    .maybeSingle()
  if (!profile?.division) {
    return NextResponse.json({ url: null }, {
      headers: { 'Cache-Control': 'private, max-age=30, stale-while-revalidate=300' },
    })
  }

  const { data: div } = await admin
    .from('org_divisions')
    .select('id')
    .eq('name', profile.division)
    .maybeSingle()
  if (!div) {
    return NextResponse.json({ url: null }, {
      headers: { 'Cache-Control': 'private, max-age=30, stale-while-revalidate=300' },
    })
  }

  const { data: src } = await admin
    .from('org_sheet_sources')
    .select('spreadsheet_url')
    .eq('division_id', div.id)
    .eq('is_active', true)
    .not('spreadsheet_url', 'is', null)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  return NextResponse.json({ url: src?.spreadsheet_url ?? null }, {
    headers: { 'Cache-Control': 'private, max-age=30, stale-while-revalidate=300' },
  })
}
