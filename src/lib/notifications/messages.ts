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
  MorningSummaryData,
} from './types'

// ─── helpers ─────────────────────────────────────────────────────────────────

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토']

/** YYYY-MM-DD -> "2026/05/04(월)" */
export function koreanDate(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00+09:00`)
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const w = WEEKDAYS[d.getDay()]
  return `${yyyy}/${mm}/${dd}(${w})`
}

/** YYYY-MM-DD -> "5/4(월)" */
function shortKoreanDate(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00+09:00`)
  const m = d.getMonth() + 1
  const day = d.getDate()
  const w = WEEKDAYS[d.getDay()]
  return `${m}/${day}(${w})`
}

/** ISO string -> KST HH:mm, leading zero stripped: "09:30" -> "9:30" */
function kstHHmm(iso: string): string {
  const d = new Date(iso)
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000)
  const h = kst.getUTCHours()
  const m = String(kst.getUTCMinutes()).padStart(2, '0')
  return `${h}:${m}`
}

/** "09:30" or "09:30:00" -> "9:30" (strip leading zero from hour) */
export function fmtTime(timeStr: string): string {
  if (!timeStr) return ''
  const parts = timeStr.split(':')
  const h = parseInt(parts[0], 10)
  const m = (parts[1] ?? '00').padStart(2, '0')
  return `${h}:${m}`
}

/** "01:30:00" or "01:30" -> "01:30" (keep leading zero for break display) */
export function fmtBreak(timeStr: string): string {
  if (!timeStr) return '00:00'
  const parts = timeStr.split(':')
  return `${parts[0].padStart(2, '0')}:${(parts[1] ?? '00').padStart(2, '0')}`
}

/** CTA footer line */
function cta(): string {
  const url = process.env.NCLICK_APP_URL
  return url ? `👉 N-Click 바로가기 : ${url}` : '👉 N-Click 바로가기'
}

// ─── worklog body (submit) ────────────────────────────────────────────────────

function worklogBody(prefix: string, p: WorklogNotifyPayload): string {
  const breakStr = fmtBreak(p.breakTime)
  const breakHM  = fmtTime(breakStr)
  const breakDisplay = `${breakHM} / 휴게`

  const lateStatus = p.lateOrAttendanceStatus === '예' ? '예' : '아니오'
  const prevTime   = p.previousReportTime ? fmtTime(p.previousReportTime) : ''
  const currTime   = p.currentReportTime
    ? fmtTime(p.currentReportTime)
    : (p.lateReason ?? '')
  const lateStr = `${lateStatus} / ${prevTime} / ${currTime}`

  let nextCheckin = '미작성'
  if (
    p.attendanceRecordType === '출근보고 진행 (주말출근, 휴가 포함)' &&
    p.expectedStartDate
  ) {
    const loc = p.expectedWorkLocation || '미입력'
    const st  = p.expectedWorkTime ? fmtTime(p.expectedWorkTime) : '???'
    nextCheckin = `${p.expectedStartDate} / ${loc} ${st}~???`
  }

  return [
    `${prefix} / ${p.leaveDate}`,
    `🔹근무유형 : ${p.workTypeLabel || '미입력'}`,
    `🔹근무장소 : ${p.workLocation || '미입력'}`,
    `🔹근무시간 : ${fmtTime(p.startTime)} ~ ${fmtTime(p.endTime)}`,
    `🔹휴게시간 : ${breakDisplay}`,
    `🔹지각/당일 수정 : ${lateStr}`,
    `🔹근무내용 : ${p.workContent || '미입력'}`,
    `🕛 출근보고 : ${nextCheckin}`,
    '🧡',
    cta(),
  ].join('\n')
}

// ─── cron helpers (also used by cron routes) ─────────────────────────────────

/** Nightly reminder (20h/22h) checkin status */
export function formatNightlyCheckinStatus(
  checkin: { expected_work_location: string | null; expected_work_time: string | null } | undefined
): string {
  if (!checkin) return '❌'
  const loc = checkin.expected_work_location || '미입력'
  const st  = checkin.expected_work_time ? fmtTime(checkin.expected_work_time) : '???'
  return `${loc} ${st}~???`
}

/** Morning summary checkin status */
export function formatMorningCheckinStatus(
  checkin: { expected_work_location: string | null; expected_work_time: string | null } | undefined
): string {
  if (!checkin) return '❌'
  const loc = checkin.expected_work_location || '미입력'
  const st  = checkin.expected_work_time ? fmtTime(checkin.expected_work_time) : ''
  return `${loc} ${st}~`
}

/** Morning summary worklog status */
export function formatMorningWorklogStatus(
  log: { start_time: string; end_time: string; break_time: string; work_location: string } | undefined
): string {
  if (!log) return '❌'
  const start    = fmtTime(log.start_time)
  const end      = fmtTime(log.end_time)
  const breakStr = fmtBreak(log.break_time)
  const loc      = log.work_location || '미입력'
  return `${start}~${end} (${breakStr}) ${loc}`
}

