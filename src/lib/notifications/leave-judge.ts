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
    // v1.83.3 — lookup의 leaveType은 이미 출처별 적절히 분류됨:
    //   · Google 종일 박스: decideLeaveType이 parseLeaveLabel 적용 (반차 텍스트 → morning_half 등)
    //   · Google 시간 박스: 시간 기반 (hourly / full_day-by-duration)
    //   · 시트: parseCell이 텍스트 기반
    // 추가 라벨 override 불필요. lookup 결과 그대로 신뢰.
    return {
      leaveType: cal.leaveType,
      leaveLabel: cal.leaveLabel ?? '휴가',
    }
  }

  return { leaveType: null, leaveLabel: null }
}

export function isOnFullDayLeave(args: Parameters<typeof judgeLeave>[0]): boolean {
  return judgeLeave(args).leaveType === 'full_day'
}
