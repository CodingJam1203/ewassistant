import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-check'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * POST /api/admin/teams-routing/bulk-copy
 *
 * v1.57 (2026-05-28) — 라우팅 복사 기능.
 *
 * 한 원본 라우팅 row(team_id / channel_id / message_id / webhook_url)를 같은 본부의
 * 여러 팀 × 보고유형 조합으로 일괄 복제. 원본의 webhook_url 등 민감값은 server에서
 * 원본 id로 조회해 복사하므로 client를 거치지 않는다(secret 노출 0).
 *
 * body:
 *   {
 *     source_id: string,            // 복사 원본 row id
 *     department: string,           // 대상 본부 (보통 원본과 동일)
 *     team_names: string[],         // 대상 팀명 목록
 *     report_types: ('출근보고'|'퇴근보고')[],  // 복제할 보고유형
 *   }
 *
 * 이미 존재하는 (department, team_name, report_type) 조합은 skip.
 */
const VALID_REPORT_TYPES = ['출근보고', '퇴근보고'] as const
type ReportType = typeof VALID_REPORT_TYPES[number]

export async function POST(request: Request) {
  const adminUser = await requireAdmin()
  if (!adminUser) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json()
  const sourceId: string = body.source_id
  const department: string = (body.department ?? '').trim()
  const teamNames: string[] = Array.isArray(body.team_names)
    ? body.team_names.map((t: unknown) => String(t).trim()).filter(Boolean)
    : []
  const reportTypes: ReportType[] = Array.isArray(body.report_types)
    ? body.report_types.filter((r: unknown): r is ReportType => VALID_REPORT_TYPES.includes(r as ReportType))
    : []

  if (!sourceId) return NextResponse.json({ error: 'source_id가 필요합니다.' }, { status: 400 })
  if (!department) return NextResponse.json({ error: '대상 본부가 필요합니다.' }, { status: 400 })
  if (teamNames.length === 0) return NextResponse.json({ error: '대상 팀을 1개 이상 선택하세요.' }, { status: 400 })
  if (reportTypes.length === 0) return NextResponse.json({ error: '보고유형을 1개 이상 선택하세요.' }, { status: 400 })

  const adminClient = createAdminClient()

  // 1) 원본 row 조회 (복사할 team_id/channel_id/message_id/webhook_url)
  const { data: src, error: srcErr } = await adminClient
    .from('teams_routing')
    .select('team_id, channel_id, message_id, webhook_url')
    .eq('id', sourceId)
    .maybeSingle()
  if (srcErr || !src) {
    return NextResponse.json({ error: '원본 라우팅을 찾을 수 없습니다.' }, { status: 404 })
  }

  // 2) 대상 본부에 이미 있는 (team_name, report_type) 조합 조회 — 중복 skip용
  const { data: existing } = await adminClient
    .from('teams_routing')
    .select('team_name, report_type')
    .eq('department', department)
  const existingKeys = new Set(
    (existing ?? []).map((e: { team_name: string; report_type: string }) => `${e.team_name}::${e.report_type}`),
  )

  // 3) 생성 대상 조합 구성 (중복 제외)
  const toInsert: Array<Record<string, unknown>> = []
  for (const teamName of teamNames) {
    for (const reportType of reportTypes) {
      if (existingKeys.has(`${teamName}::${reportType}`)) continue
      toInsert.push({
        department,
        team_name: teamName,
        report_type: reportType,
        team_id: src.team_id,
        channel_id: src.channel_id,
        message_id: src.message_id,
        webhook_url: src.webhook_url,
        is_active: true,
        notes: `라우팅 복사 (원본 ${sourceId.slice(0, 8)})`,
      })
    }
  }

  if (toInsert.length === 0) {
    return NextResponse.json({ inserted: 0, skipped: teamNames.length * reportTypes.length, rows: [] })
  }

  const { data: inserted, error: insErr } = await adminClient
    .from('teams_routing')
    .insert(toInsert)
    .select()
  if (insErr) {
    console.error('[teams-routing bulk-copy] insert error:', insErr)
    return NextResponse.json({ error: '복사 중 오류가 발생했습니다.' }, { status: 500 })
  }

  return NextResponse.json({
    inserted: inserted?.length ?? 0,
    skipped: teamNames.length * reportTypes.length - (inserted?.length ?? 0),
    rows: inserted ?? [],
  })
}
