/**
 * POST /api/work-logs/bulk-leave
 *
 * 시작일~종료일 사이의 여러 날짜에 같은 유형의 휴가를 일괄 등록.
 * 캘린더뷰의 "휴가 등록" 모달이 호출.
 *
 * - 이미 같은 날짜에 work_log가 있는 날은 건너뜀 (덮어쓰기 방지). 사용자에게는
 *   skipped 목록으로 안내.
 * - 종일 휴가: leave_timeline에 full_day 1개, actual_work_time=0.
 * - 반차: leave_timeline에 morning_half 또는 afternoon_half 1개. 출퇴근은 09:00~18:00
 *   default로 채워두고, 사용자가 추후 출퇴근보고에서 수정.
 *
 * Teams 알림은 보내지 않음 (다수 row → 알림 폭탄 방지). 사용자가 직접 캘린더뷰에서
 * 등록 결과를 확인.
 *
 * body:
 *   {
 *     startDate: 'YYYY-MM-DD',
 *     endDate:   'YYYY-MM-DD',
 *     leaveType: 'full_day' | 'morning_half' | 'afternoon_half',
 *     excludeWeekends?: boolean (default true),
 *     note?: string,
 *   }
 *
 * response:
 *   {
 *     created: number,
 *     skipped: number,
 *     skippedDates: string[],
 *     createdDates: string[],
 *   }
 */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireActiveUser } from '@/lib/admin-check'
import { createAdminClient } from '@/lib/supabase/admin'
import { calculateEw } from '@/lib/ew-calculator'
import { buildLeaveItem } from '@/lib/leave-timeline'
import { recordSubmission } from '@/lib/submission-log'
import type { LeaveTimeline } from '@/types/leave-timeline'
import type { WorkLocationTimeline } from '@/types/work-location-timeline'

const MAX_DAYS = 60

const bodySchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '시작일 형식이 올바르지 않습니다.'),
  endDate:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '종료일 형식이 올바르지 않습니다.'),
  leaveType: z.enum(['full_day', 'morning_half', 'afternoon_half']),
  excludeWeekends: z.boolean().optional(),
  note: z.string().max(200).optional(),
})