// ─── message builder ──────────────────────────────────────────────────────────

export function buildMessage(eventType: EventType, payload: unknown): string {
  switch (eventType) {

    case 'worklog_submitted':
      return worklogBody(`🍀${(payload as WorklogNotifyPayload).name} 퇴근!`, payload as WorklogNotifyPayload)

    case 'worklog_updated': {
      const p = payload as WorklogUpdateNotifyPayload
      const reportLabel = p.originalReportType === '출근보고' ? '출근보고' : '퇴근보고'
      const header = `[수정] ${p.name} ${reportLabel} 수정 / ${koreanDate(p.leaveDate)}`
      
      const fixedRows = [
        `출근 예정 날짜: ${p.scheduledWorkDate || '미입력'}`,
        `출근 예정 시간: ${p.scheduledWorkTime ? fmtTime(p.scheduledWorkTime) : '미입력'}`
      ].join('\n')

      const changedRows = p.changedFields.map(f => `${f.label}: ${f.before} → ${f.after}`).join('\n')
      const footer = `수정자: ${p.updatedByEmail}`
      
      return [header, fixedRows, changedRows, footer, cta()].filter(Boolean).join('\n')
    }

    case 'worklog_deleted': {
      const p = payload as WorklogDeletedNotifyPayload
      const breakHM = fmtTime(fmtBreak(p.breakTime))
      return [
        `🗑️${p.name} 기록 삭제 / ${p.leaveDate}`,
        `🔹삭제자 : ${p.deletedByEmail}`,
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
      return `${p.name} : ${shortKoreanDate(p.date)} ${kstHHmm(p.checkedInAt)} ${p.workLocation || '미입력'} 출근`
    }

    case 'location_changed': {
      const p = payload as LocationChangedNotifyPayload
      return [
        `📍${p.name} 근무지 변경 / ${p.date}`,
        `🔹이전 근무지 : ${p.previousLocation || '미입력'}`,
        `🔹변경 근무지 : ${p.newLocation || '미입력'}`,
        `🔹변경 시각 : ${kstHHmm(p.changedAt)}`,
        cta(),
      ].join('\n')
    }

    case 'break_started': {
      const p = payload as BreakNotifyPayload
      return [
        `☕${p.name} 휴게 시작 / ${p.date}`,
        `🔹휴게 시작 시각 : ${kstHHmm(p.breakAt)}`,
        `🔹근무지 : ${p.workLocation || '미입력'}`,
        cta(),
      ].join('\n')
    }

    case 'break_ended': {
      const p = payload as BreakNotifyPayload
      return [
        `🍵${p.name} 휴게 종료 / ${p.date}`,
        `🔹휴게 종료 시각 : ${kstHHmm(p.breakAt)}`,
        `🔹근무지 : ${p.workLocation || '미입력'}`,
        cta(),
      ].join('\n')
    }

    case 'account_pending': {
      const p = payload as AccountPendingNotifyPayload
      const kstTime = new Date(new Date(p.createdAt).getTime() + 9 * 60 * 60 * 1000)
      const dateStr = kstTime.toISOString().slice(0, 16).replace('T', ' ')
      return [
        '🔐 신규 계정 승인 필요',
        `🔹이름 : ${p.name || '미입력'}`,
        `🔹이메일 : ${p.email}`,
        `🔹가입일시 : ${dateStr}`,
        `🔹상태 : 관리자 승인 대기`,
        cta(),
      ].join('\n')
    }

    case 'daily_checkin_reminder_20':
    case 'daily_checkin_reminder_22': {
      const p = payload as DailyCheckinReminderData
      const header = `🕘[ ${koreanDate(p.targetDate)} 출근 보고 ]`
      const memberBlocks = p.members.map(m => {
        return [
          `🔹 ${m.name}`,
          `- 본부: ${m.division}`,
          `- 팀명: ${m.team}`,
          `- 출근 예정 날짜: ${m.scheduledWorkDate}`,
          `- 출근 예정 시간: ${fmtTime(m.scheduledWorkTime)}`,
          `- 출퇴근 예정 장소: ${m.scheduledWorkLocation}`,
          `- 출근기록 선택 유형: ${m.attendanceRecordType}`
        ].join('\n')
      }).join('\n\n')
      return [header, memberBlocks, cta()].join('\n\n')
    }

    case 'daily_morning_summary': {
      const p = payload as MorningSummaryData
      const todayHeader = `🕘[ ${koreanDate(p.todayDate)} 출근 보고 ]`
      const todayRows   = p.todayCheckins.map(m => `🔹 ${m.name} : ${m.status}`).join('\n')
      const yestHeader  = `🕘[ ${koreanDate(p.yesterdayDate)} 퇴근 보고 ]`
      const yestRows    = p.yesterdayWorkLogs.map(m => `🔹 ${m.name} : ${m.status}`).join('\n')
      return [todayHeader, todayRows, yestHeader, yestRows, cta()].join('\n')
    }

    default:
      return '[알 수 없는 이벤트]'
  }
}
