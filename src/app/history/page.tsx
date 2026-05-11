'use client'

import { useState, useEffect } from 'react'
import { RefreshCw } from 'lucide-react'
import WorkLogModal from '@/components/WorkLogModal'
import SubmissionsRawTable from '@/components/SubmissionsRawTable'
import {
  Button,
  FilterBar,
  Input,
  Select,
  PageHeader,
} from '@/components/ui'
import { cn } from '@/lib/utils/cn'
import type { WorkLog } from '@/types/work-log'

type TabKey = 'final' | 'raw'

interface OrgTeam { id: string; division_id: string; name: string }
interface OrgDivision { id: string; name: string; teams: OrgTeam[] }

export default function HistoryPage() {
  const [isAdmin, setIsAdmin] = useState(false)
  const [org, setOrg] = useState<OrgDivision[]>([])
  const [filterMine, setFilterMine] = useState(false)
  const [filterDivision, setFilterDivision] = useState('')
  const [filterTeam, setFilterTeam] = useState('')
  const [filterName, setFilterName] = useState('')
  const [editingLog, setEditingLog] = useState<WorkLog | null>(null)
  const [editScope,  setEditScope]  = useState<'check_in' | 'check_out' | undefined>(undefined)
  // 새로고침 button — SubmissionsRawTable의 extraQuery dependency 변경 트리거용 카운터.
  const [refreshTick, setRefreshTick] = useState(0)
  // profile 응답 도착 전엔 SubmissionsRawTable 렌더 보류 — 빈 필터로 첫 fetch 했다가
  // profile 도착 후 본인 본부/팀으로 재 fetch하는 1초 더블 로딩 방지.
  const [profileReady, setProfileReady] = useState(false)

  // ─── 탭 ─────────────────────────────────────────────────────
  const [tab, setTab] = useState<TabKey>('final')

  // 관리자 여부 + 조직 + 내 프로필 기본값 — 병렬 호출
  useEffect(() => {
    Promise.all([
      fetch('/api/admin/check').then(r => r.json()).catch(() => ({ isAdmin: false })),
      fetch('/api/org').then(r => r.ok ? r.json() : []).catch(() => []),
      fetch('/api/auth/profile').then(r => r.ok ? r.json() : null).catch(() => null),
    ]).then(([adminData, orgData, profile]) => {
      setIsAdmin(adminData?.isAdmin ?? false)
      setOrg(orgData as OrgDivision[])
      if (profile?.division) setFilterDivision(profile.division)
      if (profile?.team) setFilterTeam(profile.team)
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
            disabled={filterMine || !filterDivision || availableTeams.length === 0}
            className="min-w-[140px]"
          >
            <option value="">전체 팀</option>
            {availableTeams.map(t => (
              <option key={t.id} value={t.name}>{t.name}</option>
            ))}
          </Select>
        </FilterBar.Field>

        <FilterBar.Field label="이름 검색">
          <Input
            type="text"
            placeholder="이름 일부..."
            value={filterName}
            onChange={e => setFilterName(e.target.value)}
            className="w-40"
          />
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
              setFilterName('')
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
          {[
            { key: 'final' as TabKey, label: '일자별 최종 보고' },
            { key: 'raw'   as TabKey, label: 'RAW 제출 내역' },
          ].map(t => (
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

      {/* SubmissionsRawTable — profile 도착 전엔 빈 스켈레톤만. 도착 후 1회 fetch. */}
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
                ...(filterName ? { name: filterName } : {}),
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
                ...(filterName ? { name: filterName } : {}),
                ...(refreshTick > 0 ? { _t: String(refreshTick) } : {}),
              }}
              allowOrgFilter
              onEditWorkLog={isAdmin ? openEditByWorkLogId : undefined}
            />
          )}
        </>
      )}
    </div>
  )
}
