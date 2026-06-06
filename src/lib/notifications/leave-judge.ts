/**
 * 미보고/휴가 판정 공용 헬퍼.
 *
 * 3단 우선순위 체인:
 *   1) work_logs.leave_timeline    — 사용자가 직접 입력 (최우선)
 *   2) work_logs.expected_leave_timeline — 전일 작성한 사전 예약
 *   3) org_calendar_events / 시트 — 외부 캘린더 (가장 약한 신호)
 *
 * 어느 하나라도 hit하면 그 값 반환.
 *
 * 사용 위치 4곳:
 *   - reminder-20/22 — 내일 휴가자 leaveMap (캘린더 휴가 머지)
 *   - morning-summary — 오늘 출근 영역(이미 같은 우선순위), 어제 퇴근 영역(신규)
 *   - missing-reports — 미보고 후보 cells에 캘린더 휴가 주입
 */

import type { LeaveTimeline, LeaveType } from '@/types/leave-timeline'
import type { UserCalendarLookup } from '@/types/leave-calendar'
import { parseLeaveLabel } from '@/lib/leave-timeline'

export interface LeaveJudgment {
  leaveType: LeaveType | null
  leaveLabel: string | null
}

export function judgeLeave(args: {
  todayLeaveTimeline?: LeaveTimeline | null
  expectedLeaveTimeline?: LeaveTimeline | null
  calendarLookup?: UserCalendarLookup | null
}): LeaveJudgment {
  const today = args.todayLeaveTimeline?.[0]
  if (today) return { leaveType: today.leaveType, leaveLabel: today.label ?? null }

  const expected = args.expectedLeaveTimeline?.[0]
  if (expected) return { leaveType: expected.leaveType, leaveLabel: expected.label ?? null }

  const cal = args.calendarLookup
  if (cal?.leaveType) {
    // 라벨 텍스트에 specific 반차 키워드(반차/반반차)가 있을 때만 라벨 기반으로 override.
    // 단순 '휴가'/'연차' 등 full_day 키워드는 parseLeaveLabel이 무조건 full_day로 매핑하지만,
    // 시간 기반(decideLeaveType)이 morning_half/afternoon_half로 더 정확하므로 시간 결과 유지.
    // v1.83.2 (2026-06-06): 10:00~11:00 짧은 시간 휴가가 종일로 잘못 판정되던 버그 fix.
    const labelHint = (cal.leaveLabel ?? '').includes('반차')
      ? parseLeaveLabel(cal.leaveLabel ?? '')
      : null
    return {
      leaveType: labelHint ?? cal.leaveType,
      leaveLabel: cal.leaveLabel ?? '휴가',
    }
  }

  return { leaveType: null, leaveLabel: null }
}

export function isOnFullDayLeave(args: Parameters<typeof judgeLeave>[0]): boolean {
  return judgeLeave(args).leaveType === 'full_day'
}
