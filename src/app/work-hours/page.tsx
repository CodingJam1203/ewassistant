'use client'

/**
 * 근로시간 관리 페이지
 *
 * 권한:
 *   admin   → 전체 조직 (본부/팀 필터)
 *   leader  → 본인 팀 또는 본인 본부 (서버에서 자동 제한)
 *   user    → 접근 불가 (Navbar에도 안 보이지만 직접 URL 진입 시 빈 화면 안내)
 */

import { useEffect, useState, useMemo, useCallback } from 'react'
import { RefreshCw, X } from 'lucide-react'
import WorkHoursCard from '@/components/WorkHoursCard'
import Pagination from '@/components/Pagination'
import {
  fmtHours,
  riskLabel,
  riskBadgeClass,
  type MonthBaselines,
  type RiskLevel,
  type UserMonthSummary,
  type TeamSummary,
  type OverallSummary,
} from '@/lib/utils/work-hours'

interface OrgTeam { id: string; division_id: string; name: string }
interface OrgDivision { id: string; name: string; teams: OrgTeam[] }

interface ApiResponse {
  baselines: MonthBaselines
  users: UserMonthSummary[]
  teamSummaries: TeamSummary[]
  overall: OverallSummary
  scope: { kind: 'admin' | 'team' | 'division' | null; division: string | null; team: string | null }
}

type SortKey =
  | 'recognized_desc'
  | 'over_rate_desc'
  | 'remaining_asc'
  | 'name_asc'
  | 'team_asc'

const RISK_OPTIONS: Array<{ value: '' | RiskLevel; label: string }> = [
  { value: '',        label: '전체 위험 상태' },
  { value: 'normal',  label: '정상' },
  { value: 'caution', label: '주의' },
  { value: 'danger',  label: '위험' },
  { value: 'over',    label: '초과' },
]

