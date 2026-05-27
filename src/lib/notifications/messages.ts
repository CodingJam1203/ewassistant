/**
 * Teams message builder
 * All message formatting logic lives here.
 * Server-only (uses process.env)
 */

import type {
  EventType,
  WorklogNotifyPayload,
  WorklogUpdateNotifyPayload,
  WorklogDeletedNotifyPayload,
  CheckinNotifyPayload,
  LocationChangedNotifyPayload,
  BreakNotifyPayload,
  AccountPendingNotifyPayload,
  DailyCheckinReminderData,
  MissingReportNudgePayload,
  MorningSummaryData,
} from './types'
import { formatTimelineForTeams, getWorkLocations } from '@/lib/work-location-timeline'
import { formatChipsArrow, normalizeWorkLocations, chipLabel } from '@/lib/work-locations-v2'
import {
  formatLeaveLines,
  isFullDayLeave,
  minutesToDisplay,
  totalLeaveRoundedMinutes,
} from '@/lib/leave-timeline'

// ─── helpers ─────────────────────────────────────────────────────────────────

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토']

/** YYYY-MM-DD -> "2026/05/04(월)" — KST 기준 (서버 timezone 무관) */
export function koreanDate(dateStr: string): string {
  const m = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return dateStr
  const yyyy = m[1]
  const mm = m[2]
  const dd = m[3]
  // UTC 정오로 Date 객체 만들어서 어떤 timezone에서도 같은 날짜 결과 보장
  const d = new Date(Date.UTC(parseInt(yyyy, 10), parseInt(mm, 10) - 1, parseInt(dd, 10), 12, 0, 0))
  const w = WEEKDAYS[d.getUTCDay()]
  return `${yyyy}/${mm}/${dd}(${w})`
}

/** YYYY-MM-DD -> "5/4(월)" — KST 기준 (서버 timezone 무관) */
function shortKoreanDate(dateStr: string): string {
  const m = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return dateStr
  const mo = parseInt(m[2], 10)
  const day = parseInt(m[3], 10)
  const d = new Date(Date.UTC(parseInt(m[1], 10), mo - 1, day, 12, 0, 0))
  const w = WEEKDAYS[d.getUTCDay()]
  return `${mo}/${day}(${w})`
}

/** ISO string -> KST HH:mm, 앞 0 유지 (MY PAGE trimToHHmm 정책 일치): "09:30" -> "09:30" */
function kstHHmm(iso: string): string {
  const d = new Date(iso)
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000)
  const h = String(kst.getUTCHours()).padStart(2, '0')
  const m = String(kst.getUTCMinutes()).padStart(2, '0')
  return `${h}:${m}`
}

/**
 * "09:30:00" / "09:30" -> "09:30" (앞 0 유지 — MY PAGE trimToHHmm 정책과 일치)
 * "24:30" -> "(명일) 00:30" (새벽까지 근무 케이스)
 * "30:00" -> "(명일) 06:00"
 */
export function fmtTime(timeStr: string): string {
  if (!timeStr) return ''
  const parts = timeStr.split(':')
  const rawH = parseInt(parts[0], 10)
  const m = (parts[1] ?? '00').padStart(2, '0')
  if (Number.isFinite(rawH) && rawH >= 24) {
    return `(명일) ${String(rawH - 24).padStart(2, '0')}:${m}`
  }
  return `${String(rawH).padStart(2, '0')}:${m}`
}

/** "01:30:00" or "01:30" -> "01:30" (keep leading zero for break display) */
export function fmtBreak(timeStr: string): string {
  if (!timeStr) return '00:00'
  const parts = timeStr.split(':')
  return `${parts[0].padStart(2, '0')}:${(parts[1] ?? '00').padStart(2, '0')}`
}

/** CTA footer line — 다중 env fallback (NCLICK_APP_URL은 legacy, APP_URL/NEXT_PUBLIC_APP_URL 권장) */
function cta(): string {
  const url =
    process.env.NCLICK_APP_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.APP_URL ||
    ''
  return url ? `[👉 N-Click 바로가기](${url})` : '👉 N-Click 바로가기'
}

