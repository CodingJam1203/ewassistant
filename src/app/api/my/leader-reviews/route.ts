/**
 * v1.73 + v1.74 — GET /api/my/leader-reviews?from=&to=
 *
 * 본인 review map (missing/wrong만). 일반 구성원이 자기 피드백 확인용.
 * v1.74 — work_log 없는 가상 review도 응답 (target_user_email + target_date 기준).
 *
 * 응답: { byDate: { 'YYYY-MM-DD': { status, note, work_log_id? } } }
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const maxDuration = 15

type ReviewStatus = 'missing' | 'wrong'

interface ByDateEntry {
  status: ReviewStatus
  note: string | null
  work_log_id: string | null
  reviewed_at: string
  /** v1.76 — 본인이 해지요청 보낸 시각. NULL이면 미요청 (해지요청 가능). */
  resolution_requested_at: string | null
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

  const email = user.email.toLowerCase()
  // v1.74 — target_user_email + target_date 기준 직접 조회 (work_log_id 무관)
  // v1.76 — resolution_requested_at도 함께 가져옴 (해지요청 버튼 노출 여부 판단용)
  const { data: reviews } = await supabase
    .from('work_log_leader_reviews')
    .select('target_date, status, note, work_log_id, reviewed_at, resolution_requested_at')
    .eq('target_user_email', email)
    .gte('target_date', from)
    .lte('target_date', to)
    .in('status', ['missing', 'wrong'])

  const byDate: Record<string, ByDateEntry> = {}
  for (const r of reviews ?? []) {
    byDate[r.target_date as string] = {
      status: r.status as ReviewStatus,
      note: (r.note as string | null) ?? null,
      work_log_id: (r.work_log_id as string | null) ?? null,
      reviewed_at: r.reviewed_at as string,
      resolution_requested_at: (r.resolution_requested_at as string | null) ?? null,
    }
  }

  return NextResponse.json({ byDate })
}
