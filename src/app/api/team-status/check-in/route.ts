import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getKstTodayDateString } from '@/lib/utils/date'
import { kstHHmmToIso } from '@/lib/utils/kst-datetime'
import { calculateEw } from '@/lib/ew-calculator'
import { notifyCheckinSubmitted } from '@/lib/notifications/teams'
import { maybeNotifyAdvanceCheckin } from '@/lib/notifications/advance-checkin'
import { resolveRoutingTeam } from '@/lib/org'

// 알림 발송(notifyCheckinSubmitted)이 fire-and-forget + sendToMake retry(최대 31.5s).
// 응답 후 Vercel function grace period 안에 retry promise 완주하도록 30s 확보.
// 2026-05-19 v1.21: 30→60. notify await 대응 — sendToMake retry 최악 31.5s + DB 처리 여유.
export const maxDuration = 60
import {
  validateTimeline,
  firstWorkLocation,
  endItemOf,
  displayLocation,
  buildLocationSummary,
  legacyToTimeline,
} from '@/lib/work-location-timeline'
import {
  validateLeaveTimeline,
  isFullDayLeave,
  effectiveLeaveDeductionMinutes,
  buildLeaveCopyTextNotice,
} from '@/lib/leave-timeline'
import {
  snapMinutes,
  isHalfHour,
  isHalfHourHHmm,
} from '@/lib/utils/half-hour'
import {
  normalizeWorkLocations,
  legacyTimelineToLocations,
  legacySingleToLocations,
  validateWorkLocations,
  firstChipLabel,
  formatChipsArrow,
} from '@/lib/work-locations-v2'
import { recordSubmission } from '@/lib/submission-log'
import type { WorkLocationTimeline } from '@/types/work-location-timeline'
import type { WorkLocations } from '@/types/work-locations-v2'
import type { LeaveTimeline } from '@/types/leave-timeline'

/**
 * POST /api/team-status/check-in
 *
 * 새 정책 (한 일자 한 row 모델):
 *   - 한 사용자 + 한 일자 = work_logs row 1개 (leave_date 매칭)
 *   - 출근보고 작성/수정/출근완료를 통합 처리
 *   - body.actualCheckInTime (HH:mm 또는 null/empty):
 *       * 비어있음 → daily.checked_in_at = NULL (출근 아직 안 함)
 *       * 채워짐  → daily.checked_in_at = ISO (실제 출근 갱신)
 *
 * report_type 분기:
 *   - row 신규 INSERT      → check_in
 *   - row 기존 UPDATE      → check_in_update (예정값 변경) or check_in_complete (실제출근만 갱신)
 */