// ─── worklog body (submit) ────────────────────────────────────────────────────

function worklogBody(prefix: string, p: WorklogNotifyPayload): string {
  const lateStatus = p.lateOrAttendanceStatus === '예' ? '예' : '아니오'
  const prevTime   = p.previousReportTime ? fmtTime(p.previousReportTime) : ''
  const currTime   = p.currentReportTime
    ? fmtTime(p.currentReportTime)
    : (p.lateReason ?? '')
  const lateStr = `${lateStatus} / ${prevTime} / ${currTime}`

  const checkinLines = buildNextCheckinLines(p)
  const leaveLines = buildLeaveLines(p.leaveTimeline)
  const workLocationLines = buildWorkLocationLines(p)
  const breakLine = buildBreakLine(p)
  const leaveTimeLine = buildLeaveTimeLine(p.leaveTimeline)
  const actualWorkLine = buildActualWorkLine(p)

  return [
    `${prefix} / ${p.leaveDate}`,
    `🔹근무유형 : ${p.workTypeLabel || '미입력'}`,
    ...leaveLines,
    ...workLocationLines,
    `🔹근무시간 : ${fmtTime(p.startTime)} ~ ${fmtTime(p.endTime)}`,
    breakLine,
    ...(leaveTimeLine ? [leaveTimeLine] : []),
    ...(actualWorkLine ? [actualWorkLine] : []),
    `🔹지각/당일 수정 : ${lateStr}`,
    `🔹근무내용 : ${p.workContent || '미입력'}`,
    ...checkinLines,
    '🧡',
    cta(),
  ].join('\n')
}

/** 본문 휴가/반차 라인 */
function buildLeaveLines(timeline: WorklogNotifyPayload['leaveTimeline']): string[] {
  const lines = formatLeaveLines(timeline ?? null)
  if (lines.length === 0) return []
  if (lines.length === 1) return [`🔹휴가/반차 : ${lines[0]}`]
  // 거의 없겠지만 여러 항목 시 멀티라인
  return ['🔹휴가/반차', ...lines.map((l, i) => `${i + 1}. ${l}`)]
}

/**
 * 휴게시간 라인 — 사용자 입력 K값 그대로 표시 (= 점심 외 추가 휴게).
 * 점심 1h는 워크타입 기반 자동이라 메시지에 명시 안 함.
 */
function buildBreakLine(p: WorklogNotifyPayload): string {
  const finalMin = p.breakFinalRoundedMinutes
  if (typeof finalMin === 'number' && finalMin >= 0) {
    const display = minutesToDisplay(finalMin)
    return p.breakIsManual
      ? `🔹휴게시간 : ${display} (수정)`
      : `🔹휴게시간 : ${display}`
  }
  // legacy fallback: breakTime
  const breakStr = fmtBreak(p.breakTime)
  const breakHM  = fmtTime(breakStr)
  return `🔹휴게시간 : ${breakHM} / 휴게`
}

/** 휴가시간 라인 — 휴가가 있을 때만 */
function buildLeaveTimeLine(timeline: WorklogNotifyPayload['leaveTimeline']): string | null {
  const total = totalLeaveRoundedMinutes(timeline ?? null)
  if (total <= 0) return null
  return `🔹휴가시간 : ${minutesToDisplay(total)}`
}

/** 실근무시간 라인 (계산 결과가 들어왔을 때만) */
function buildActualWorkLine(p: WorklogNotifyPayload): string | null {
  if (typeof p.actualWorkMinutes !== 'number') return null
  return `🔹실근무시간 : ${minutesToDisplay(Math.max(0, p.actualWorkMinutes))}`
}

/**
 * 본문 근무장소 라인 빌드 (v2 chips 우선)
 * - actualWorkLocations 있으면 칩 → "사무실 → 외근 → 재택" 한 줄
 * - 없으면 timeline 사용 (legacy 호환)
 * - 둘 다 없으면 단일 문자열 fallback
 */
