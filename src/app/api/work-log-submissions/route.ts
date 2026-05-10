/**
 * GET /api/work-log-submissions
 *
 * 쿼리:
 *   mine=true               — 본인만 (My Page용)
 *   division                — 본부 필터
 *   team                    — 팀 필터
 *   name                    — 이름 부분일치
 *   from, to                — target_date 범위 (YYYY-MM-DD)
 *   report_type             — check_in / check_out / check_in_update / check_out_update
 *   updated_only=true       — _update 만 (수정 이력만)
 *   limit                   — 최대 1000, default 200
 *
 * 권한 (조회):
 *   모든 active user — 전체 조직 조회 가능 (필터 자유). 회사 내부 자유 열람 정책.
 *   mine=true 명시 시에만 본인 row로 좁힘 (My Page용 의도).
 *
 * 권한 (수정/삭제):
 *   별도 엔드포인트(/api/work-logs/[id])에서 본인 또는 admin만.
 *
 * 응답: { rows: SubmissionRow[] }
 */

import { NextResponse } from 'next/server'
import { requireActiveUser } from '@/lib/admin-check'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET(request: Request) {
  try {
    const user = await requireActiveUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized or inactive account' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const mine = searchParams.get('mine') === 'true'
    const filterDivision = (searchParams.get('division') || '').trim()
    const filterTeam     = (searchParams.get('team')     || '').trim()
    const filterName     = (searchParams.get('name')     || '').trim()
    const filterFrom     = (searchParams.get('from')     || '').trim()
    const filterTo       = (searchParams.get('to')       || '').trim()
    const filterReportType = (searchParams.get('report_type') || '').trim()
    const updatedOnly    = searchParams.get('updated_only') === 'true'
    const limitRaw       = parseInt(searchParams.get('limit') || '200', 10)
    const limit = Math.min(1000, Math.max(1, Number.isFinite(limitRaw) ? limitRaw : 200))

    const adminClient = createAdminClient()

    let query = adminClient
      .from('work_log_submissions')
      .select(
        'id, user_email, name, division, team, ' +
        'report_type, target_date, submitted_at, work_log_id, ' +
        'start_time, end_time, break_time, actual_work_time, ' +
        'work_location, work_location_timeline, leave_timeline, ' +
        'work_content, ew_value, ew_start, ew_end, copy_text, ' +
        'late_or_attendance_status, previous_report_time, current_report_time, ' +
        'late_reason, break_reason, ' +
        'break_auto_actual_minutes, break_auto_rounded_minutes, ' +
        'break_manual_rounded_minutes, break_final_rounded_minutes, thanks_macaron, ' +
        'expected_start_date, expected_work_time, expected_work_location, ' +
        'expected_work_location_timeline, expected_leave_timeline, ' +
        'planned_work_locations, actual_work_locations, ' +
        'changed_fields, work_type_label, work_type_code, attendance_record_type'
      )
      .order('submitted_at', { ascending: false })
      .limit(limit)

    // ─── 권한 분기 (조회는 전체 공개 — 회사 내부 자유 열람) ──────
    if (mine) {
      // My Page에서 본인만 조회용
      query = query.eq('user_email', user.email!)
    } else {
      // 누구든 조직 전체 조회 가능. 필터 자유.
      if (filterDivision) query = query.eq('division', filterDivision)
      if (filterTeam)     query = query.eq('team',     filterTeam)
    }

    if (filterFrom) query = query.gte('target_date', filterFrom)
    if (filterTo)   query = query.lte('target_date', filterTo)

    if (filterReportType && ['check_in', 'check_out', 'check_in_update', 'check_out_update'].includes(filterReportType)) {
      query = query.eq('report_type', filterReportType)
    } else if (updatedOnly) {
      query = query.in('report_type', ['check_in_update', 'check_out_update'])
    }

    const { data, error } = await query
    if (error) {
      console.error('[/api/work-log-submissions]', error.message)
      return NextResponse.json({ error: '조회 실패' }, { status: 500 })
    }

    // Supabase 타입 추론이 union(GenericStringError 포함)이라 unknown 한 번 거쳐서 cast
    let rows = ((data ?? []) as unknown) as Array<{ name?: string | null }>
    if (filterName) {
      const needle = filterName.toLowerCase()
      rows = rows.filter(r => (r.name ?? '').toLowerCase().includes(needle))
    }

    return NextResponse.json({ rows })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[/api/work-log-submissions]', msg)
    return NextResponse.json({ error: '서버 에러가 발생했습니다.' }, { status: 500 })
  }
}
