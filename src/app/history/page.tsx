'use client'

import { useState, useEffect } from 'react'
import { RefreshCw } from 'lucide-react'
import WorkLogModal from '@/components/WorkLogModal'
import SubmissionsRawTable from '@/components/SubmissionsRawTable'
import MissingReportsListView from '@/components/MissingReportsListView'
import LeaderReviewsTable from '@/components/LeaderReviewsTable'
import { DIVISION_DIRECT_LABEL, DIVISION_DIRECT_FILTER } from '@/lib/org'
import {
  Button,
  FilterBar,
  Input,
  Select,
  PageHeader,
} from '@/components/ui'
import { cn } from '@/lib/utils/cn'
import type { WorkLog } from '@/types/work-log'

type TabKey = 'final' | 'missing' | 'raw' | 'leader'

/** 이번 달 시작/끝 (KST, YYYY-MM-DD) */
function thisMonthRange(): { from: string; to: string } {
  const now = new Date()
  const y = now.getFullYear()
  const m = now.getMonth()
  const last = new Date(y, m + 1, 0).getDate()
  const pad = (n: number) => String(n).padStart(2, '0')
  return {
    from: `${y}-${pad(m + 1)}-01`,
    to:   `${y}-${pad(m + 1)}-${pad(last)}`,
  }
}

interface OrgTeam { id: string; division_id: string; name: string; use_leader_review?: boolean }
interface OrgDivision { id: string; name: string; teams: OrgTeam[] }