export async function POST(request: Request) {
  try {
    const user = await requireActiveUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized or Inactive account' }, { status: 403 })
    }

    const json = await request.json().catch(() => null)
    const parsed = bodySchema.safeParse(json)
    if (!parsed.success) {
      const first = parsed.error.issues[0]
      return NextResponse.json({ error: first?.message ?? '입력값이 올바르지 않습니다.' }, { status: 400 })
    }
    const { startDate, endDate, leaveType, excludeWeekends = true, note } = parsed.data

    if (startDate > endDate) {
      return NextResponse.json({ error: '시작일이 종료일보다 늦습니다.' }, { status: 400 })
    }
    // 일자 enumerate
    const start = new Date(`${startDate}T00:00:00Z`)
    const end   = new Date(`${endDate}T00:00:00Z`)
    const totalDays = Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1
    if (totalDays > MAX_DAYS) {
      return NextResponse.json({ error: `한 번에 최대 ${MAX_DAYS}일까지 등록할 수 있습니다.` }, { status: 400 })
    }
    const dates: string[] = []
    for (let i = 0; i < totalDays; i++) {
      const d = new Date(start)
      d.setUTCDate(d.getUTCDate() + i)
      // 주말 제외
      const dow = d.getUTCDay() // 0=일, 6=토
      if (excludeWeekends && (dow === 0 || dow === 6)) continue
      dates.push(d.toISOString().slice(0, 10))
    }
    if (dates.length === 0) {
      return NextResponse.json({ error: '대상 날짜가 없습니다. (주말 제외 옵션을 확인해주세요.)' }, { status: 400 })
    }

    const adminClient = createAdminClient()

    // 본인 프로필 (이름 + 본부/팀)
    const { data: profile } = await adminClient
      .from('user_profiles')
      .select('display_name, division, team')
      .eq('id', user.id)
      .single()
    const displayName = profile?.display_name?.trim() || user.email!
    const userDivision = profile?.division ?? null
    const userTeam     = profile?.team ?? null

    // 이미 있는 work_log 일자 조회 (skip 대상)
    const { data: existing } = await adminClient
      .from('work_logs')
      .select('leave_date')
      .eq('user_id', user.id)
      .eq('is_deleted', false)
      .in('leave_date', dates)
    const existingSet = new Set((existing ?? []).map(r => r.leave_date as string))

    const createdDates: string[] = []
    const skippedDates: string[] = []

    // 종일 휴가용 default — work_location_timeline 비움(휴가)
    // 반차는 09:00~18:00 사무실 default로 두고 사용자가 후속 수정
    const isFullDay = leaveType === 'full_day'

    // 일자별 INSERT — 순차 처리 (병렬 시 RLS rate / Resend / Supabase quota 안 씀, 휴가 등록은 빈도 낮음)
    for (const date of dates) {
      if (existingSet.has(date)) {
        skippedDates.push(date)
        continue
      }

      const leaveItem = buildLeaveItem(leaveType)
      const leaveTimeline: LeaveTimeline = [leaveItem]
      const leaveMinutes = leaveItem.roundedMinutes

      const workLocationTimeline: WorkLocationTimeline | null = isFullDay
        ? null
        : [
            { kind: 'work_location', type: 'office', label: '사무실', customLabel: null, startTime: '09:00' },
            { kind: 'checkout',      startTime: '18:00' },
          ]

      const startTime = '09:00'
      const endTime   = '18:00'
      const breakTime = '00:00'
      const workLocation = isFullDay ? '휴가' : '사무실'

      const calcResult = calculateEw({
        name: displayName,
        workTypeLabel: '기본근무 등록',
        leaveDate: date,
        startTime,
        endTime,
        breakTime,
        workLocation,
        workContent: note || undefined,
        leaveMinutes,
        isFullDayLeave: isFullDay,
      })

      const insertData = {
        user_id: user.id,
        user_email: user.email!,
        division: userDivision,
        team: userTeam,
        name: displayName,
        work_type_label: '기본근무 등록',
        work_type_code: calcResult.workTypeCode,
        leave_date: date,
        start_time: startTime,
        end_time:   endTime,
        break_time: '00:00:00',
        work_content: note ?? null,
        work_location: workLocation,
        work_location_type: isFullDay ? null : '사무실',
        work_location_custom: null,
        work_location_timeline: workLocationTimeline,
        leave_timeline: leaveTimeline,
        late_or_attendance_status: '아니오',
        attendance_record_type: '스킵(누락퇴근보고, 퇴근보고 수정)',
        deduction_time: `${calcResult.deductionMinutes} minutes`,
        actual_work_time: `${calcResult.actualWorkMinutes} minutes`,
        ew_start:  calcResult.ewStartText,
        ew_end:    calcResult.ewEndText,
        ew_value:  calcResult.ewValue,
        copy_text: calcResult.copyText,
        teams_sent: false,
        is_deleted: false,
      }

      const { data: created, error: insertErr } = await adminClient
        .from('work_logs')
        .insert([insertData])
        .select('id')
        .single()

      if (insertErr) {
        console.error('[bulk-leave] insert failed:', date, insertErr.message)
        skippedDates.push(date)
        continue
      }

      createdDates.push(date)

      // submission 로그 기록 (퇴근보고 family로 기록 — 휴가는 퇴근 family에 매칭)
      void recordSubmission({
        user_id: user.id,
        user_email: user.email!,
        name: displayName,
        division: userDivision,
        team: userTeam,
        report_type: 'check_out',
        target_date: date,
        submitted_at: new Date().toISOString(),
        work_log_id: created?.id ?? null,
        start_time: startTime,
        end_time: endTime,
        break_time: '00:00:00',
        actual_work_time: `${calcResult.actualWorkMinutes} minutes`,
        work_location: workLocation,
        work_location_timeline: workLocationTimeline ?? null,
        leave_timeline: leaveTimeline,
        work_content: note ?? null,
        ew_value: calcResult.ewValue,
        ew_start: calcResult.ewStartText,
        ew_end:   calcResult.ewEndText,
        copy_text: calcResult.copyText,
        work_type_label: '기본근무 등록',
        work_type_code: calcResult.workTypeCode,
        attendance_record_type: '스킵(누락퇴근보고, 퇴근보고 수정)',
      })
    }

    return NextResponse.json({
      created: createdDates.length,
      skipped: skippedDates.length,
      createdDates,
      skippedDates,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[bulk-leave] error:', message)
    return NextResponse.json({ error: '서버 에러가 발생했습니다.' }, { status: 500 })
  }
}
