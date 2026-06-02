'use client'

/**
 * 제출 이력 테이블 — work_log_submissions 기반.
 *
 * 두 가지 모드:
 *   - mode='raw'   : 시간순 모든 제출 row (수정·재제출 누적)
 *   - mode='final' : 일자/사용자별 출근/퇴근 각각 최신 1건 (일자별 최종)
 *
 * 컬럼은 모든 셀을 RAW 그대로 펼침 — 가로 스크롤 허용.
 *
 * 스타일은 DESIGN.md 기준 — 색상은 디자인 토큰만, 컴포넌트는 ui/* 사용.
 */

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { ko } from 'date-fns/locale'

/** 'YYYY-MM-DD' → 한글 요일 1글자 ('월'~'일') */
function dowKo(dateStr: string): string {
  try { return format(parseISO(dateStr), 'eee', { locale: ko }) } catch { return '' }
}
import { Copy, Check, ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react'
import Pagination from '@/components/Pagination'
import {
  Badge,
  Button,
  FilterBar,
  Input,
  Select,
  TableContainer,
  TableScroll,
  Table,
  Th,
  Td,
  TR_HOVER,
  DateInputWithDow,
} from '@/components/ui'
import type { BadgeVariant } from '@/components/ui'
import { cn } from '@/lib/utils/cn'
import type { LeaveTimeline } from '@/types/leave-timeline'
import type { WorkLocations } from '@/types/work-locations-v2'
import { resolveDisplayLocations, formatChipsArrow } from '@/lib/work-locations-v2'
import {
  classifyWorkLog,
  pickLatestWorkLogPerDay,
} from '@/lib/work-logs/unified-times'

function CopyButton({ text }: { text: string | null }) {
  const [copied, setCopied] = useState(false)
  if (!text) return <span className="text-text-disabled">-</span>
  const handle = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      alert('복사 실패. 브라우저 권한을 확인해주세요.')
    }
  }
  return (
    <Button
      variant={copied ? 'secondary' : 'ghost'}
      size="sm"
      onClick={handle}
      className={cn('!h-7 !px-2 !text-[11px]', copied && '!text-success-text !bg-success-bg !border-success-border')}
      title="EW 복사 문구 복사"
    >
      {copied ? <Check className="h-3 w-3" aria-hidden /> : <Copy className="h-3 w-3" aria-hidden />}
      {copied ? '완료' : '복사'}
    </Button>
  )
}

export interface ChangedFieldRow {
  kind?: 'check_in' | 'check_out'
  label: string
  before: string
  after: string
}

export interface SubmissionRow {
  id: string
  user_email: string
  name: string | null
  division: string | null
  team: string | null

  report_type:
    | 'check_in' | 'check_out'
    | 'check_in_update' | 'check_out_update'
    | 'check_in_complete'
    | 'check_in_delete' | 'check_out_delete' | 'work_log_delete'
  target_date: string
  submitted_at: string

  work_log_id: string | null

  start_time: string | null
  end_time: string | null
  break_time: string | null
  actual_work_time: string | null
  work_location: string | null
  work_content: string | null
  ew_value: string | null
  copy_text: string | null
  late_or_attendance_status: string | null
  previous_report_time: string | null
  current_report_time: string | null
  late_reason: string | null
  break_reason: string | null

  expected_start_date: string | null
  expected_work_time: string | null
  expected_work_location: string | null
  /** 출근 timeline 마지막 항목(expected_checkout)에서 퇴근예정시각 추출용 */
  expected_work_location_timeline?: Array<{ kind?: string; startTime?: string }> | null
  /** 사전 보고 있는 상태에서 출근만 누른 경우 actual timeline (퇴근예정시각 fallback용) */
  work_location_timeline?: Array<{ kind?: string; startTime?: string }> | null
  /** v2: 실제 근무장소 칩 배열 (NULL = planned와 동일) */
  actual_work_locations?: WorkLocations | null
  /** v2: 예정 근무장소 칩 배열 */
  planned_work_locations?: WorkLocations | null

  /** 휴가/반차 타임라인 — 캘린더뷰 / CalendarDayDetailModal에서 사용. */
  leave_timeline?: LeaveTimeline | null
  /** 다음 출근 예정 휴가 타임라인 */
  expected_leave_timeline?: LeaveTimeline | null