export default function HistoryPage() {
  const [isAdmin, setIsAdmin] = useState(false)
  const [isLeader, setIsLeader] = useState(false)
  /** v1.74 — 본인이 use_leader_review=true 팀 리더면 리더 관리 탭이 맨 앞으로. */
  const [leaderTabPrimary, setLeaderTabPrimary] = useState(false)
  const [org, setOrg] = useState<OrgDivision[]>([])
  const [filterMine, setFilterMine] = useState(false)
  const [filterDivision, setFilterDivision] = useState('')
  const [filterTeam, setFilterTeam] = useState('')
  // v1.61.13 — 상단 전역 "이름 검색" 폐기. SubmissionsRawTable / MissingReportsListView
  // 각각이 자체 quick filter를 들고 있어 헷갈리는 dual 라벨이었고, 위쪽은 Enter/돋보기
  // 명시 트리거였는데 트리거 정책이 사용자에게 발견성 낮아 사실상 무용지물.
  // 이름 필터는 각 탭 컴포넌트 내부의 즉시 반응 필드에서만 처리한다.
  const [editingLog, setEditingLog] = useState<WorkLog | null>(null)
  const [editScope,  setEditScope]  = useState<'check_in' | 'check_out' | undefined>(undefined)
  // 새로고침 button — SubmissionsRawTable의 extraQuery dependency 변경 트리거용 카운터.
  const [refreshTick, setRefreshTick] = useState(0)
  // profile 응답 도착 전엔 SubmissionsRawTable 렌더 보류 — 빈 필터로 첫 fetch 했다가
  // profile 도착 후 본인 본부/팀으로 재 fetch하는 1초 더블 로딩 방지.
  const [profileReady, setProfileReady] = useState(false)

  // ─── 탭 ─────────────────────────────────────────────────────
  const [tab, setTab] = useState<TabKey>('final')

  // 미보고 탭용 — 이번 달 default
  const [missingFrom, setMissingFrom] = useState(() => thisMonthRange().from)
  const [missingTo,   setMissingTo]   = useState(() => thisMonthRange().to)

  // 관리자 여부 + 조직 + 내 프로필 기본값 — 병렬 호출
  useEffect(() => {
    Promise.all([
      fetch('/api/admin/check').then(r => r.json()).catch(() => ({ isAdmin: false })),
      fetch('/api/org').then(r => r.ok ? r.json() : []).catch(() => []),
      fetch('/api/auth/profile').then(r => r.ok ? r.json() : null).catch(() => null),
    ]).then(([adminData, orgData, profile]) => {
      setIsAdmin(adminData?.isAdmin ?? false)
      const leader = profile?.role === 'leader' || profile?.role === 'admin' || adminData?.isAdmin
      setIsLeader(leader)
      setOrg(orgData as OrgDivision[])
      if (profile?.division) setFilterDivision(profile.division)
      if (profile?.team) setFilterTeam(profile.team)
      // v1.74 — leader(admin 제외)가 본인 팀이 use_leader_review=true면 리더 관리 탭을 맨 앞으로
      // 본인 팀 use_leader_review는 /api/org에 포함된 use_leader_review 필드로 판정.
      if (profile?.role === 'leader' && profile?.division && profile?.team) {
        const teams = (orgData as OrgDivision[] | undefined)
          ?.find((d) => d.name === profile.division)?.teams ?? []
        type TeamWithFlag = OrgTeam & { use_leader_review?: boolean }
        const myTeam = teams.find((t) => t.name === profile.team) as TeamWithFlag | undefined
        if (myTeam?.use_leader_review) {
          setLeaderTabPrimary(true)
          setTab('leader')  // 진입 시 자동 선택
        }
      }
      setProfileReady(true)
    })
  }, [])

  const handleDivisionChange = (div: string) => {
    setFilterDivision(div)
    setFilterTeam('')
  }
  const availableTeams = org.find(d => d.name === filterDivision)?.teams ?? []

  /**
   * 수정 모달 진입 — SubmissionsRawTable의 ✏ 버튼 핸들러.
   * GET /api/work-logs/{id}로 단건 조회 (모달 캐시용 list fetch는 제거 — 초기 페이로드 절감).
   */
  const openEditByWorkLogId = async (
    workLogId: string,
    scope: 'check_in' | 'check_out',
  ) => {
    try {
      const res = await fetch(`/api/work-logs/${workLogId}`)
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        alert('해당 보고를 불러오지 못했습니다: ' + (err.error ?? res.statusText))
        return
      }
      const fresh = (await res.json()) as WorkLog
      setEditScope(scope)
      setEditingLog(fresh)
    } catch {
      alert('해당 보고를 불러오는 중 오류가 발생했습니다.')
    }
  }
  const handleEditSuccess = () => {
    setEditingLog(null)
    setRefreshTick(t => t + 1)  // SubmissionsRawTable 재조회 트리거
  }

  return (
    <div className="space-y-6">
      {/* 수정 모달 (관리자) */}
      {editingLog && isAdmin && (
        <WorkLogModal
          date={editingLog.leave_date}
          userName={editingLog.name}
          editingLog={editingLog}
          editScope={editScope}
          onClose={() => { setEditingLog(null); setEditScope(undefined) }}
          onSuccess={() => { handleEditSuccess(); setEditScope(undefined) }}
        />
      )}

      <PageHeader
        title="제출 내역"
        description="조직 전체의 출퇴근/휴게 보고 이력을 조회하고, 필요시 수정할 수 있습니다."
      />

      {/* 공통 필터 바 (두 탭 모두 적용) */}
      <FilterBar>
        <FilterBar.Field label="본부">
          <Select
            value={filterDivision}
            onChange={e => handleDivisionChange(e.target.value)}
            disabled={filterMine}
            className="min-w-[140px]"
          >
            <option value="">전체</option>
            {org.map(d => (
              <option key={d.id} value={d.name}>{d.name}</option>
            ))}
          </Select>
        </FilterBar.Field>

        <FilterBar.Field label="팀">
          <Select
            value={filterTeam}
            onChange={e => setFilterTeam(e.target.value)}
            disabled={filterMine || !filterDivision}
            className="min-w-[140px]"
          >
            <option value="">전체 팀</option>
            {availableTeams.map(t => (
              <option key={t.id} value={t.name}>{t.name}</option>
            ))}
            <option value={DIVISION_DIRECT_FILTER}>{DIVISION_DIRECT_LABEL}</option>
          </Select>
        </FilterBar.Field>

        <FilterBar.Field label="범위">
          <label className="inline-flex items-center gap-2 h-10 px-3 rounded-[10px] border border-border-strong bg-surface cursor-pointer">
            <input
              id="filterMineHistory"
              type="checkbox"
              className="h-4 w-4 rounded border-border-strong text-primary-600 focus:ring-primary-500"
              checked={filterMine}
              onChange={e => setFilterMine(e.target.checked)}
            />
            <span className="text-sm text-text-primary">내 기록만</span>
          </label>
        </FilterBar.Field>

        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setFilterDivision('')
              setFilterTeam('')
              setFilterMine(false)
            }}
          >
            필터 초기화
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setRefreshTick(t => t + 1)}>
            <RefreshCw className="h-4 w-4" aria-hidden /> 새로고침
          </Button>
        </div>
      </FilterBar>

      {/* 탭 */}
      <div className="border-b border-border">
        <nav className="-mb-px flex gap-6" aria-label="탭">
          {(() => {
            const base = [
              { key: 'final'   as TabKey, label: '일자별 최종 보고', show: true },
              { key: 'missing' as TabKey, label: '미보고 현황',      show: true },
              { key: 'raw'     as TabKey, label: 'RAW 제출 내역',    show: true },
              { key: 'leader'  as TabKey, label: '리더 관리',         show: isLeader },
            ].filter(t => t.show)
            // v1.74 — use_leader_review 팀 리더는 리더 관리 탭이 맨 앞.
            if (leaderTabPrimary) {
              const leader = base.find(t => t.key === 'leader')
              if (leader) return [leader, ...base.filter(t => t.key !== 'leader')]
            }
            return base
          })().map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                'py-2.5 px-1 border-b-2 text-sm transition-colors',
                tab === t.key
                  ? 'border-primary-600 text-primary-600 font-semibold'
                  : 'border-transparent text-text-secondary hover:text-text-primary hover:border-border-strong font-medium',
              )}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </div>

      {/* 미보고 현황 탭 — 기간 필터 (탭 전용) */}
      {tab === 'missing' && profileReady && (
        <FilterBar>
          <FilterBar.Field label="시작일">
            <Input
              type="date"
              value={missingFrom}
              onChange={e => setMissingFrom(e.target.value)}
              className="w-44"
            />
          </FilterBar.Field>
          <FilterBar.Field label="종료일">
            <Input
              type="date"
              value={missingTo}
              onChange={e => setMissingTo(e.target.value)}
              className="w-44"
            />
          </FilterBar.Field>
          <div className="ml-auto">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                const { from, to } = thisMonthRange()
                setMissingFrom(from)
                setMissingTo(to)
              }}
            >
              이번 달
            </Button>
          </div>
        </FilterBar>
      )}

      {/* 본문 — profile 도착 전엔 빈 스켈레톤만. 도착 후 1회 fetch. */}
      {!profileReady ? (
        <div className="space-y-2">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-10 bg-surface-muted rounded-[10px] animate-pulse" />
          ))}
        </div>
      ) : (
        <>
          {tab === 'raw' && (
            <SubmissionsRawTable
              mode="raw"
              mine={filterMine}
              extraQuery={{
                ...(filterDivision ? { division: filterDivision } : {}),
                ...(filterTeam ? { team: filterTeam } : {}),
                ...(refreshTick > 0 ? { _t: String(refreshTick) } : {}),
              }}
              allowOrgFilter
              onEditWorkLog={isAdmin ? openEditByWorkLogId : undefined}
            />
          )}

          {tab === 'final' && (
            <SubmissionsRawTable
              mode="final"
              mine={filterMine}
              extraQuery={{
                ...(filterDivision ? { division: filterDivision } : {}),
                ...(filterTeam ? { team: filterTeam } : {}),
                ...(refreshTick > 0 ? { _t: String(refreshTick) } : {}),
              }}
              allowOrgFilter
              onEditWorkLog={isAdmin ? openEditByWorkLogId : undefined}
            />
          )}

          {tab === 'missing' && (
            <MissingReportsListView
              from={missingFrom}
              to={missingTo}
              division={filterDivision}
              team={filterTeam}
              refreshKey={refreshTick}
              canSendNotify={isLeader || isAdmin}
            />
          )}

          {tab === 'leader' && isLeader && (
            <LeaderReviewsTable
              divisionFilter={filterDivision}
              teamFilter={filterTeam}
              refreshTick={refreshTick}
              defaultReportKind="check_out"
            />
          )}
        </>
      )}
    </div>
  )
}