export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json()
    const date: string = body.date ?? getKstTodayDateString()
    const submissionNow = new Date().toISOString()
    const adminClient = createAdminClient()

    const { data: profile } = await adminClient
      .from('user_profiles')
      .select('id, email, display_name, division, team, notify_team')
      .eq('email', user.email!)
      .single()

    // ─── 휴가 타임라인 ─────────────────────────────────────────────────────────
    let leaveTimeline: LeaveTimeline | null = null
    if (Array.isArray(body.leaveTimeline) && body.leaveTimeline.length > 0) {
      const leErrors = validateLeaveTimeline(body.leaveTimeline as LeaveTimeline)
      if (leErrors.length > 0) {
        return NextResponse.json(
          { error: '휴가/반차 정보가 올바르지 않습니다: ' + leErrors.map(e => e.message).join(', ') },
          { status: 400 }
        )
      }
      leaveTimeline = body.leaveTimeline as LeaveTimeline
    }
    const isAllDayLeave = isFullDayLeave(leaveTimeline ?? [])

    // ─── v2 plannedWorkLocations ────────────────────────────────────────────
    let plannedLocations: WorkLocations | null = null
    if (Array.isArray(body.plannedWorkLocations) && body.plannedWorkLocations.length > 0) {
      const norm = normalizeWorkLocations(body.plannedWorkLocations)
      if (norm) {
        const errs = validateWorkLocations(norm)
        if (errs.length > 0 && !isAllDayLeave) {
          return NextResponse.json(
            { error: '근무장소가 올바르지 않습니다: ' + errs.map(e => e.message).join(', ') },
            { status: 400 }
          )
        }
        plannedLocations = norm
      }
    }

    // ─── legacy timeline (호환) ──────────────────────────────────────────────
    let timeline: WorkLocationTimeline | null = null
    if (Array.isArray(body.workLocationTimeline) && body.workLocationTimeline.length > 0) {
      const tlErrors = validateTimeline(body.workLocationTimeline as WorkLocationTimeline)
      if (tlErrors.length > 0) {
        return NextResponse.json(
          { error: '근무장소 타임라인이 올바르지 않습니다: ' + tlErrors.map(e => e.message).join(', ') },
          { status: 400 }
        )
      }
      timeline = body.workLocationTimeline as WorkLocationTimeline
    } else if (!isAllDayLeave && (body.work_location || body.work_location_type || body.start_time)) {
      timeline = legacyToTimeline({
        expectedWorkLocation: body.work_location ?? null,
        expectedWorkLocationType: body.work_location_type ?? null,
        expectedWorkTime: body.start_time ?? null,
        fallbackCheckoutTime: body.end_time ?? null,
        asExpected: true,
      })
    }

    if (!plannedLocations) {
      plannedLocations = legacyTimelineToLocations(timeline)
        ?? legacySingleToLocations(body.work_location ?? null)
    }

    if (!isAllDayLeave) {
      const hasV2 = !!(plannedLocations && plannedLocations.length > 0)
      const hasLegacy = !!(timeline && timeline.length > 0)
      if (!hasV2 && !hasLegacy) {
        return NextResponse.json(
          { error: '근무장소가 필요합니다 (종일 휴가가 아닌 경우).' },
          { status: 400 }
        )
      }
    }

    // ─── 30분 단위 검증 ─────────────────────────────────────────────────────
    const breakTime    = body.break_time    ?? '00:00'
    const workContent  = body.work_content  ?? ''
    const name         = body.name ?? profile?.display_name ?? user.email!

    if (breakTime && !isHalfHourHHmm(breakTime)) {
      return NextResponse.json({ error: '휴게시간은 30분 단위로 입력해주세요.' }, { status: 400 })
    }
    if (body.start_time && !isHalfHourHHmm(body.start_time)) {
      return NextResponse.json({ error: '출근 시각은 30분 단위로 입력해주세요.' }, { status: 400 })
    }
    if (body.end_time && !isHalfHourHHmm(body.end_time)) {
      return NextResponse.json({ error: '퇴근 시각은 30분 단위로 입력해주세요.' }, { status: 400 })
    }
    // actualCheckInTime — 비어있을 수 있음. 비어있지 않으면 30분 단위 검증
    const actualCheckInTimeRaw: string | null | undefined = body.actualCheckInTime
    if (actualCheckInTimeRaw && !isHalfHourHHmm(actualCheckInTimeRaw)) {
      return NextResponse.json({ error: '실제 출근시간은 30분 단위로 입력해주세요.' }, { status: 400 })
    }

    // ─── 시간/장소 도출 ──────────────────────────────────────────────────────
    const tlFirst = timeline ? firstWorkLocation(timeline) : null
    const tlEnd   = timeline ? endItemOf(timeline) : null
    const startTime = isAllDayLeave
      ? '09:00'
      : (body.start_time ?? tlFirst?.startTime ?? '09:00')
    const endTime   = isAllDayLeave
      ? '18:00'
      : (body.end_time ?? tlEnd?.startTime ?? '18:00')
    const workLocation = isAllDayLeave
      ? '휴가'
      : (firstChipLabel(plannedLocations)
          || (tlFirst ? displayLocation(tlFirst) : (body.work_location ?? '사무실')))
    const locationSummary = isAllDayLeave
      ? '휴가'
      : (formatChipsArrow(plannedLocations)
          || (timeline ? buildLocationSummary(timeline) : workLocation)
          || workLocation)

    // v1.59 — full_day만 EW 차감. 8H 미만 휴가는 표시만 유지 (효과 0).
    const leaveMinutes = effectiveLeaveDeductionMinutes(leaveTimeline ?? [])

    const calcResult = calculateEw({
      name,
      workTypeLabel: '기본근무 등록',
      leaveDate: date,
      startTime,
      endTime,
      breakTime,
      workLocation: locationSummary,
      workContent,
      leaveMinutes,
      isFullDayLeave: isAllDayLeave,
      // v1.60 — 8H 미만 휴가 suffix
      leaveCopyTextNotice: buildLeaveCopyTextNotice(leaveTimeline ?? []),
    })

    if (!isHalfHour(calcResult.actualWorkMinutes)) {
      console.warn('[/check-in] non-30min actual auto-snapped',
        { user: user.email, raw: calcResult.actualWorkMinutes, startTime, endTime, breakTime })
    }

    // ─── 기존 D-day row 찾기 ─────────────────────────────────────────────────
    let workLogId: string | null = body.work_log_id ?? null
    let prevPlannedLocations: WorkLocations | null = null
    let prevStartTime: string | null = null
    let prevEndTime: string | null = null
    if (!workLogId) {
      const { data: todayLog } = await adminClient
        .from('work_logs')
        .select('id, planned_work_locations, start_time, end_time')
        .eq('user_email', user.email!)
        .eq('leave_date', date)
        .eq('is_deleted', false)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (todayLog) {
        workLogId = todayLog.id
        prevPlannedLocations = normalizeWorkLocations(todayLog.planned_work_locations)
        prevStartTime = typeof todayLog.start_time === 'string' ? todayLog.start_time.slice(0, 5) : null
        prevEndTime = typeof todayLog.end_time === 'string' ? todayLog.end_time.slice(0, 5) : null
      }
    }

    const willCreateNewLog = !workLogId

    // Phase 1.5b 확장 (2026-05-21) — Google 휴가 sync diff용 prev leave_timeline.
    // update 케이스에서 기존 값을 덮어쓰기 전에 확보 (신규는 []).
    let prevLeaveTimeline: LeaveTimeline = []
    if (workLogId) {
      const { data: prevLtRow } = await adminClient
        .from('work_logs')
        .select('leave_timeline')
        .eq('id', workLogId)
        .maybeSingle()
      const plt = (prevLtRow as { leave_timeline?: LeaveTimeline } | null)?.leave_timeline
      prevLeaveTimeline = Array.isArray(plt) ? plt : []
    }

    // Stage 2: 미보고 SoT — true면 planned_start_time을 NULL로 저장.
    // legacy start_time은 NOT NULL이라 그대로 startTime 값 유지 (호환).
    const plannedStartUnreported = body.plannedStartTimeUnreported === true

    // 예정값 영역
    const bodyArea = {
      name,
      work_type_label: '기본근무 등록',
      work_type_code:  calcResult.workTypeCode,
      leave_date:      date,
      start_time:      startTime,
      end_time:        endTime,
      // Stage 0-2: 출근보고는 예정값 — planned_* SoT 컬럼에도 동시 저장
      // Stage 2: 미보고면 planned_start_time = NULL (legacy start_time은 NOT NULL이라 유지)
      planned_start_time: plannedStartUnreported ? null : startTime,
      planned_end_time:   endTime,
      break_time:      `${breakTime}:00`,
      work_content:    workContent || null,
      // legacy mirror
      work_location:        workLocation,
      work_location_type:   tlFirst?.type === 'custom' ? '기타' : (tlFirst?.label ?? (isAllDayLeave ? null : '사무실')),
      work_location_custom: tlFirst?.type === 'custom' ? (tlFirst.customLabel ?? null) : null,
      work_location_timeline: timeline,
      // v2 — 출근시점엔 actual NULL (퇴근보고에서 입력)
      planned_work_locations: plannedLocations,
      actual_work_locations:  null,
      leave_timeline:         leaveTimeline,
      late_or_attendance_status: '아니오',
      attendance_record_type: '출근보고 진행 (주말출근, 휴가 포함)',
      // expected_*는 비움 — 다음날 정보는 퇴근보고에서
      expected_start_date:    null,
      expected_work_time:     null,
      expected_work_location: null,
      expected_work_location_timeline: null,
      expected_leave_timeline: null,
      deduction_time: `${calcResult.deductionMinutes} minutes`,
      actual_work_time: `${snapMinutes(calcResult.actualWorkMinutes, 'round')} minutes`,
      ew_start:  calcResult.ewStartText,
      ew_end:    calcResult.ewEndText,
      ew_value:  calcResult.ewValue,
      copy_text: calcResult.copyText,
    }

    if (workLogId) {
      const { error: updErr } = await adminClient
        .from('work_logs')
        .update({ ...bodyArea, updated_at: submissionNow, updated_by: user.id })
        .eq('id', workLogId)
      if (updErr) throw updErr
    } else {
      const { data: newLog, error: insErr } = await adminClient
        .from('work_logs')
        .insert({
          ...bodyArea,
          user_id:    user.id,
          user_email: user.email!,
          division:   profile?.division ?? null,
          team:       profile?.team     ?? null,
          teams_sent: false,
          is_deleted: false,
          location_history: JSON.stringify([
            { time: new Date().toTimeString().slice(0, 5), location: workLocation, source: 'initial' }
          ]),
        })
        .select()
        .single()
      if (insErr) throw insErr
      workLogId = newLog.id
    }

    // ─── Phase 1.5b 확장 — 출근보고 휴가도 Google 캘린더에 push ────────────────
    // 종전엔 /api/work-logs POST + bulk-leave에만 push가 있어, 출근보고(사전 휴가 등록 포함)로
    // 넣은 휴가가 Google·일정관리 뷰에 반영 안 되던 버그. best-effort.
    try {
      const { syncLeaveTimelineWithGoogle } = await import('@/lib/google-calendar/vacation-sync')
      const syncResult = await syncLeaveTimelineWithGoogle({
        adminClient,
        userEmail: user.email!,
        userDisplayName: name || user.email!,
        leaveDate: date,
        prev: prevLeaveTimeline,
        next: leaveTimeline ?? [],
      })
      if (syncResult.changed && syncResult.updatedTimeline && workLogId) {
        await adminClient
          .from('work_logs')
          .update({ leave_timeline: syncResult.updatedTimeline })
          .eq('id', workLogId)
      }
    } catch (syncErr) {
      console.error('[check-in] vacation sync failed (non-fatal):', syncErr)
    }

    // ─── 변경 필드 분석 (report_type 분기 + RAW 기록용) ──────────────────────
    const plannedChanged =
      JSON.stringify(prevPlannedLocations) !== JSON.stringify(plannedLocations)
      || prevStartTime !== startTime
      || prevEndTime !== endTime

    // v1.44 — use_check_in_complete 분기 제거: false 팀의 작성 시점 자동 actual 채움은 폐지.
    // false 팀의 planned 도달 시점 자동 채움은 team-status GET의 lazy write가 담당 (§8.2).

    // ─── daily_work_status 갱신 ──────────────────────────────────────────────
    // checked_in_at 결정 (v1.44 정책):
    //   1) actualCheckInTime이 명시적으로 들어옴 → 그 값 사용 (수동 지각/조기출근, [출근 완료] 클릭)
    //   2) 명시 없음 → NULL 유지 (작성 시점엔 출근완료 안 함).
    //      false 팀의 "planned 도달 시 자동 채움"은 team-status GET의 lazy write가 담당(§8.2).
    //      이전 §8.2.1 "작성 즉시 actual=startTime" 자동 채움은 제거 — 8시 미리 작성 시 actual=09:00이
    //      이미 박혀 카드 "근무 중"이 되던 동작을 폐기.
    const actualCheckInTime: string | null = (
      typeof actualCheckInTimeRaw === 'string' && actualCheckInTimeRaw.trim()
    ) ? actualCheckInTimeRaw : null

    let prevCheckedInAt: string | null = null
    {
      const { data: prevDaily } = await adminClient
        .from('daily_work_status')
        .select('checked_in_at')
        .eq('work_date', date)
        .eq('user_email', user.email!)
        .maybeSingle()
      prevCheckedInAt = prevDaily?.checked_in_at ?? null
    }

    // 자정 넘긴 출근(예 24:30 — 실출근 input allowNextDay)도 kstHHmmToIso로 안전 변환.
    // 직접 new Date(`...T24:30...`)는 Invalid Date → toISOString throw → 500 (v1.34 동일 클래스).
    const checkedInAtIso: string | null = actualCheckInTime
      ? kstHHmmToIso(date, actualCheckInTime)
      : null

    const checkedInChanged = (prevCheckedInAt ?? null) !== (checkedInAtIso ?? null)

    const currentLocation = firstChipLabel(plannedLocations)
      || (tlFirst ? displayLocation(tlFirst) : (body.work_location ?? body.work_location_type ?? '사무실'))

    const dailyUpsertPayload: Record<string, unknown> = {
      work_date:        date,
      user_email:       user.email!,
      user_profile_id:  profile?.id ?? null,
      work_log_id:      workLogId,
      status:           checkedInAtIso ? 'working' : 'reported',
      current_location: currentLocation,
      checked_in_at:    checkedInAtIso,  // null이면 출근 안 한 상태로 되돌림
      is_on_break:      false,
      updated_at:       submissionNow,
    }
    // 새 work_log row가 생성되는 케이스(이전 row가 어드민·정리·재제출로 교체된 상황)
    // 에서는 이전 퇴근 잔재(checked_out_at)가 그대로 남아 UI에 옛 시각이 노출되는 버그를
    // 유발한다. 새 출근보고는 "이전 퇴근 사이클이 더 이상 유효하지 않다"는 신호이므로
    // checked_out_at을 명시적으로 NULL로 reset 한다. (status 도 working/reported 로 위에서 결정)
    if (willCreateNewLog) {
      dailyUpsertPayload.checked_out_at = null
    }

    const { data: daily, error: dailyErr } = await adminClient
      .from('daily_work_status')
      .upsert(dailyUpsertPayload, { onConflict: 'work_date,user_email' })
      .select()
      .single()

    if (dailyErr) throw dailyErr

    // Stage 0-2: work_logs.actual_start_time를 daily.checked_in_at과 symmetric하게 갱신.
    // checkedInAtIso가 null이면 SoT도 null (출근 안 한 상태로 되돌림).
    if (workLogId) {
      await adminClient
        .from('work_logs')
        .update({ actual_start_time: actualCheckInTime ?? null })
        .eq('id', workLogId)
    }

    // ─── submissions 로그 ─────────────────────────────────────────────────
    // report_type 분기:
    //   - 신규 INSERT          → 'check_in'
    //   - 예정값 변경 (기존 row UPDATE + 예정 다름)  → 'check_in_update'
    //   - 실제출근만 변경                            → 'check_in_complete'
    //   - 둘 다 변경 시 → 두 행 모두 기록
    if (willCreateNewLog) {
      await recordSubmission({
        user_id: user.id,
        user_email: user.email!,
        name,
        division: profile?.division ?? null,
        team:     profile?.team ?? null,
        report_type: 'check_in',
        target_date: date,
        submitted_at: submissionNow,
        work_log_id: workLogId,
        start_time:      startTime,
        end_time:        endTime,
        work_location:   workLocation,
        work_location_timeline: timeline ?? null,
        leave_timeline:         leaveTimeline ?? null,
        planned_work_locations: plannedLocations ?? null,
        work_type_label: '기본근무 등록',
        work_type_code:  calcResult.workTypeCode,
        attendance_record_type: '출근보고 진행 (주말출근, 휴가 포함)',
      })
    } else {
      if (plannedChanged) {
        await recordSubmission({
          user_id: user.id,
          user_email: user.email!,
          name,
          division: profile?.division ?? null,
          team:     profile?.team ?? null,
          report_type: 'check_in_update',
          target_date: date,
          submitted_at: submissionNow,
          work_log_id: workLogId,
          start_time:      startTime,
          end_time:        endTime,
          work_location:   workLocation,
          work_location_timeline: timeline ?? null,
          leave_timeline:         leaveTimeline ?? null,
          planned_work_locations: plannedLocations ?? null,
          work_type_label: '기본근무 등록',
          work_type_code:  calcResult.workTypeCode,
          attendance_record_type: '출근보고 진행 (주말출근, 휴가 포함)',
        })
      }
      if (checkedInChanged) {
        await recordSubmission({
          user_id: user.id,
          user_email: user.email!,
          name,
          division: profile?.division ?? null,
          team:     profile?.team ?? null,
          report_type: 'check_in_complete',
          target_date: date,
          submitted_at: submissionNow,
          work_log_id: workLogId,
          start_time:      actualCheckInTime,
          work_location:   currentLocation,
          attendance_record_type: '출근보고 진행 (주말출근, 휴가 포함)',
        })
      }
    }

    await adminClient
      .from('user_profiles')
      .update({ last_submitted_at: submissionNow })
      .eq('email', user.email!)

    await adminClient.from('work_status_events').insert({
      work_date:       date,
      user_email:      user.email!,
      user_profile_id: profile?.id ?? null,
      work_log_id:     workLogId,
      event_type:      willCreateNewLog
        ? 'report_created_from_check_in'
        : (checkedInChanged ? 'check_in_complete' : 'check_in_update'),
      event_value:     {
        location: currentLocation,
        actual_check_in_at: checkedInAtIso,
        planned_changed: plannedChanged,
        checked_in_changed: checkedInChanged,
      },
      event_at:        submissionNow,
      created_by:      user.email!,
    })

    // Teams 알림은 실제 출근(check_in_complete) 시에만 — 단순 보고만 작성한 경우 알림 X
    // 2026-05-19 v1.21: await — fire-and-forget 시 Vercel function 종료로 promise 끊김.
    if (checkedInAtIso) {
      await notifyCheckinSubmitted({
        name: profile?.display_name || body.name || user.email!,
        date,
        checkedInAt: checkedInAtIso,
        workLocation: currentLocation,
        timeline: timeline ?? undefined,
        plannedWorkLocations: plannedLocations ?? undefined,
        leaveTimeline: leaveTimeline ?? undefined,
        // v1.27: 알림 헤드라인 'start~end' 표시용. 미보고 토글 ON이면 출근예정만 NULL.
        // v1.55 hotfix (2026-05-27): expectedEndTime은 미보고와 무관 — 퇴근예정시간은
        // form에서 받아 DB의 planned_end_time에도 정상 저장 중. 알림에서만 NULL로 보내
        // 메시지 빌더가 퇴근예정 라인을 skip하던 버그 fix (당일 미보고 첫 출근 케이스).
        expectedStartTime: plannedStartUnreported ? null : startTime,
        expectedEndTime:   endTime,
        workContent: workContent || null,
        division: profile?.division ?? null,
        // 본부 직속(team 없음) → admin 지정 notify_team으로 라우팅
        team: resolveRoutingTeam(profile?.team, profile?.notify_team) || null,
      })
    }

    // v1.50 (2026-05-27) — 사전등록 알림 (당일 첫 출근보고 / 미래 일자 사전등록).
    // 본부 `notify_on_advance_checkin=true` 일 때만 발송. willCreateNewLog=true 일 때
    // (planned_* 첫 등록). 출근완료 알림과 별개로 둘 다 발송 (정책 P1).
    if (willCreateNewLog && !plannedStartUnreported) {
      await maybeNotifyAdvanceCheckin({
        adminClient,
        userEmail: (user.email ?? '').toLowerCase(),
        userName: profile?.display_name || body.name || user.email!,
        division: profile?.division ?? null,
        team: profile?.team ?? null,
        notifyTeam: profile?.notify_team ?? null,
        leaveDate: date,
        plannedStart: startTime,
        plannedEnd: endTime,
        plannedLocation: currentLocation,
        memo: workContent || null,
      })
    }

    return NextResponse.json(daily)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[/api/team-status/check-in]', message)
    // 사용자 입력 검증 실패는 그대로 노출 (400). 그 외만 일반 500.
    const isUserError =
      message.includes('실근무시간이 음수') ||
      message.includes('지원하지 않는 근무유형') ||
      message.includes('잘못된 시간 형식') ||
      message.includes('잘못된 날짜 형식')
    if (isUserError) {
      return NextResponse.json({ error: message }, { status: 400 })
    }
    return NextResponse.json({ error: '서버 에러가 발생했습니다.' }, { status: 500 })
  }
}