  changed_fields: ChangedFieldRow[] | null

  work_type_label: string | null
  attendance_record_type: string | null
}

/** expected_work_location_timeline의 마지막 expected_checkout startTime → 퇴근예정시각 */
function extractExpectedCheckoutTime(
  tl: Array<{ kind?: string; startTime?: string }> | null | undefined
): string | null {
  if (!Array.isArray(tl) || tl.length === 0) return null
  const last = tl[tl.length - 1]
  if (last?.kind === 'expected_checkout' || last?.kind === 'checkout') {
    return last.startTime ?? null
  }
  return null
}

/**
 * 보고유형 필터 옵션 — 출근/퇴근 family 기준 (수정 row도 같은 family에 포함).
 *  - 'check_in'  : check_in + check_in_update
 *  - 'check_out' : check_out + check_out_update
 */
const REPORT_TYPE_OPTIONS: Array<{ value: '' | 'check_in' | 'check_out'; label: string }> = [
  { value: '',          label: '전체 보고유형' },
  { value: 'check_in',  label: '출근보고' },
  { value: 'check_out', label: '퇴근보고' },
]

function reportTypeLabel(t: SubmissionRow['report_type']): string {
  switch (t) {
    case 'check_in':          return '출근보고'
    case 'check_out':         return '퇴근보고'
    case 'check_in_update':   return '출근보고 수정'
    case 'check_out_update':  return '퇴근보고 수정'
    case 'check_in_complete': return '출근 완료'
    case 'check_in_delete':   return '출근보고 삭제'
    case 'check_out_delete':  return '퇴근보고 삭제'
    case 'work_log_delete':   return '전체 삭제'
  }
}

function reportTypeBadge(t: SubmissionRow['report_type']): BadgeVariant {
  switch (t) {
    case 'check_in':          return 'success'
    case 'check_out':         return 'info'
    case 'check_in_update':   return 'warning'
    case 'check_out_update':  return 'warning'
    case 'check_in_complete': return 'success'
    case 'check_in_delete':   return 'danger'
    case 'check_out_delete':  return 'danger'
    case 'work_log_delete':   return 'danger'
  }
}

function fmtTime(s: string | null): string {
  if (!s) return '-'
  if (s.includes(':')) return s.substring(0, 5)
  return s
}

function fmtInterval(s: string | null): string {
  if (!s) return '-'
  if (s.includes(':')) {
    const parts = s.split(':')
    return `${parts[0].padStart(2, '0')}:${parts[1].padStart(2, '0')}`
  }
  return s
}

// ─── 정렬 ─────────────────────────────────────────────────────────────────────
type SortKey =
  | 'report_type'
  | 'target_date'
  | 'submitted_at'
  | 'name'
  | 'start_time'
  | 'end_time'
  | 'break_time'
  | 'actual_work_time'
  | 'ew_value'
type SortDir = 'asc' | 'desc'

/** 정렬용 비교값 추출. 빈 값은 빈 문자열 (오름차순에서 맨 위 / 내림차순에서 맨 아래). */
function getSortValue(r: SubmissionRow, key: SortKey): string {
  switch (key) {
    case 'report_type':  return r.report_type
    case 'target_date':  return r.target_date
    case 'submitted_at': return r.submitted_at
    case 'name':         return r.name ?? ''
    case 'start_time': {
      const isCheckOut = r.report_type === 'check_out' || r.report_type === 'check_out_update'
      return (isCheckOut ? r.start_time : (r.start_time ?? r.expected_work_time)) ?? ''
    }
    case 'end_time': {
      const isCheckOut = r.report_type === 'check_out' || r.report_type === 'check_out_update'
      return (
        isCheckOut
          ? r.end_time
          : (r.end_time
              ?? extractExpectedCheckoutTime(r.work_location_timeline)
              ?? extractExpectedCheckoutTime(r.expected_work_location_timeline))
      ) ?? ''
    }
    case 'break_time':       return r.break_time ?? ''
    case 'actual_work_time': return r.actual_work_time ?? ''
    case 'ew_value':         return r.ew_value ?? ''
  }
}

