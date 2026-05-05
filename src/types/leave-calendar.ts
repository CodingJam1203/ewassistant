/**
 * 외부 휴가/일정 캘린더 타입
 *
 * Google Sheets에 본부별로 작성된 일정 시트를 N-Click이 읽어와서
 * 휴가 여부 판정 + 일반 일정 참고 표시에 사용한다.
 *
 * 연동 방식: Apps Script Web App (URL fetch, 일별 batch)
 *   - Apps Script는 한 번 호출에 두 본부 데이터를 모두 반환
 *   - N-Click은 결과를 leave_calendar_cache 테이블에 저장
 *   - TTL 5분, cron에서 강제 갱신
 *   - env(LEAVE_CALENDAR_WEBHOOK_URL) 미설정 시 호출 skip → graceful degradation
 */

import type { LeaveType } from './leave-timeline'

/** Apps Script가 반환하는 셀 단위 row */
export interface CalendarCellEntry {
  /** 시트의 사람 이름 (C열 trim 처리) */
  name: string
  /** 해당 날짜 셀의 원본 텍스트 */
  cellValue: string
}

/**
 * Apps Script Web App 응답 형식 (batched)
 *
 * 본부별로 분리해서 한 번에 반환. cache가 이 형식 그대로 저장됨.
 */
export interface CalendarBatchResponse {
  /** 요청 echo */
  date?: string
  /** 본부별 entries — 키: '본부명', 값: 사용자별 셀 row 배열 */
  departments: Record<string, CalendarCellEntry[]>
  /** 일부/전체 실패 시 (departments는 빈 객체 또는 부분 데이터) */
  error?: string
}

/** 셀 값 1건을 해석한 결과 */
export interface ParsedCalendarCell {
  /** 원본 셀 값 */
  raw: string
  /** 휴가 여부 — 키워드 포함 시 LeaveType, 아니면 null */
  leaveType: LeaveType | null
  /** 일반 일정 — 휴가가 있으면 빈 배열 */
  events: CalendarEventChunk[]
}

/** 일반 일정 단위 (1개 셀에 여러 개 가능) */
export interface CalendarEventChunk {
  /** 시작 시간 'HH:mm' (없으면 null = 종일/시간 미지정) */
  startTime: string | null
  /** 종료 시간 'HH:mm' (없으면 null) */
  endTime: string | null
  /** 일정 제목/설명 */
  title: string
}

/** 사용자 본인 일정 조회 결과 (CheckInModal/WorkLogForm 표시용) */
export interface UserCalendarLookup {
  /** 외부 캘린더 연동 활성화 여부 (env 셋업 시 true) */
  enabled: boolean
  /** 캐시/원본 조회 자체에 실패했는지 (true이면 events/leaveType은 보장 안 됨) */
  fetchFailed?: boolean
  /** 휴가 판정 (캘린더 셀 값 기반) */
  leaveType: LeaveType | null
  /** 휴가의 원본 라벨 (예: '연차', '오전반차') */
  leaveLabel: string | null
  /** 일반 일정 목록 (휴가 키워드 제외) */
  events: CalendarEventChunk[]
  /** 셀 원본 텍스트 (디버그용) */
  raw: string | null
}

/** leave_calendar_cache 테이블 row */
export interface LeaveCalendarCacheRow {
  key: string         // 'calendar:YYYY-MM-DD'
  data: CalendarBatchResponse
  updated_at: string  // ISO timestamp
}

/** 본부별 시트 config (N-Click에는 시트 ID/range 직접 안 두고 Apps Script에 위임) */
export const SUPPORTED_DEPARTMENTS = ['HR마케팅본부', 'HR임팩트본부'] as const
export type SupportedDepartment = typeof SUPPORTED_DEPARTMENTS[number]