function buildWorkLocationLines(p: WorklogNotifyPayload): string[] {
  // v2 chips 우선
  const chips = normalizeWorkLocations(p.actualWorkLocations)
  if (chips && chips.length > 0) {
    return [`🔹근무장소 : ${formatChipsArrow(chips)}`]
  }
  // legacy timeline fallback
  const tl = p.workLocationTimeline
  const wlCount = tl ? getWorkLocations(tl).length : 0
  if (tl && wlCount >= 2) {
    const formatted = formatTimelineForTeams(tl)
    return ['🔹근무장소', ...formatted.lines]
  }
  if (tl && wlCount === 1) {
    const formatted = formatTimelineForTeams(tl)
    return [`🔹근무장소 : ${formatted.lines[0]}`]
  }
  return [`🔹근무장소 : ${p.workLocation || '미입력'}`]
}

/**
 * 출근보고 라인 생성
 * - 미작성: ['🕛 출근보고 : 미작성']
 * - 단일 (timeline 1 work_location 또는 legacy fields): ['🕛 출근보고 : 2026-05-06 / 사무실 09:00~18:00']
 * - 멀티 (timeline 2+ work_location): ['🕛 출근보고 : 2026-05-06', '1. 사무실 09:00~', '2. 재택 14:00~', '3. 퇴근예정 18:00']
 */
function buildNextCheckinLines(p: WorklogNotifyPayload): string[] {
  if (
    p.attendanceRecordType !== '출근보고 진행 (주말출근, 휴가 포함)' ||
    !p.expectedStartDate
  ) {
    return ['🕛 출근보고 : 미작성']
  }

  // v2 chips 우선
  const chips = normalizeWorkLocations(p.plannedWorkLocations)
  const st = p.expectedWorkTime ? fmtTime(p.expectedWorkTime) : '???'
  if (chips && chips.length > 0) {
    return [`🕛 출근보고 : ${p.expectedStartDate} / ${formatChipsArrow(chips)} ${st}~`]
  }

  // legacy timeline fallback
  const timeline = p.expectedTimeline
  const wlCount = timeline ? getWorkLocations(timeline).length : 0

  if (timeline && wlCount >= 2) {
    const formatted = formatTimelineForTeams(timeline)
    return [
      `🕛 출근보고 : ${p.expectedStartDate}`,
      ...formatted.lines,
    ]
  }

  if (timeline && wlCount === 1) {
    const formatted = formatTimelineForTeams(timeline)
    return [`🕛 출근보고 : ${p.expectedStartDate} / ${formatted.lines[0]}`]
  }

  // legacy 단일 fallback
  const loc = p.expectedWorkLocation || '미입력'
  return [`🕛 출근보고 : ${p.expectedStartDate} / ${loc} ${st}~???`]
}

// ─── cron helpers (also used by cron routes) ─────────────────────────────────

/** Nightly reminder (20h/22h) checkin status */
export function formatNightlyCheckinStatus(
  checkin: { expected_work_location: string | null; expected_work_time: string | null; expected_end_time?: string | null } | undefined
): string {
  if (!checkin) return '❌'
  const loc = checkin.expected_work_location || '미입력'
  const st  = checkin.expected_work_time ? fmtTime(checkin.expected_work_time) : '???'
  const et  = checkin.expected_end_time ? fmtTime(checkin.expected_end_time) : '???'
  return `${loc} ${st}~${et}`
}

/** Morning summary checkin status — 'HH:mm~HH:mm' 형태. end가 NULL이면 'HH:mm~'로 fallback */
export function formatMorningCheckinStatus(
  checkin: { expected_work_location: string | null; expected_work_time: string | null; expected_end_time?: string | null } | undefined
): string {
  if (!checkin) return '❌'
  const loc = checkin.expected_work_location || '미입력'
  const st  = checkin.expected_work_time ? fmtTime(checkin.expected_work_time) : ''
  const et  = checkin.expected_end_time   ? fmtTime(checkin.expected_end_time)   : ''
  if (st && et) return `${loc} ${st}~${et}`
  if (st)       return `${loc} ${st}~`
  return loc
}