// ─── Stage 0-4d: final mode 어댑터 ─────────────────────────────────────────
// final mode는 work_logs 단일 row 모델 — 한 (user, date)에 하나의 row.
// 컬럼 구조를 그대로 두기 위해 work_logs row를 SubmissionRow shape으로 어댑트한다.

/** /api/work-logs GET이 돌려주는 row 형태 (필요 필드만) */
interface WorkLogRow {
  id: string
  user_email: string
  name: string | null
  division: string | null
  team: string | null
  leave_date: string
  created_at: string
  updated_at: string | null
  planned_start_time: string | null
  planned_end_time: string | null
  actual_start_time: string | null
  actual_end_time: string | null
  // Stage 4: 서버 read-time 보정 결과 (출근완료 미사용 팀)
  effective_actual_start_time?: string | null
  start_time: string | null
  end_time: string | null
  break_time: string | null
  actual_work_time: string | null
  work_location: string | null
  work_content: string | null
  expected_work_location: string | null
  expected_work_time: string | null
  expected_start_date: string | null
  actual_work_locations: WorkLocations | null
  planned_work_locations: WorkLocations | null
  work_location_timeline: Array<{ kind?: string; startTime?: string }> | null
  expected_work_location_timeline: Array<{ kind?: string; startTime?: string }> | null
  expected_leave_timeline: LeaveTimeline | null
  leave_timeline: LeaveTimeline | null
  ew_value: string | null
  copy_text: string | null
  work_type_label: string | null
  attendance_record_type: string | null
  late_or_attendance_status: string | null
  previous_report_time: string | null
  current_report_time: string | null
  late_reason: string | null
  break_reason: string | null
}

/**
 * work_logs row → SubmissionRow 1~2건 어댑트.
 *
 * "단일 row" 의도 = work_logs 한 row가 SoT라는 것. 표시는 옛 동작처럼
 * 같은 날짜의 출근보고 + 퇴근보고 두 row로 펼친다.
 *
 * 출력:
 *   planned_only  → [출근보고]              (1건)
 *   check_in_done → [출근보고]              (1건 — 퇴근 미보고는 행 X)
 *   check_out_done→ [출근보고, 퇴근보고]      (2건)
 *   no_data       → [] (거의 발생 X)
 *
 * 시간:
 *   - 출근보고 row: planned_*_time (또는 legacy fallback)
 *   - 퇴근보고 row: actual_*_time
 */
function workLogToFinalRows(row: WorkLogRow): SubmissionRow[] {
  const state = classifyWorkLog(row)
  if (state === 'no_data') return []

  const base = {
    id: row.id,
    user_email: row.user_email,
    name: row.name,
    division: row.division,
    team: row.team,
    target_date: row.leave_date,
    submitted_at: row.updated_at ?? row.created_at,
    work_log_id: row.id,
    break_time: row.break_time,
    actual_work_time: row.actual_work_time,
    work_location: row.work_location,
    work_content: row.work_content,
    ew_value: row.ew_value,
    copy_text: row.copy_text,
    late_or_attendance_status: row.late_or_attendance_status,
    previous_report_time: row.previous_report_time,
    current_report_time: row.current_report_time,
    late_reason: row.late_reason,
    break_reason: row.break_reason,
    expected_start_date: row.expected_start_date,
    expected_work_time: row.expected_work_time,
    expected_work_location: row.expected_work_location,
    expected_work_location_timeline: row.expected_work_location_timeline,
    work_location_timeline: row.work_location_timeline,
    actual_work_locations: row.actual_work_locations,
    planned_work_locations: row.planned_work_locations,
    leave_timeline: row.leave_timeline,
    expected_leave_timeline: row.expected_leave_timeline,
    changed_fields: null,
    work_type_label: row.work_type_label,
    attendance_record_type: row.attendance_record_type,
  } satisfies Omit<SubmissionRow, 'report_type' | 'start_time' | 'end_time'>

  const out: SubmissionRow[] = []

  // 출근보고 row — 출근보고를 한 흔적이 있을 때만 (planned_*_time 중 하나라도 set).
  // 미보고+직접퇴근보고 케이스는 planned_*_time 둘 다 NULL이므로 생성 안 함
  // (legacy start_time/end_time이 actual로 채워져 있어도 출근보고 row로 위장하지 않음).
  if (row.planned_start_time !== null || row.planned_end_time !== null) {
    out.push({
      ...base,
      report_type: 'check_in',
      start_time: row.planned_start_time ?? row.start_time,
      end_time:   row.planned_end_time   ?? row.end_time,
    })
  }

  // 퇴근보고 row — 퇴근보고를 실제로 작성한 경우(check_out_done)만 노출.
  // check_in_done(출근완료 + 퇴근 미보고)은 퇴근보고가 아직 없으니 행 생성 X
  // (이전엔 actual_start_time 기준으로 행을 만들어서 end_time만 "-"로 비는 위장 행이 노출됨).
  if (state === 'check_out_done') {
    out.push({
      ...base,
      report_type: 'check_out',
      // Stage 5: effective_actual_start_time(서버 보정)이 있으면 그걸 우선
      start_time: row.effective_actual_start_time ?? row.actual_start_time,
      end_time:   row.actual_end_time,
    })
  }

  return out
}