export default function WorkHoursPage() {
  const today = new Date()

  // ─── 필터 상태 ────────────────────────────────────────────────────────────
  const [year,  setYear]  = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth() + 1)
  const [filterDiv,  setFilterDiv]  = useState('')
  const [filterTeam, setFilterTeam] = useState('')
  const [filterName, setFilterName] = useState('')
  const [filterRisk, setFilterRisk] = useState<'' | RiskLevel>('')
  const [sortKey,    setSortKey]    = useState<SortKey>('recognized_desc')

  // ─── 데이터 상태 ──────────────────────────────────────────────────────────
  const [data, setData] = useState<ApiResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [orgDivisions, setOrgDivisions] = useState<OrgDivision[]>([])
  const [selectedUser, setSelectedUser] = useState<UserMonthSummary | null>(null)

  // ─── 페이지네이션 (개인별 테이블) ─────────────────────────────
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)

  // ─── org 로드 ─────────────────────────────────────────────────────────────
  useEffect(() => {
    fetch('/api/org')
      .then(r => r.ok ? r.json() : [])
      .then(d => Array.isArray(d) ? setOrgDivisions(d) : null)
      .catch(() => {})
  }, [])

  // ─── 데이터 fetch ─────────────────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({
        year: String(year),
        month: String(month),
      })
      if (filterDiv)  params.set('division', filterDiv)
      if (filterTeam) params.set('team', filterTeam)
      if (filterName) params.set('name', filterName)
      if (filterRisk) params.set('risk', filterRisk)
      const res = await fetch(`/api/work-hours?${params}`)
      const json = await res.json()
      if (!res.ok) {
        setError(json.error ?? '데이터 조회에 실패했습니다.')
        setData(null)
      } else {
        setData(json as ApiResponse)
      }
    } catch (err) {
      console.error(err)
      setError('네트워크 오류가 발생했습니다.')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [year, month, filterDiv, filterTeam, filterName, filterRisk])

  useEffect(() => { fetchData() }, [fetchData])

  // ─── 정렬된 사용자 목록 ──────────────────────────────────────────────────
  const sortedUsers = useMemo(() => {
    if (!data) return []
    const arr = [...data.users]
    arr.sort((a, b) => {
      switch (sortKey) {
        case 'recognized_desc': return b.recognizedHours - a.recognizedHours
        case 'over_rate_desc':  return b.overRate - a.overRate
        case 'remaining_asc':   return a.remainingHours - b.remainingHours
        case 'name_asc':
          return (a.display_name ?? a.email).localeCompare(b.display_name ?? b.email)
        case 'team_asc':
          return (a.team ?? '').localeCompare(b.team ?? '') ||
                 (a.display_name ?? a.email).localeCompare(b.display_name ?? b.email)
        default: return 0
      }
    })
    return arr
  }, [data, sortKey])

  const availableTeams = useMemo(() =>
    orgDivisions.find(d => d.name === filterDiv)?.teams ?? [],
    [orgDivisions, filterDiv]
  )

  // 필터/정렬 변경 시 1페이지로 리셋
  useEffect(() => { setPage(1) }, [
    year, month, filterDiv, filterTeam, filterName, filterRisk, sortKey, sortedUsers.length,
  ])

  const pageStart = (page - 1) * pageSize
  const pagedUsers = sortedUsers.slice(pageStart, pageStart + pageSize)

  const isLeaderScope = data?.scope.kind === 'team' || data?.scope.kind === 'division'

  return (
    <div className="space-y-5">
      {/* 헤더 */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">근로시간 관리</h2>
          {isLeaderScope && data && (
            <p className="text-xs text-blue-600 mt-1">
              리더 권한 — {data.scope.kind === 'team' ? `${data.scope.team} 팀` : `${data.scope.division} 본부`} 범위로 자동 제한됨
            </p>
          )}
        </div>
        <button
          onClick={fetchData}
          className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800"
        >
          <RefreshCw className="h-4 w-4" />
          새로고침
        </button>
      </div>

      {/* 필터 바 */}
      <div className="bg-white rounded-lg border border-gray-200 p-4 flex flex-wrap gap-3 items-end">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">연도</label>
          <select value={year} onChange={e => setYear(Number(e.target.value))}
            className="select-tight border border-gray-300 rounded px-2 py-1.5 text-sm bg-white">
            {[today.getFullYear() - 1, today.getFullYear(), today.getFullYear() + 1].map(y =>
              <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">월</label>
          <select value={month} onChange={e => setMonth(Number(e.target.value))}
            className="select-tight border border-gray-300 rounded px-2 py-1.5 text-sm bg-white">
            {Array.from({ length: 12 }, (_, i) => i + 1).map(m =>
              <option key={m} value={m}>{m}월</option>)}
          </select>
        </div>
        {!isLeaderScope && (
          <>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">본부</label>
              <select value={filterDiv}
                onChange={e => { setFilterDiv(e.target.value); setFilterTeam('') }}
                className="select-tight border border-gray-300 rounded px-2 py-1.5 text-sm bg-white min-w-[140px]">
                <option value="">전체</option>
                {orgDivisions.map(d => <option key={d.id} value={d.name}>{d.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">팀</label>
              <select value={filterTeam}
                onChange={e => setFilterTeam(e.target.value)}
                disabled={!filterDiv}
                className="select-tight border border-gray-300 rounded px-2 py-1.5 text-sm bg-white disabled:bg-gray-50 min-w-[140px]">
                <option value="">전체</option>
                {availableTeams.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
              </select>
            </div>
          </>
        )}
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">이름 검색</label>
          <input value={filterName} onChange={e => setFilterName(e.target.value)}
            placeholder="이름 일부"
            className="border border-gray-300 rounded px-2 py-1.5 text-sm w-32" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">위험 상태</label>
          <select value={filterRisk}
            onChange={e => setFilterRisk(e.target.value as '' | RiskLevel)}
            className="select-tight border border-gray-300 rounded px-2 py-1.5 text-sm bg-white">
            {RISK_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
      </div>

      {/* 에러 */}
      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>
      )}

      {/* 상단 요약 카드 */}
      {data && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <SummaryStat label="전체 인원"     value={data.overall.totalCount} />
          <SummaryStat label="정상"          value={data.overall.normalCount}  color="text-green-700" bg="bg-green-50" />
          <SummaryStat label="주의"          value={data.overall.cautionCount} color="text-yellow-700" bg="bg-yellow-50" />
          <SummaryStat label="위험"          value={data.overall.dangerCount}  color="text-orange-700" bg="bg-orange-50" />
          <SummaryStat label="초과"          value={data.overall.overCount}    color="text-red-700"   bg="bg-red-50" />
          <SummaryStat label="평균 인정근로" value={`${fmtHours(data.overall.avgRecognizedHours)} h`} />
        </div>
      )}

      {/* 팀별 요약 테이블 */}
      {data && data.teamSummaries.length > 0 && (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 text-sm font-semibold text-gray-800">
            팀별 요약
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <Th>본부</Th><Th>팀</Th>
                  <Th className="text-center">총원</Th>
                  <Th className="text-center text-green-700">정상</Th>
                  <Th className="text-center text-yellow-700">주의</Th>
                  <Th className="text-center text-orange-700">위험</Th>
                  <Th className="text-center text-red-700">초과</Th>
                  <Th className="text-right">평균 인정근로</Th>
                  <Th className="text-right">평균 초과율</Th>
                  <Th className="text-right">팀 인정근로 합</Th>
                  <Th className="text-right">팀 계획시간 합</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.teamSummaries.map((t, i) => (
                  <tr key={i} className="hover:bg-gray-50">
                    <Td>{t.division ?? '-'}</Td>
                    <Td>{t.team ?? '(본부장)'}</Td>
                    <Td center>{t.totalCount}</Td>
                    <Td center>{t.normalCount}</Td>
                    <Td center>{t.cautionCount}</Td>
                    <Td center>{t.dangerCount}</Td>
                    <Td center>{t.overCount}</Td>
                    <Td right>{fmtHours(t.avgRecognizedHours)} h</Td>
                    <Td right>{Math.round(t.avgOverRate * 100)}%</Td>
                    <Td right>{fmtHours(t.totalRecognizedHours)} h</Td>
                    <Td right>{fmtHours(t.totalPlanHours)} h</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 개인별 테이블 */}
      {data && (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between gap-3 flex-wrap">
            <div className="text-sm font-semibold text-gray-800">개인별 근로시간</div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-gray-600">정렬</label>
              <select value={sortKey} onChange={e => setSortKey(e.target.value as SortKey)}
                className="select-tight border border-gray-300 rounded px-2 py-1 text-xs bg-white">
                <option value="recognized_desc">인정 근로시간 높은 순</option>
                <option value="over_rate_desc">초과율 높은 순</option>
                <option value="remaining_asc">잔여 가능 시간 낮은 순</option>
                <option value="name_asc">이름순</option>
                <option value="team_asc">팀순</option>
              </select>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <Th>이름</Th><Th>본부</Th><Th>팀</Th>
                  <Th className="text-right">소정기준</Th>
                  <Th className="text-right">법정기본</Th>
                  <Th className="text-right">최대한도</Th>
                  <Th className="text-right">인정근로</Th>
                  <Th className="text-right">실근로</Th>
                  <Th className="text-right">휴가</Th>
                  <Th className="text-right">잔여</Th>
                  <Th className="text-right">초과율</Th>
                  <Th className="text-center">위험</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {pagedUsers.map(u => (
                  <tr
                    key={u.email}
                    onClick={() => setSelectedUser(u)}
                    className={`cursor-pointer hover:bg-blue-50 transition-colors ${
                      u.risk === 'over' ? 'bg-red-50/50'
                        : u.risk === 'danger' ? 'bg-orange-50/50'
                        : u.risk === 'caution' ? 'bg-yellow-50/30'
                        : ''
                    }`}
                  >
                    <Td>
                      <span className="font-medium text-gray-900">{u.display_name ?? u.email}</span>
                    </Td>
                    <Td>{u.division ?? '-'}</Td>
                    <Td>{u.team ?? '-'}</Td>
                    <Td right muted>{fmtHours(data.baselines.standardHours)} h</Td>
                    <Td right muted>{fmtHours(data.baselines.legalBaseHours)} h</Td>
                    <Td right muted>{fmtHours(data.baselines.maxLimitHours)} h</Td>
                    <Td right>
                      <span className="font-bold text-blue-600">{fmtHours(u.recognizedHours)} h</span>
                    </Td>
                    <Td right>{fmtHours(u.actualHours)} h</Td>
                    <Td right>{fmtHours(u.leaveHours)} h</Td>
                    <Td right>{fmtHours(u.remainingHours)} h</Td>
                    <Td right>{Math.round(u.overRate * 100)}%</Td>
                    <Td center>
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${riskBadgeClass(u.risk)}`}>
                        {riskLabel(u.risk)}
                      </span>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
            {sortedUsers.length === 0 && (
              <div className="py-12 text-center text-sm text-gray-500">조건에 맞는 인원이 없습니다.</div>
            )}
          </div>
          {sortedUsers.length > 0 && (
            <Pagination
              totalCount={sortedUsers.length}
              page={page}
              pageSize={pageSize}
              onPageChange={setPage}
              onPageSizeChange={setPageSize}
              unit="명"
            />
          )}
        </div>
      )}

      {/* 로딩 */}
      {loading && (
        <div className="text-center text-sm text-gray-500 py-4">불러오는 중...</div>
      )}

      {/* 개인 상세 모달 */}
      {selectedUser && data && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 overflow-y-auto py-6"
          onClick={() => setSelectedUser(null)}
        >
          <div
            className="w-full max-w-md"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex justify-end mb-2">
              <button
                onClick={() => setSelectedUser(null)}
                className="text-white/80 hover:text-white p-1"
                title="닫기"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <WorkHoursCard
              baselines={data.baselines}
              summary={selectedUser}
              subtitle={`${selectedUser.display_name ?? selectedUser.email} · ${selectedUser.division ?? ''} ${selectedUser.team ?? ''}`}
            />
          </div>
        </div>
      )}
    </div>
  )
}

// ─── 작은 부품들 ────────────────────────────────────────────────────────────

function SummaryStat({
  label, value, color, bg,
}: {
  label: string; value: number | string; color?: string; bg?: string
}) {
  return (
    <div className={`rounded-lg border border-gray-200 p-3 ${bg ?? 'bg-white'}`}>
      <div className="text-xs text-gray-500 mb-1">{label}</div>
      <div className={`text-xl font-bold ${color ?? 'text-gray-900'}`}>{value}</div>
    </div>
  )
}

function Th({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <th className={`px-3 py-2 text-left text-xs font-medium text-gray-600 uppercase tracking-wider whitespace-nowrap ${className}`}>
      {children}
    </th>
  )
}

function Td({
  children, center, right, muted,
}: {
  children: React.ReactNode; center?: boolean; right?: boolean; muted?: boolean
}) {
  const align = center ? 'text-center' : right ? 'text-right' : 'text-left'
  const color = muted ? 'text-gray-400' : 'text-gray-700'
  return (
    <td className={`px-3 py-2 whitespace-nowrap ${align} ${color}`}>{children}</td>
  )
}
