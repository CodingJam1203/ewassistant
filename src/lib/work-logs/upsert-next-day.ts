/**
 * upsertNextDayRow — D+1 사전등록 row(work_logs)를 안전하게 UPSERT.
 *
 * 사용처:
 *   - POST /api/work-logs (퇴근보고 신규/UPSERT)
 *   - PATCH /api/work-logs/[id] (퇴근보고 수정)
 *
 * 정책:
 *   - 사용자가 D-1에 다음날 출근예정을 함께 보고하면, D+1 일자의 work_logs row를
 *     별도로 INSERT/UPDATE해서 헤더 카드(leave_date 기준 fetch)가 정상 표시되게 한다.
 *   - 본문 영역(start_time/end_time/work_location)에 사전등록값을 채움 — D+1 도래 시
 *     사용자가 실 보고하면 다시 갱신됨.
 *   - 과거에는 INSERT 시 NOT NULL 컬럼(work_type_code, deduction_time, actual_work_time,
 *     ew_start, ew_end, ew_value, copy_text)을 누락해 silent fail이 있었음 — 본 헬퍼는 모두 채움.
 *
 * 에러:
 *   - DB 에러 시 { ok: false, error } 반환. 호출부에서 콘솔 로깅 권장.
 */

import { getWorkTypeCode, getDeductionMinutes, type WorkTypeCode } from '@/lib/ew-calculator'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { WorkLocationTimeline } from '@/types/work-location-timeline'
import type { WorkLocations } from '@/types/work-locations-v2'
import type { LeaveTimeline } from '@/types/leave-timeline'

export interface UpsertNextDayInput {
  adminClient: SupabaseClient
  userId: string
  userEmail: string
  userDivision?: string | null
  userTeam?: string | null
  name: string
  workTypeLabel: string
  workSubType?: string | null
  /** YYYY-MM-DD */
  nextDate: string
  /** HH:mm */
  nextStartTime: string
  /** HH:mm */
  nextEndTime: string
  nextWorkLocation: string
  expectedTimeline?: WorkLocationTimeline | null
  plannedWorkLocations?: WorkLocations | null
  expectedLeaveTimeline?: LeaveTimeline | null
}

export interface UpsertNextDayResult {
  ok: boolean
  id: string | null
  action: 'inserted' | 'updated' | 'noop'
  error?: string
}

function minutesToInterval(min: number): string {
  const h = Math.floor(min / 60)
  const m = min % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`
}

export async function upsertNextDayRow(input: UpsertNextDayInput): Promise<UpsertNextDayResult> {
  const {
    adminClient, userId, userEmail, userDivision, userTeam,
    name, workTypeLabel, workSubType,
    nextDate, nextStartTime, nextEndTime, nextWorkLocation,
    expectedTimeline, plannedWorkLocations, expectedLeaveTimeline,
  } = input

  // D+1 row 존재 확인 (같은 user_email + leave_date)
  const { data: existing, error: selErr } = await adminClient
    .from('work_logs')
    .select('id')
    .eq('user_email', userEmail)
    .eq('leave_date', nextDate)
    .eq('is_deleted', false)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (selErr) {
    return { ok: false, id: null, action: 'noop', error: `select: ${selErr.message}` }
  }

  // 본문 + 사전등록 메타 (UPDATE/INSERT 공통)
  const baseData: Record<string, unknown> = {
    name,
    leave_date: nextDate,
    start_time: nextStartTime,
    end_time:   nextEndTime,
    work_location: nextWorkLocation,
    work_location_timeline: expectedTimeline ?? null,
    planned_work_locations: plannedWorkLocations ?? null,
    actual_work_locations: null,  // 아직 미정
    leave_timeline: expectedLeaveTimeline ?? null,
    attendance_record_type: '출근보고 진행 (주말출근, 휴가 포함)',
    // expected_*는 D+1 row에서는 의미 없음 (자기 자신이 D+1)
    expected_start_date:    null,
    expected_work_time:     null,
    expected_work_location: null,
    expected_work_location_timeline: null,
    expected_leave_timeline: null,
  }

  if (existing) {
    const { error: updErr } = await adminClient
      .from('work_logs')
      .update({ ...baseData, updated_at: new Date().toISOString(), updated_by: userId })
      .eq('id', existing.id)

    if (updErr) {
      return { ok: false, id: existing.id, action: 'noop', error: `update: ${updErr.message}` }
    }
    return { ok: true, id: existing.id, action: 'updated' }
  }

  // INSERT — NOT NULL 컬럼 모두 채움 (work_type_code/deduction/actual/ew_*/copy_text)
  const workTypeCode: WorkTypeCode = getWorkTypeCode(workTypeLabel)
  const deductionMin = getDeductionMinutes(workTypeCode)

  const insertData: Record<string, unknown> = {
    ...baseData,
    user_id: userId,
    user_email: userEmail,
    division: userDivision ?? null,
    team: userTeam ?? null,
    work_type_label: workTypeLabel,
    work_type_code:  workTypeCode,
    work_sub_type:   workSubType ?? null,
    late_or_attendance_status: '아니오',
    teams_sent: false,
    is_deleted: false,
    // NOT NULL 채움 — 사전등록 row이므로 EW 미계산. 실 보고 시 갱신됨.
    break_time:       '00:00:00',
    deduction_time:   minutesToInterval(deductionMin),
    actual_work_time: '00:00:00',
    ew_start: nextStartTime,
    ew_end:   nextEndTime,
    ew_value: '',
    copy_text: '',
  }

  const { data: inserted, error: insErr } = await adminClient
    .from('work_logs')
    .insert(insertData)
    .select('id')
    .single()

  if (insErr) {
    return { ok: false, id: null, action: 'noop', error: `insert: ${insErr.message}` }
  }
  return { ok: true, id: inserted?.id ?? null, action: 'inserted' }
}
