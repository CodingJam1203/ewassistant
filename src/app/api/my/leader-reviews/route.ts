/**
 * v1.73 Phase 6 — GET /api/my/leader-reviews?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * 본인의 work_logs에 박힌 leader_reviews를 일자별로 조회.
 * 일반 구성원이 자기 미상신/오상신 피드백을 캘린더/카드에서 확인하는 용도.
 *
 * 응답: { byDate: { 'YYYY-MM-DD': { status, note, work_log_id, reviewed_at } } }
 * (status='checked'/null은 응답 byDate에 포함되지 않음 — 클라이언트는 missing/wrong만 표시)
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const maxDuration = 15

type ReviewStatus = 'checked' | 'missing' | 'wrong'

interface ByDateEntry {
  status: ReviewStatus
  note: string | null
  work_log_id: string
  reviewed_at: string
}

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) {
    return NextResponse.json({ error: '로그인 필요' }, { status: 401 })
  }

  const url = new URL(request.url)
  const from = (url.searchParams.get('from') ?? '').trim()
  const to = (url.searchParams.get('to') ?? '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return NextResponse.json({ error: 'from/to 형식 오류 (YYYY-MM-DD)' }, { status: 400 })
  }

  // 본인 work_logs id 모음 (날짜 범위)
  const { data: wlRows } = await supabase
    .from('work_logs')
    .select('id, leave_date')
    .eq('user_email', user.email)
    .eq('is_deleted', false)
    .gte('leave_date', from)
    .lte('leave_date', to)

  const rows = wlRows ?? []
  if (rows.length === 0) {
    return NextResponse.json({ byDate: {} })
  }

  const idToDate = new Map<string, string>()
  for (const r of rows) idToDate.set(r.id as string, r.leave_date as string)
  const ids = Array.from(idToDate.keys())

  // 미상신/오상신만 응답 (체크완료/미선택은 노출 X — 사용자 요청)
  const { data: reviews } = await supabase
    .from('work_log_leader_reviews')
    .select('work_log_id, status, note, reviewed_at')
    .in('work_log_id', ids)
    .in('status', ['missing', 'wrong'])

  const byDate: Record<string, ByDateEntry> = {}
  for (const r of reviews ?? []) {
    const date = idToDate.get(r.work_log_id as string)
    if (!date) continue
    byDate[date] = {
      status: r.status as ReviewStatus,
      note: r.note as string | null,
      work_log_id: r.work_log_id as string,
      reviewed_at: r.reviewed_at as string,
    }
  }

  return NextResponse.json({ byDate })
}
