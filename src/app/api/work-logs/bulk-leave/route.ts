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
import { NextResponse, after } from 'next/server'
import { z } from 'zod'
import { requireActiveUser } from '@/lib/admin-check'
import { createAdminClient } from '@/lib/supabase/admin'
import { calculateEw } from '@/lib/ew-calculator'
import { buildLeaveItem, minutesToLeaveType } from '@/lib/leave-timeline'
import { recordSubmission } from '@/lib/submission-log'
import type { LeaveTimeline } from '@/types/leave-timeline'
import type { WorkLocationTimeline } from '@/types/work-location-timeline'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// 여러 날 × Google events.insert (Phase 1.5b push) — 날짜 수만큼 직렬 호출되므로 여유.
export const maxDuration = 60

const MAX_DAYS = 60

const bodySchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '시작일 형식이 올바르지 않습니다.'),
  endDate:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '종료일 형식이 올바르지 않습니다.'),
  // 30분 단위 휴가 시간(분). 30~480. 480=종일, 그 외=부분 휴가.
  // 하위호환: 옛 leaveType(enum)도 허용 — 들어오면 분으로 환산.
  leaveMinutes: z.number().int().min(30).max(480).multipleOf(30).optional(),
  leaveType: z.enum(['full_day', 'morning_half', 'afternoon_half']).optional(),
  // v1.83 — 사용자 입력 시간 명시 시 leave_timeline에 그대로 박힘.
  //   누락 시 LEAVE_TYPE_DEFINITIONS fallback (예: full_day → 09:00~18:00)
  //   현재 VacationRegisterModal은 미전달, 향후 admin tool에서 시간 명시 가능.
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$|^24:00$/, '시작 시간 형식이 올바르지 않습니다.').optional(),
  endTime:   z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$|^24:00$/, '종료 시간 형식이 올바르지 않습니다.').optional(),
  excludeWeekends: z.boolean().optional(),
  note: z.string().max(200).optional(),
}).refine(d => d.leaveMinutes != null || d.leaveType != null, {
  message: '휴가 시간을 선택해주세요.',
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
    const { startDate, endDate, excludeWeekends = true, note } = parsed.data
    // 휴가 시간(분) 결정 — leaveMinutes 우선, 없으면 옛 leaveType을 분으로 환산 (하위호환).
    const leaveMinutes: number = parsed.data.leaveMinutes
      ?? (parsed.data.leaveType === 'full_day' ? 480 : 240)
    const leaveType = minutesToLeaveType(leaveMinutes)  // 480→full_day, 그 외→morning_half
    if (!leaveType) {
      return NextResponse.json({ error: '휴가 시간이 올바르지 않습니다.' }, { status: 400 })
    }

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

      // 선택한 휴가 시간(분)을 차감 분으로 그대로 사용 (LeaveTimelineInput과 동일 정책)
      // v1.83 — body에 startTime/endTime 명시되어 있으면 그대로 박힘, 아니면 fallback.
      const leaveItem = buildLeaveItem(
        leaveType, '휴가', 'manual', leaveMinutes,
        parsed.data.startTime, parsed.data.endTime,
      )
      const leaveTimeline: LeaveTimeline = [leaveItem]

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
        workTypeLabel: '(평일) 기본 근무',
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
        work_type_label: '(평일) 기본 근무',
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

      // v1.83.14 — Google sync + recordSubmission을 after()로 백그라운드 분리.
      //   N일 휴가 등록 시 N × (1~5초) Google API 호출이 응답을 지연시키던 문제 해소.
      //   work_logs INSERT는 직렬 유지 — 정확한 createdDates/skippedDates 응답 보장.
      //   사용자가 bulk 휴가 등록 직후 그 휴가를 즉시 편집할 가능성 낮아 google_event_id race 위험 작음.
      const createdId = created?.id
      const syncSnapshot = leaveTimeline
      after(async () => {
        try {
          const { syncLeaveTimelineWithGoogle } = await import('@/lib/google-calendar/vacation-sync')
          const syncResult = await syncLeaveTimelineWithGoogle({
            adminClient,
            userEmail: user.email!,
            userDisplayName: displayName,
            leaveDate: date,
            prev: [],
            next: syncSnapshot,
          })
          if (syncResult.changed && syncResult.updatedTimeline && createdId) {
            await adminClient
              .from('work_logs')
              .update({ leave_timeline: syncResult.updatedTimeline })
              .eq('id', createdId)
          }
        } catch (syncErr) {
          console.error('[bulk-leave] vacation sync failed (background, non-fatal):', date, syncErr)
        }
      })

      // submission 로그 기록 (퇴근보고 family — 휴가는 퇴근 family에 매칭). after()로 백그라운드.
      const submissionPayload = {
        user_id: user.id,
        user_email: user.email!,
        name: displayName,
        division: userDivision,
        team: userTeam,
        report_type: 'check_out' as const,
        target_date: date,
        submitted_at: new Date().toISOString(),
        work_log_id: createdId ?? null,
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
      }
      after(() => recordSubmission(submissionPayload))
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
