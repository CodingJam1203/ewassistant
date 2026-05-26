/**
 * GET /api/my/calendar-mode
 *
 * 사용자 본인의 calendar_mode 반환. WorkLogForm 등 휴가 등록 UI에서
 * mode === 'sheet_only'일 때 "시트에도 직접 등록해주세요" 안내 표시용.
 *
 * 응답: { mode: 'gcal_only' | 'gcal_plus_sheet' | 'sheet_only' | 'none' }
 */
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getUserCalendarMode } from '@/lib/org-calendar/calendar-mode'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !user.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()
  const mode = await getUserCalendarMode(admin, user.email)

  return NextResponse.json({ mode }, {
    headers: {
      // 본인 mode는 거의 변경 없음 — 5분 캐시
      'Cache-Control': 'private, max-age=300, stale-while-revalidate=600',
    },
  })
}