export interface SubmissionsRawTableProps {
  endpoint?: string
  mine?: boolean
  extraQuery?: Record<string, string>
  /**
   * 수정 버튼 클릭 시 호출.
   *  - workLogId : 원본 work_logs.id
   *  - scope     : 'check_in' (출근보고 영역) / 'check_out' (퇴근보고 영역)
   *                row의 보고유형으로 자동 판정해서 전달됨.
   */
  onEditWorkLog?: (workLogId: string, scope: 'check_in' | 'check_out', cellDate?: string) => void
  allowOrgFilter?: boolean
  /**
   * 'raw'  : 모든 제출 row 시간순
   * 'final': 일자/사용자별 출근/퇴근 최신 1건
   */
  mode?: 'raw' | 'final'
}

export default function SubmissionsRawTable({
  endpoint = '/api/work-log-submissions',
  mine,
  extraQuery,
  onEditWorkLog,
  allowOrgFilter,
  mode = 'raw',
}: SubmissionsRawTableProps) {
  const [rows, setRows] = useState<SubmissionRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [reportType, setReportType] = useState<'' | 'check_in' | 'check_out'>('')
  const [updatedOnly, setUpdatedOnly] = useState(false)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [nameQuery, setNameQuery] = useState('')

  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)

  // 정렬 상태 — useReducer로 묶어 sortKey/sortDir이 항상 함께 정합한 상태로 업데이트되게.
  // (개별 useState로 두면 setSortKey + setSortDir 두 번 호출 시 중간 render에서 잠깐
  //  새 key + 옛 dir 조합이 노출되는 일이 드물게 있을 수 있고, key 비교용 closure가
  //  stale해질 수 있음.)
  type SortState = { key: SortKey; dir: SortDir }
  const [sortState, dispatchSort] = useReducer(
    (state: SortState, action: { key: SortKey }): SortState => {
      if (state.key === action.key) {
        return { key: state.key, dir: state.dir === 'asc' ? 'desc' : 'asc' }
      }
      return {
        key: action.key,
        // 날짜/시간 계열은 최신 우선 (desc), 그 외는 alphabetical 시작이라 asc 기본
        dir: action.key === 'submitted_at' || action.key === 'target_date' ? 'desc' : 'asc',
      }
    },
    { key: 'submitted_at' as SortKey, dir: 'desc' as SortDir },
  )
  const sortKey = sortState.key
  const sortDir = sortState.dir
  const toggleSort = useCallback((key: SortKey) => {
    dispatchSort({ key })
  }, [])

  // 이전 in-flight fetch 취소용. 빠른 타이핑(특히 한글 IME 합성 중)으로
  // 여러 fetch가 겹칠 때 오래된 응답이 새 응답을 덮어쓰는 race를 막는다.
  const abortRef = useRef<AbortController | null>(null)

  const fetchRows = async () => {
    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac

    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (mine) params.set('mine', 'true')
      if (mode === 'raw' && updatedOnly) {
        params.set('updated_only', 'true')
      }
      if (from) params.set('from', from)
      if (to)   params.set('to',   to)
      if (extraQuery) {
        for (const [k, v] of Object.entries(extraQuery)) {
          if (v) params.set(k, v)
        }
      }
      // mine 모드는 본인만이라 200건이면 충분 (페이지네이션은 25씩).
      // 조직 전체 조회는 더 많아질 수 있어 500.
      params.set('limit', mine ? '200' : '500')

      // Stage 0-4d: final mode는 work_logs 단일 row, raw mode는 work_log_submissions
      const isFinal = mode === 'final'
      const url = isFinal ? `/api/work-logs?${params}` : `${endpoint}?${params}`
      const res = await fetch(url, { signal: ac.signal })
      const json = await res.json()
      if (ac.signal.aborted) return
      if (!res.ok) {
        setError(json.error ?? '조회 실패')
        return
      }
      if (isFinal) {
        // /api/work-logs GET은 array 반환. (user, leave_date) 별로 latest 1건만 → 1~2 row 펼침.
        const logs = (Array.isArray(json) ? json : []) as WorkLogRow[]
        const latest = pickLatestWorkLogPerDay(logs)
        setRows(latest.flatMap(workLogToFinalRows))
      } else {
        setRows(json.rows ?? [])
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return
      setError(err instanceof Error ? err.message : '네트워크 오류')
    } finally {
      if (!ac.signal.aborted) setLoading(false)
    }
  }

  useEffect(() => { fetchRows() }, [reportType, updatedOnly, from, to, mine, mode, JSON.stringify(extraQuery)]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => abortRef.current?.abort(), [])

  const processedRows = useMemo(() => {
    // Stage 0-4d: final mode는 이미 어댑터에서 (user, date) 단일 row로 압축됨.
    // 추가 dedupe 불필요.
    let r = rows
    if (reportType) {
      r = r.filter(x => x.report_type.startsWith(reportType))
    }
    if (nameQuery) {
      const q = nameQuery.toLowerCase()
      r = r.filter(x => (x.name ?? '').toLowerCase().includes(q))
    }
    // 정렬 — 빈 값은 항상 맨 아래로.
    // Stage 8: 날짜/시각 컬럼은 ISO 문자열 그대로 비교 (localeCompare numeric 옵션의
    // 한국 로케일 quirk 회피). 동일 1차 키일 때 submitted_at desc로 안정적 2차 정렬.
    const isIsoLike = (s: string) => /^\d{4}-\d{2}-\d{2}/.test(s)
    const compareValues = (va: string, vb: string): number => {
      if (isIsoLike(va) && isIsoLike(vb)) {
        // ISO 8601 — 사전순 비교가 곧 시간순 비교
        return va < vb ? -1 : va > vb ? 1 : 0
      }
      return va.localeCompare(vb, 'ko', { numeric: true, sensitivity: 'base' })
    }
    const sorted = [...r].sort((a, b) => {
      const va = getSortValue(a, sortKey)
      const vb = getSortValue(b, sortKey)
      if (!va && !vb) {
        // 1차 키 동률 — submitted_at desc 보조 정렬 (최신 우선)
        if (a.submitted_at === b.submitted_at) return 0
        return a.submitted_at < b.submitted_at ? 1 : -1
      }
      if (!va) return 1
      if (!vb) return -1
      const cmp = compareValues(va, vb)
      if (cmp !== 0) return sortDir === 'asc' ? cmp : -cmp
      // 1차 키 동률 — submitted_at desc 보조 정렬
      if (a.submitted_at === b.submitted_at) return 0
      return a.submitted_at < b.submitted_at ? 1 : -1
    })
    return sorted
  }, [rows, mode, nameQuery, reportType, sortKey, sortDir])

  // 정렬 또는 데이터 길이 변경 시 1페이지로 리셋
  useEffect(() => { setPage(1) }, [processedRows.length, sortKey, sortDir])
  const pageStart = (page - 1) * pageSize
  const pagedRows = processedRows.slice(pageStart, pageStart + pageSize)

  return (
    <div className="space-y-3">
      {/* 필터 바 */}
      <FilterBar>
        <FilterBar.Field label="보고유형">
          <Select
            selectSize="sm"
            value={reportType}
            onChange={e => { setReportType(e.target.value as typeof reportType); setUpdatedOnly(false) }}
            className="min-w-[140px]"
          >
            {REPORT_TYPE_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </Select>
        </FilterBar.Field>

        {mode === 'raw' && (
          <FilterBar.Field label="수정 이력만">
            <label className="inline-flex items-center gap-2 h-9 px-3 rounded-[10px] border border-border-strong bg-surface cursor-pointer">
              <input
                type="checkbox"
                checked={updatedOnly}
                onChange={e => { setUpdatedOnly(e.target.checked); if (e.target.checked) setReportType('') }}
                className="h-4 w-4 rounded border-border-strong text-primary-600 focus:ring-primary-500"
              />
              <span className="text-[13px] text-text-primary">수정만 보기</span>
            </label>
          </FilterBar.Field>
        )}

        <FilterBar.Field label="대상일 시작">
          <DateInputWithDow size="sm" value={from} onChange={setFrom} className="min-w-[160px]" />
        </FilterBar.Field>
        <FilterBar.Field label="대상일 종료">
          <DateInputWithDow size="sm" value={to} onChange={setTo} className="min-w-[160px]" />
        </FilterBar.Field>

        {allowOrgFilter && (
          <FilterBar.Field label="이름 검색">
            <Input
              type="text"
              inputSize="sm"
              value={nameQuery}
              onChange={e => setNameQuery(e.target.value)}
              placeholder="이름 일부"
              className="w-36"
            />
          </FilterBar.Field>
        )}

        <div className="ml-auto self-end text-[12px] text-text-secondary tabular-nums">
          <span className="font-semibold text-text-primary">{processedRows.length}</span>
          {' 건 ('}
          {mode === 'final' ? '일자별 최종' : 'RAW 누적'}
          {')'}
        </div>
      </FilterBar>

      {error && (
        <div className="rounded-[10px] bg-danger-bg border border-danger-border p-3 text-[13px] text-danger-text">
          {error}
        </div>
      )}

      {loading ? (
        <div className="space-y-1">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-10 bg-surface-muted rounded-[10px] animate-pulse" />
          ))}
        </div>
      ) : processedRows.length === 0 ? (
        <div className="bg-surface rounded-2xl border border-border p-12 text-center text-sm text-text-muted">
          제출 이력이 없습니다.
        </div>
      ) : (
        <TableContainer>
          <TableScroll>
            <Table>
              <thead>
              <tr>
                <Th className="text-center">복사</Th>
                <SortableTh sortKey="report_type"     label="보고유형"  currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} />
                <SortableTh sortKey="target_date"     label="대상일"    currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} />
                <SortableTh sortKey="submitted_at"    label="제출일시"  currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} />
                <SortableTh sortKey="name"            label="이름"      currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} />
                <SortableTh sortKey="start_time"      label="시작"      currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} />
                <SortableTh sortKey="end_time"        label="종료"      currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} />
                <Th>장소</Th>
                <SortableTh sortKey="break_time"       label="휴게"      currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} />
                <SortableTh sortKey="actual_work_time" label="실근무"    currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} />
                <SortableTh sortKey="ew_value"         label="EW"        currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} />
                <Th>근무내용</Th>
                <Th>변경 필드</Th>
              </tr>
            </thead>
            <tbody>
              {pagedRows.map(r => {
                const isUpdate   = r.report_type.endsWith('_update')
                const isCheckOut = r.report_type === 'check_out' || r.report_type === 'check_out_update'
                const dash = <span className="text-text-disabled">-</span>

                const startVal = isCheckOut
                  ? fmtTime(r.start_time)
                  : fmtTime(r.start_time ?? r.expected_work_time)
                const endVal = isCheckOut
                  ? fmtTime(r.end_time)
                  : fmtTime(
                      r.end_time
                      ?? extractExpectedCheckoutTime(r.work_location_timeline)
                      ?? extractExpectedCheckoutTime(r.expected_work_location_timeline)
                    )
                const chips = resolveDisplayLocations({
                  actual: isCheckOut ? r.actual_work_locations : null,
                  planned: r.planned_work_locations,
                  legacyActualTimeline: isCheckOut ? (r.work_location_timeline as unknown as never) : null,
                  legacyExpectedTimeline: r.expected_work_location_timeline as unknown as never,
                  legacyWorkLocation: isCheckOut ? r.work_location : (r.work_location ?? r.expected_work_location),
                })
                const locVal = chips && chips.length > 0
                  ? formatChipsArrow(chips)
                  : (isCheckOut
                      ? (r.work_location ?? '-')
                      : (r.work_location ?? r.expected_work_location ?? '-'))

                return (
                  <tr key={`${r.id}__${r.report_type}`} className={TR_HOVER}>
                    <Td className="text-center">
                      {isCheckOut ? <CopyButton text={r.copy_text} /> : dash}
                    </Td>
                    <Td>
                      <Badge variant={reportTypeBadge(r.report_type)} className="!h-5 !px-2 !text-[10px]">
                        {reportTypeLabel(r.report_type)}
                      </Badge>
                    </Td>
                    <Td className="font-medium text-text-primary tabular-nums">
                      {r.target_date}
                      <span className="ml-1 text-[11px] text-text-muted">({dowKo(r.target_date)})</span>
                    </Td>
                    <Td className="text-text-muted tabular-nums">{format(new Date(r.submitted_at), 'MM/dd HH:mm')}</Td>
                    <Td>
                      <div className="text-text-primary">{r.name ?? '-'}</div>
                      <div className="text-[10px] text-text-muted">
                        {(r.division ?? '-') + ' / ' + (r.team ?? '-')}
                      </div>
                    </Td>
                    <Td numeric>{startVal}</Td>
                    <Td numeric>{endVal}</Td>
                    <Td>{locVal}</Td>
                    <Td numeric>{isCheckOut ? fmtInterval(r.break_time) : dash}</Td>
                    <Td numeric>{isCheckOut ? fmtInterval(r.actual_work_time) : dash}</Td>
                    <Td className="font-bold text-primary-600 tabular-nums">{isCheckOut ? (r.ew_value ?? '-') : dash}</Td>
                    <Td className="max-w-[220px] text-text-secondary relative group/wc">
                      <span className="block truncate">
                        {isCheckOut ? (r.work_content ?? '-') : dash}
                      </span>
                      {isCheckOut && r.work_content && (
                        <span
                          role="tooltip"
                          className={cn(
                            // hidden: 비-hover 상태에서는 DOM에서 렌더 안 됨 → 스크롤 영역 영향 0
                            'pointer-events-none hidden group-hover/wc:block',
                            'absolute z-30 top-full left-3 mt-1',
                            'w-[360px] max-w-[min(80vw,360px)]',
                            'rounded-[10px] border border-border bg-surface',
                            'text-[13px] leading-relaxed text-text-primary',
                            'p-3 shadow-[var(--shadow-popover)]',
                            'whitespace-pre-wrap break-words text-left',
                          )}
                        >
                          {r.work_content}
                        </span>
                      )}
                    </Td>
                    {/* 변경 필드는 여러 줄 ul이라 wrap 허용 */}
                    <Td wrap className="max-w-[280px]">
                           {isUpdate && r.changed_fields && r.changed_fields.length > 0 ? (
                        <ul className="space-y-0.5 list-none">
                          {r.changed_fields.map((cf, i) => (
                            <li key={i} className="text-[10px] text-text-secondary truncate">
                              <span className="font-semibold">{cf.label}:</span> {cf.before} → {cf.after}
                            </li>
                          ))}
                        </ul>
                      ) : dash}
                    </Td>
                  </tr>
                )
              })}
              </tbody>
            </Table>
          </TableScroll>
          <Pagination
            totalCount={processedRows.length}
            page={page}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
          />
        </TableContainer>
      )}
    </div>
  )
}

// ─── SortableTh — 정렬 가능 헤더. 클릭 시 onSort 호출. ───────────────────────
function SortableTh({
  sortKey: key,
  label,
  currentKey,
  currentDir,
  onSort,
}: {
  sortKey: SortKey
  label: string
  currentKey: SortKey
  currentDir: SortDir
  onSort: (k: SortKey) => void
}) {
  const active = currentKey === key
  const Icon = active ? (currentDir === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown
  return (
    <Th>
      <button
        type="button"
        onClick={() => onSort(key)}
        className={cn(
          'inline-flex items-center gap-1 transition-colors',
          active ? 'text-text-primary' : 'text-text-secondary hover:text-text-primary',
        )}
      >
        <span>{label}</span>
        <Icon className="h-3 w-3" aria-hidden />
      </button>
    </Th>
  )
}
