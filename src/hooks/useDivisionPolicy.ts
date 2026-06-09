/**
 * v1.77 — 본인 본부의 외부 캘린더 모드 정책 + 시트 URL 조회 hook.
 *
 * GET /api/org 응답을 캐시하여 사용자.division 매칭해 정책 추출.
 * 응답에 Cache-Control private, max-age=60, swr=86400 박혀있어 첫 호출 후 재호출은 즉시.
 */

import { useEffect, useState } from 'react'

export interface DivisionPolicy {
  /** 정책 ON 시 휴가는 NPM, 시트 일정은 시트 redirect, EventEditModal 휴가 속성 차단 */
  readOnlyCalendar: boolean
  /** 본부 시트 source의 spreadsheet_url (등록되어 있으면). 일정 chip redirect용. */
  sheetUrl: string | null
  /** 로딩 상태 (fetch 실패해도 false로 떨어짐. 결과는 default 정책 OFF) */
  loading: boolean
}

interface OrgDivisionResp {
  id: string
  name: string
  read_only_calendar?: boolean
  sheet_url?: string | null
}

interface UserProfileResp {
  division?: string | null
}

const DEFAULT_POLICY: DivisionPolicy = {
  readOnlyCalendar: false,
  sheetUrl: null,
  loading: false,
}

/**
 * 본인 본부 정책 조회. 사용자가 본부 미배정 또는 fetch 실패면 default OFF.
 */
export function useDivisionPolicy(): DivisionPolicy {
  const [policy, setPolicy] = useState<DivisionPolicy>({ ...DEFAULT_POLICY, loading: true })

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const [profileRes, orgRes] = await Promise.all([
          fetch('/api/auth/profile', { credentials: 'same-origin' }),
          fetch('/api/org', { credentials: 'same-origin' }),
        ])
        if (!profileRes.ok || !orgRes.ok) {
          if (!cancelled) setPolicy({ ...DEFAULT_POLICY })
          return
        }
        const profile = (await profileRes.json()) as UserProfileResp
        const orgList = (await orgRes.json()) as OrgDivisionResp[]
        const myDivName = (profile.division ?? '').trim()
        if (!myDivName) {
          if (!cancelled) setPolicy({ ...DEFAULT_POLICY })
          return
        }
        const myDiv = orgList.find(d => d.name === myDivName)
        if (!myDiv) {
          if (!cancelled) setPolicy({ ...DEFAULT_POLICY })
          return
        }
        if (!cancelled) {
          setPolicy({
            readOnlyCalendar: !!myDiv.read_only_calendar,
            sheetUrl: (myDiv.sheet_url ?? '').trim() || null,
            loading: false,
          })
        }
      } catch {
        if (!cancelled) setPolicy({ ...DEFAULT_POLICY })
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  return policy
}
