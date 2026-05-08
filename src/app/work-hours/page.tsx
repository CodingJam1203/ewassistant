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
  riskBadgeVariant,
  type MonthBaselines,
  type RiskLevel,
  type UserMonthSummary,
  type TeamSummary,
  type OverallSummary,
} from '@/lib/utils/work-hours'
import {
  Badge,
  Button,
  FilterBar,
  Input,
  Select,
  StatCard,
  TableContainer,
  TableScroll,
  Table,
  Th,
  Td,
  TR_HOVER,
  PageHeader,
} from '@/components/ui'
import { cn } from '@/lib/utils/cn'

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

  // 페이지네이션
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)

  useEffect(() => {
    fetch('/api/org')
      .then(r => r.ok ? r.json() : [])
      .then(d => Array.isArray(d) ? setOrgDivisions(d) : null)
      .catch(() => {})
  }, [])

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

  useEffect(() => { setPage(1) }, [
    year, month, filterDiv, filterTeam, filterName, filterRisk, sortKey, sortedUsers.length,
  ])
  const pageStart = (page - 1) * pageSize
  const pagedUsers = sortedUsers.slice(pageStart, pageStart + pageSize)

  const isLeaderScope = data?.scope.kind === 'team' || data?.scope.kind === 'division'

  return (
    <div className="space-y-5">
      <PageHeader
        title="근로시간 관리"
        description={
          isLeaderScope && data
            ? `리더 권한 — ${data.scope.kind === 'team' ? `${data.scope.team} 팀` : `${data.scope.division} 본부`} 범위로 자동 제한됨`
            : '월별 인정근로 시간을 한 눈에 확인하고, 초과/위험 인원을 관리합니다.'
        }
        actions={
          <Button variant="ghost" onClick={fetchData}>
            <RefreshCw className="h-4 w-4" aria-hidden /> 새로고침
          </Button>
        }
      />

      {/* 필터 바 */}
      <FilterBar>
        <FilterBar.Field label="연도">
          <Select value={year} onChange={e => setYear(Number(e.target.value))} className="min-w-[100px]">
            {[today.getFullYear() - 1, today.getFullYear(), today.getFullYear() + 1].map(y =>
              <option key={y} value={y}>{y}</option>)}
          </Select>
        </FilterBar.Field>
        <FilterBar.Field label="월">
          <Select value={month} onChange={e => setMonth(Number(e.target.value))} className="min-w-[80px]">
            {Array.from({ length: 12 }, (_, i) => i + 1).map(m =>
              <option key={m} value={m}>{m}월</option>)}
          </Select>
        </FilterBar.Field>
        {!isLeaderScope && (
          <>
            <FilterBar.Field label="본부">
              <Select
                value={filterDiv}
                onChange={e => { setFilterDiv(e.target.value); setFilterTeam('') }}
                className="min-w-[140px]"
              >
                <option value="">전체</option>
                {orgDivisions.map(d => <option key={d.id} value={d.name}>{d.name}</option>)}
              </Select>
            </FilterBar.Field>
            <FilterBar.Field label="팀">
              <Select
                value={filterTeam}
                onChange={e => setFilterTeam(e.target.value)}
                disabled={!filterDiv}
                className="min-w-[140px]"
              >
                <option value="">전체</option>
                {availableTeams.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
              </Select>
            </FilterBar.Field>
          </>
        )}
        <FilterBar.Field label="이름 검색">
          <Input value={filterName} onChange={e => setFilterName(e.target.value)} placeholder="이름 일부" className="w-32" />
        </FilterBar.Field>
        <FilterBar.Field label="위험 상태">
          <Select
            value={filterRisk}
            onChange={e => setFilterRisk(e.target.value as '' | RiskLevel)}
            className="min-w-[140px]"
          >
            {RISK_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
        </FilterBar.Field>
      </FilterBar>

      {/* 에러 */}
      {error && (
        <div className="rounded-[10px] bg-danger-bg border border-danger-border p-3 text-sm text-danger-text">
          {error}
        </div>
      )}

      {/* 상단 요약 카드 */}
      {data && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <StatCard label="전체 인원" value={data.overall.totalCount} />
          <StatCard label="정상" value={data.overall.normalCount}  tone="success" />
          <StatCard label="주의" value={data.overall.cautionCount} tone="warning" />
          <StatCard label="위험" value={data.overall.dangerCount}  tone="danger" />
          <StatCard label="초과" value={data.overall.overCount}    tone="danger" />
          <StatCard label="평균 인정근로" value={`${fmtHours(data.overall.avgRecognizedHours)} h`} />
        </div>
      )}

      {/* 팀별 요약 테이블 */}
      {data && data.teamSummaries.length > 0 && (
        <TableContainer>
          <div className="px-4 py-3 border-b border-border text-sm font-semibold text-text-primary bg-background">
            팀별 요약
          </div>
          <TableScroll>
            <Table>
              <thead>
              <tr>
                <Th>본부</Th><Th>팀</Th>
                <Th className="text-center">총원</Th>
                <Th className="text-center text-success-text">정상</Th>
                <Th className="text-center text-warning-text">주의</Th>
                <Th className="text-center text-danger-text">위험</Th>
                <Th className="text-center text-danger-text">초과</Th>
                <Th className="text-right">평균 인정근로</Th>
                <Th className="text-right">평균 초과율</Th>
                <Th className="text-right">팀 인정근로 합</Th>
                <Th className="text-right">팀 계획시간 합</Th>
              </tr>
            </thead>
            <tbody>
              {data.teamSummaries.map((t, i) => (
                <tr key={i} className={TR_HOVER}>
                  <Td>{t.division ?? '-'}</Td>
                  <Td>{t.team ?? '(본부장)'}</Td>
                  <Td className="text-center" numeric>{t.totalCount}</Td>
                  <Td className="text-center" numeric>{t.normalCount}</Td>
                  <Td className="text-center" numeric>{t.cautionCount}</Td>
                  <Td className="text-center" numeric>{t.dangerCount}</Td>
                  <Td className="text-center" numeric>{t.overCount}</Td>
                  <Td className="text-right" numeric>{fmtHours(t.avgRecognizedHours)} h</Td>
                  <Td className="text-right" numeric>{Math.round(t.avgOverRate * 100)}%</Td>
                  <Td className="text-right" numeric>{fmtHours(t.totalRecognizedHours)} h</Td>
                  <Td className="text-right" numeric>{fmtHours(t.totalPlanHours)} h</Td>
                </tr>
              ))}
            </tbody>
            </Table>
          </TableScroll>
        </TableContainer>
      )}

      {/* 개인별 테이블 */}
      {data && (
        <TableContainer>
          <div className="px-4 py-3 border-b border-border bg-background flex items-center justify-between gap-3 flex-wrap">
            <div className="text-sm font-semibold text-text-primary">개인별 근로시간</div>
            <div className="flex items-center gap-2">
              <label className="text-[12px] text-text-secondary">정렬</label>
              <Select
                selectSize="sm"
                value={sortKey}
                onChange={e => setSortKey(e.target.value as SortKey)}
                className="min-w-[180px]"
              >
                <option value="recognized_desc">인정 근로시간 높은 순</option>
                <option value="over_rate_desc">초과율 높은 순</option>
                <option value="remaining_asc">잔여 가능 시간 낮은 순</option>
                <option value="name_asc">이름순</option>
                <option value="team_asc">팀순</option>
              </Select>
            </div>
          </div>
          <TableScroll>
            <Table>
              <thead>
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
            <tbody>
              {pagedUsers.map(u => (
                <tr
                  key={u.email}
                  onClick={() => setSelectedUser(u)}
                  className={cn(
                    'cursor-pointer transition-colors',
                    'hover:bg-primary-50/40',
                    u.risk === 'over' && 'bg-danger-bg/30',
                    u.risk === 'danger' && 'bg-danger-bg/30',
                    u.risk === 'caution' && 'bg-warning-bg/30',
                  )}
                >
                  <Td>
                    <span className="font-semibold text-text-primary">{u.display_name ?? u.email}</span>
                  </Td>
                  <Td muted>{u.division ?? '-'}</Td>
                  <Td muted>{u.team ?? '-'}</Td>
                  <Td className="text-right" muted numeric>{fmtHours(data.baselines.standardHours)} h</Td>
                  <Td className="text-right" muted numeric>{fmtHours(data.baselines.legalBaseHours)} h</Td>
                  <Td className="text-right" muted numeric>{fmtHours(data.baselines.maxLimitHours)} h</Td>
                  <Td className="text-right" numeric>
                    <span className="font-bold text-primary-600">{fmtHours(u.recognizedHours)} h</span>
                  </Td>
                  <Td className="text-right" numeric>{fmtHours(u.actualHours)} h</Td>
                  <Td className="text-right" numeric>{fmtHours(u.leaveHours)} h</Td>
                  <Td className="text-right" numeric>{fmtHours(u.remainingHours)} h</Td>
                  <Td
                    className={cn(
                      'text-right',
                      (u.risk === 'over' || u.risk === 'danger') && 'text-danger-text font-semibold',
                    )}
                    numeric
                  >
                    {Math.round(u.overRate * 100)}%
                  </Td>
                  <Td className="text-center">
                    <Badge variant={riskBadgeVariant(u.risk)}>{riskLabel(u.risk)}</Badge>
                  </Td>
                </tr>
              ))}
            </tbody>
            </Table>
          </TableScroll>
          {sortedUsers.length === 0 && (
            <div className="py-12 text-center text-sm text-text-muted">조건에 맞는 인원이 없습니다.</div>
          )}
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
        </TableContainer>
      )}

      {/* 로딩 */}
      {loading && (
        <div className="text-center text-sm text-text-muted py-4">불러오는 중...</div>
      )}

      {/* 개인 상세 모달 */}
      {selectedUser && data && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 overflow-y-auto py-6"
          onClick={() => setSelectedUser(null)}
        >
          <div className="w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="flex justify-end mb-2">
              <button
                onClick={() => setSelectedUser(null)}
                className="text-white/80 hover:text-white p-1"
                title="닫기"
                aria-label="닫기"
              >
                <X className="h-5 w-5" aria-hidden />
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