/** Morning summary worklog status — 정책서 §2 SoT(actual_*) 우선, NULL이면 ❌ */
export function formatMorningWorklogStatus(
  log: { start_time: string | null; end_time: string | null; break_time: string; work_location: string } | undefined
): string {
  if (!log) return '❌'
  if (!log.start_time || !log.end_time) return '❌'
  const start    = fmtTime(log.start_time)
  const end      = fmtTime(log.end_time)
  const breakStr = fmtBreak(log.break_time)
  const loc      = log.work_location || '미입력'
  return `${start}~${end} (${breakStr}) ${loc}`
}

// ─── message builder ──────────────────────────────────────────────────────────

export function buildMessage(eventType: EventType, payload: unknown): string {
  switch (eventType) {

    case 'worklog_submitted': {
      const p = payload as WorklogNotifyPayload
      const allDay = isFullDayLeave(p.leaveTimeline ?? null)
      const prefix = allDay ? `🍀${p.name} 휴가!` : `🍀${p.name} 퇴근!`
      return worklogBody(prefix, p)
    }

    case 'checkout_resubmitted': {
      const p = payload as WorklogNotifyPayload
      const allDay = isFullDayLeave(p.leaveTimeline ?? null)
      const prefix = allDay
        ? `📌 ${p.name} 휴가 보고 재제출`
        : `📌 ${p.name} 퇴근보고 재제출`
      return worklogBody(prefix, p)
    }

    case 'worklog_updated': {
      // @deprecated — 신규 코드는 worklog_updated_checkin / _checkout 사용
      const p = payload as WorklogUpdateNotifyPayload
      const reportLabel = p.originalReportType === '출근보고' ? '출근보고' : '퇴근보고'
      const header = `[수정] ${p.name} ${reportLabel} 수정 / ${koreanDate(p.leaveDate)}`

      const fixedRows = [
        `출근 예정 날짜: ${p.scheduledWorkDate || '미입력'}`,
        `출근 예정 시간: ${p.scheduledWorkTime ? fmtTime(p.scheduledWorkTime) : '미입력'}`
      ].join('\n')

      const changedRows = p.changedFields.map(f => `${f.label}: ${f.before} → ${f.after}`).join('\n')
      const footer = `수정자: ${p.updatedByName}`

      return [header, fixedRows, changedRows, footer, cta()].filter(Boolean).join('\n')
    }

    case 'worklog_updated_checkin': {
      // 출근보고(=expected_*) 영역 수정 → 출근보고 채널 발송
      const p = payload as WorklogUpdateNotifyPayload
      const targetDate = p.scheduledWorkDate ? koreanDate(p.scheduledWorkDate) : koreanDate(p.leaveDate)
      const header = `📝 ${p.name} 출근보고 수정 / ${targetDate}`
      const changedRows = p.changedFields.map(f => `🔹${f.label} : ${f.before} → ${f.after}`).join('\n')
      const footer = `수정자: ${p.updatedByName}`
      return [header, changedRows, footer, cta()].filter(Boolean).join('\n')
    }

    case 'worklog_updated_checkout': {
      // 퇴근보고 영역 수정 → 퇴근보고 채널 발송
      const p = payload as WorklogUpdateNotifyPayload
      const header = `📝 ${p.name} 퇴근보고 수정 / ${koreanDate(p.leaveDate)}`
      const changedRows = p.changedFields.map(f => `🔹${f.label} : ${f.before} → ${f.after}`).join('\n')
      const footer = `수정자: ${p.updatedByName}`
      return [header, changedRows, footer, cta()].filter(Boolean).join('\n')
    }

    case 'worklog_deleted': {
      const p = payload as WorklogDeletedNotifyPayload
      // scope partial delete — 같은 row의 다른 영역은 보존됨을 명시.
      if (p.scope === 'check_in') {
        return [
          `🗑️${p.name} 출근보고 삭제 / ${p.leaveDate}`,
          `🔹삭제자 : ${p.deletedByName}`,
          `🔹같은 날 퇴근보고는 유지됩니다`,
          cta(),
        ].join('\n')
      }
      if (p.scope === 'check_out') {
        const breakHM = fmtTime(fmtBreak(p.breakTime))
        return [
          `🗑️${p.name} 퇴근보고 삭제 / ${p.leaveDate}`,
          `🔹삭제자 : ${p.deletedByName}`,
          `🔹근무유형 : ${p.workTypeLabel || '미입력'}`,
          `🔹근무장소 : ${p.workLocation || '미입력'}`,
          `🔹근무시간 : ${fmtTime(p.startTime)} ~ ${fmtTime(p.endTime)}`,
          `🔹휴게시간 : ${breakHM} / 휴게`,
          `🔹근무내용 : ${p.workContent || '미입력'}`,
          `🔹같은 날 출근보고는 유지됩니다`,
          cta(),
        ].join('\n')
      }
      // scope 없음 — row 전체 삭제 (기존 메시지 그대로)
      const breakHM = fmtTime(fmtBreak(p.breakTime))
      return [
        `🗑️${p.name} 기록 삭제 / ${p.leaveDate}`,
        `🔹삭제자 : ${p.deletedByName}`,
        `🔹근무유형 : ${p.workTypeLabel || '미입력'}`,
        `🔹근무장소 : ${p.workLocation || '미입력'}`,
        `🔹근무시간 : ${fmtTime(p.startTime)} ~ ${fmtTime(p.endTime)}`,
        `🔹휴게시간 : ${breakHM} / 휴게`,
        `🔹근무내용 : ${p.workContent || '미입력'}`,
        cta(),
      ].join('\n')
    }

    case 'checkin_submitted': {
      const p = payload as CheckinNotifyPayload
      const allDay = isFullDayLeave(p.leaveTimeline ?? null)
      const leaveLines = formatLeaveLines(p.leaveTimeline ?? null)

      // 종일 휴가 — 출근이 아니라 휴가 알림
      if (allDay) {
        return [
          `🍀${p.name} 휴가! / ${koreanDate(p.date)}`,
          ...(leaveLines.length === 1
              ? [`🔹휴가/반차 : ${leaveLines[0]}`]
              : ['🔹휴가/반차', ...leaveLines]),
          cta(),
        ].join('\n')
      }

      // v2 chips 우선
      const chips = normalizeWorkLocations(p.plannedWorkLocations)
      const lines: string[] = []
      // v1.32: 실제출근시간(checkedInAt) 우선 → 없을 때만 expectedStartTime fallback.
      // 이 알림은 route에서 checkedInAtIso가 있을 때만 발송되므로 실제출근시간이 항상 존재 →
      // 헤드라인 '근무시작 {실제출근}~{퇴근예정}'. end = expectedEndTime (있을 때만 ~end 추가)
      const startStr = p.checkedInAt ? kstHHmm(p.checkedInAt) : (p.expectedStartTime ? fmtTime(p.expectedStartTime) : '')
      const endStr   = p.expectedEndTime   ? fmtTime(p.expectedEndTime)   : ''
      const timeStr  = endStr ? `근무시작 ${startStr}~${endStr}` : `${startStr} 출근`
      lines.push(`${p.name} : ${shortKoreanDate(p.date)} ${timeStr}`)
      if (p.workContent && p.workContent.trim()) lines.push(`🔹메모 : ${p.workContent.trim()}`)
      if (leaveLines.length > 0) {
        lines.push(...(leaveLines.length === 1
            ? [`🔹휴가/반차 : ${leaveLines[0]}`]
            : ['🔹휴가/반차', ...leaveLines]))
      }
      if (chips && chips.length > 0) {
        lines.push(`🔹근무장소 : ${formatChipsArrow(chips)}`)
        lines.push(cta())
        return lines.join('\n')
      }

      // legacy timeline fallback
      const tl = p.timeline
      const hasMultiLoc = !!(tl && getWorkLocations(tl).length >= 2)
      if (hasMultiLoc && tl) {
        const formatted = formatTimelineForTeams(tl)
        lines.push('🔹근무장소', ...formatted.lines)
        lines.push(cta())
        return lines.join('\n')
      }
      if (leaveLines.length > 0) {
        lines.push(`🔹근무장소 : ${p.workLocation || '미입력'}`)
        lines.push(cta())
        return lines.join('\n')
      }
      // legacy 단일 라벨 fallback — 같은 start~end 정책 유지 (v1.32: 실제출근 우선)
      const startStrFb = p.checkedInAt ? kstHHmm(p.checkedInAt) : (p.expectedStartTime ? fmtTime(p.expectedStartTime) : '')
      const endStrFb   = p.expectedEndTime   ? fmtTime(p.expectedEndTime)   : ''
      const timeStrFb  = endStrFb ? `근무시작 ${startStrFb}~${endStrFb}` : `${startStrFb} 출근`
      const memoFb = p.workContent && p.workContent.trim() ? `\n🔹메모 : ${p.workContent.trim()}` : ''
      return `${p.name} : ${shortKoreanDate(p.date)} ${timeStrFb} ${p.workLocation || '미입력'}${memoFb}`
    }

    case 'location_changed': {
      const p = payload as LocationChangedNotifyPayload
      const chips = normalizeWorkLocations(p.actualWorkLocations)
      const current = (p.currentLabel ?? p.newLocation ?? '').trim()
      const idx = typeof p.currentIndex === 'number' ? p.currentIndex : null

      // chips 라인 — 현재 위치는 ★로 강조 (index 우선, 그 다음 라벨 첫 매칭)
      const chipsLine = (() => {
        if (!chips || chips.length === 0) return null
        const labelFirstMatch =
          idx === null && current
            ? chips.findIndex(c => chipLabel(c).trim() === current)
            : -1
        const parts = chips.map((c, i) => {
          const label = chipLabel(c)
          const isCurrent = idx !== null ? idx === i : labelFirstMatch === i
          return isCurrent ? `★ ${label}` : label
        })
        return parts.join(' → ')
      })()

      const baseLines = [
        `📍${p.name} 근무지 변경 / ${koreanDate(p.date)}`,
        `🔹이전 근무지 : ${p.previousLocation || '미입력'}`,
        `🔹현재 위치(★) : ${current || '미지정'}`,
        `🔹변경 시각 : ${kstHHmm(p.changedAt)}`,
      ]

      if (chipsLine) {
        return [
          ...baseLines,
          `🔹실제 근무장소 : ${chipsLine}`,
          cta(),
        ].join('\n')
      }

      // legacy timeline fallback
      const tl = p.timeline
      if (tl && getWorkLocations(tl).length >= 2) {
        const formatted = formatTimelineForTeams(tl)
        return [
          ...baseLines,
          '🔹근무장소 타임라인',
          ...formatted.lines,
          cta(),
        ].join('\n')
      }
      return [...baseLines, cta()].join('\n')
    }

    case 'break_started': {
      const p = payload as BreakNotifyPayload
      const startHHmm = kstHHmm(p.breakAt)
      // 휴게 시간 라인 — endPlanned 있으면 '시작~종료(예정)', 없으면 시작 시각만
      const timeLine = p.breakEndPlanned
        ? `🔹휴게 시간 : ${startHHmm}~${p.breakEndPlanned}(예정)`
        : `🔹휴게 시작 시각 : ${startHHmm}`
      const lines = [
        `☕${p.name} 휴게 시작 / ${koreanDate(p.date)}`,
        timeLine,
        `🔹근무지 : ${p.workLocation || '미입력'}`,
      ]
      // 메모는 빈 값이면 라인 자체 생략 (사용자 결정 2026-05-27 — 타이트한 표시)
      const memo = (p.memo ?? '').trim()
      if (memo) lines.push(`🔹메모 : ${memo}`)
      lines.push(cta())
      return lines.join('\n')
    }

    case 'break_ended': {
      const p = payload as BreakNotifyPayload
      const endHHmm = kstHHmm(p.breakAt)
      // 휴게 시간 라인 — breakStartedAt 있으면 '실제 시작~종료 (N분 경과, M분 차감 예정)',
      // 없으면 종료 시각만 (legacy fallback).
      let timeLine: string
      if (p.breakStartedAt) {
        const startHHmm = kstHHmm(p.breakStartedAt)
        const actual = typeof p.actualMinutes === 'number' ? p.actualMinutes : null
        const rounded = typeof p.roundedMinutes === 'number' ? p.roundedMinutes : null
        const suffix = (actual !== null && rounded !== null)
          ? ` (${actual}분 경과, ${rounded}분 차감 예정)`
          : ''
        timeLine = `🔹휴게 시간 : ${startHHmm}~${endHHmm}${suffix}`
      } else {
        timeLine = `🔹휴게 종료 시각 : ${endHHmm}`
      }
      const lines = [
        `🍵${p.name} 휴게 종료 / ${koreanDate(p.date)}`,
        timeLine,
        `🔹근무지 : ${p.workLocation || '미입력'}`,
      ]
      const memo = (p.memo ?? '').trim()
      if (memo) lines.push(`🔹메모 : ${memo}`)
      lines.push(cta())
      return lines.join('\n')
    }

    case 'account_pending': {
      const p = payload as AccountPendingNotifyPayload
      const kstTime = new Date(new Date(p.createdAt).getTime() + 9 * 60 * 60 * 1000)
      const dateStr = kstTime.toISOString().slice(0, 16).replace('T', ' ')
      return [
        '🔐 신규 계정 승인 필요',
        `🔹이름 : ${p.name || '미입력'}`,
        `🔹가입일시 : ${dateStr}`,
        `🔹상태 : 관리자 승인 대기`,
        '※ 상세 정보 및 승인은 관리자 페이지에서 확인해 주세요.',
        cta(),
      ].join('\n')
    }

    case 'daily_checkin_reminder_20':
    case 'daily_checkin_reminder_22': {
      const p = payload as DailyCheckinReminderData
      const isLate = eventType === 'daily_checkin_reminder_22'
      const teamLabel = `${p.team}`
      const headerEmoji = isLate ? '🌙' : '🕘'
      const header = `${headerEmoji} ${koreanDate(p.targetDate)} 출근보고 — ${teamLabel}`

      // 1줄 per member: ✅ 이름  장소 start~end  /  ⚠️ 이름  미보고
      const memberLines = p.members.map(m => {
        if (m.hasReport) {
          const loc = m.scheduledWorkLocation || '미입력'
          const st  = m.scheduledWorkTime    ? fmtTime(m.scheduledWorkTime)    : ''
          const et  = m.scheduledWorkEndTime ? fmtTime(m.scheduledWorkEndTime) : ''
          const range = st && et ? `${st}~${et}` : st ? `${st}~` : ''
          return `✅ ${m.name}  ${loc} ${range}`.trimEnd()
        }
        return `⚠️ ${m.name}  미보고`
      })

      // 통계 줄
      const reported = p.members.filter(m => m.hasReport).length
      const missing  = p.members.length - reported
      const statsLine = `(보고 ${reported} / 미보고 ${missing} / 총 ${p.members.length}명)`

      const sections: string[] = [header, '', ...memberLines, '', statsLine]

      // 22시 알림 — 내일 팀 캘린더 일정 추가
      if (isLate && p.calendarEvents && p.calendarEvents.length > 0) {
        sections.push('')
        sections.push(`📅 내일 일정`)
        for (const ev of p.calendarEvents) {
          const time =
            ev.startTime && ev.endTime
              ? `${ev.startTime}~${ev.endTime}`
              : ev.startTime
                ? `${ev.startTime}~`
                : '종일'
          sections.push(`- ${time}  ${ev.title}${ev.name ? `  (${ev.name})` : ''}`)
        }
      }

      sections.push('')
      sections.push(cta())
      return sections.join('\n')
    }

    case 'daily_morning_summary': {
      const p = payload as MorningSummaryData

      // 신규 섹션이 들어왔으면 새 템플릿, 아니면 기존 호환 템플릿
      const useNewTemplate = !!(p.leaveSection || p.completedSection || p.needSection || p.needAfterSection)

      if (!useNewTemplate) {
        // legacy
        const todayHeader = `🕘[ ${koreanDate(p.todayDate)} 출근 보고 ]`
        const todayRows   = p.todayCheckins.map(m => `🔹 ${m.name} : ${m.status}`).join('\n')
        const yestHeader  = `🕘[ ${koreanDate(p.yesterdayDate)} 퇴근 보고 ]`
        const yestRows    = p.yesterdayWorkLogs.map(m => `🔹 ${m.name} : ${m.status}`).join('\n')
        return [todayHeader, todayRows, yestHeader, yestRows, cta()].join('\n')
      }

      // ── 새 템플릿: 4섹션 + 어제 퇴근보고 요약 ─────────────────────────────────
      const lines: string[] = []
      lines.push(`🌅 ${koreanDate(p.todayDate)} 오늘의 근무 현황`)
      lines.push('')

      const leaveItems = p.leaveSection ?? []
      const completed = p.completedSection ?? []
      const need = p.needSection ?? []
      const needAfter = p.needAfterSection ?? []

      if (leaveItems.length > 0) {
        lines.push(`🏖️ 휴가/반차 (${leaveItems.length})`)
        for (const it of leaveItems) {
          lines.push(`- ${it.name}: ${it.label}`)
        }
        lines.push('')
      }

      if (completed.length > 0) {
        lines.push(`✅ 출근보고 완료 (${completed.length})`)
        for (const it of completed) {
          lines.push(`- ${it.name}: ${it.status}`)
        }
        lines.push('')
      }

      if (need.length > 0) {
        lines.push(`⚠️ 출근보고 필요 (${need.length})`)
        for (const it of need) {
          lines.push(`- ${it.name}`)
        }
        lines.push('')
      }

      if (needAfter.length > 0) {
        lines.push(`🕐 오후 출근보고 필요 (${needAfter.length}) — 오전반차 후 출근 예정`)
        for (const it of needAfter) {
          lines.push(`- ${it.name}: ${it.label}`)
        }
        lines.push('')
      }

      // 어제 퇴근보고 요약 (참고) — 야근(EW 실근무 > 8h, 480분 초과)은 ⚠️ 표식
      if (p.yesterdayWorkLogs.length > 0) {
        lines.push(`🕘 ${koreanDate(p.yesterdayDate)} 퇴근 보고`)
        for (const m of p.yesterdayWorkLogs) {
          const overtimeMark = m.isOvertime ? '  ⚠️ 야근' : ''
          lines.push(`- ${m.name}: ${m.status}${overtimeMark}`)
        }
        lines.push('')
      }

      lines.push(cta())
      // 빈 줄 정리 (연속 빈 줄 → 1개)
      const compact = lines.reduce<string[]>((acc, line) => {
        if (line === '' && acc[acc.length - 1] === '') return acc
        acc.push(line)
        return acc
      }, [])
      return compact.join('\n')
    }

    case 'missing_report_nudge': {
      const p = payload as MissingReportNudgePayload
      const what =
        p.missingType === 'missing_all' ? '출근/퇴근보고 미작성' : '퇴근보고 미작성'
      const action =
        p.missingType === 'missing_all'
          ? '출근/퇴근보고 작성 부탁드립니다.'
          : '퇴근보고 작성 부탁드립니다.'
      const lines: string[] = []
      lines.push(`📢 ${p.name}님, ${koreanDate(p.date)} ${what}`)
      lines.push('')
      lines.push(action)
      lines.push('')
      lines.push(cta())
      return lines.join('\n')
    }

    default:
      return ''
  }
}
