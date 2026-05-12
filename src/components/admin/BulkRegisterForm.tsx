'use client'

/**
 * 관리자 — 대량 사전 등록 폼.
 *
 * 사용자가 엑셀/시트에서 복사한 TSV(탭 구분) 또는 CSV를 textarea에 붙여넣으면
 * 클라이언트에서 행 단위로 파싱하여 미리보기 표를 보여주고,
 * 등록 버튼 클릭 시 한 번에 /api/admin/users/bulk 호출.
 *
 * 컬럼 순서: 이메일 | 이름 | 본부 | 팀 | 권한
 *   - 이메일만 필수
 *   - 이름/본부/팀 빈 값 허용
 *   - 권한 한글('일반','리더','관리자') 또는 영문('user','leader','admin') 모두 허용 (기본 user)
 *   - 첫 행이 헤더('email' / '이메일' 등)이면 자동 스킵
 *
 * 약관/개인정보 동의는 사용자가 최초 로그인 시점에 받음 — 본 폼에선 미수집.
 */

import { useMemo, useState } from 'react'
import { Loader2, FileText, X, Check, AlertCircle } from 'lucide-react'

interface ParsedRow {
  email: string
  display_name: string
  division: string
  team: string
  role: 'user' | 'leader' | 'admin'
  /** 클라이언트 측 즉시 검증 결과 */
  valid: boolean
  warning?: string
}

interface BulkRegisterFormProps {
  onDone: () => void
}

function normalizeRole(raw: string): 'user' | 'leader' | 'admin' {
  const r = raw.trim().toLowerCase()
  if (r === 'admin' || r === '관리자') return 'admin'
  if (r === 'leader' || r === '리더') return 'leader'
  return 'user'
}

function looksLikeHeader(cells: string[]): boolean {
  if (cells.length === 0) return false
  const first = cells[0].toLowerCase().trim()
  return (
    first.includes('email') ||
    first.includes('이메일') ||
    first === 'e-mail' ||
    first === 'mail'
  )
}

function parseInput(raw: string): ParsedRow[] {
  const lines = raw
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l.length > 0)
  if (lines.length === 0) return []

  // 첫 줄이 헤더면 스킵
  let startIdx = 0
  const firstCells = lines[0].split(/\t|,/).map(c => c.trim())
  if (looksLikeHeader(firstCells)) startIdx = 1

  const result: ParsedRow[] = []
  const seen = new Set<string>()

  for (let i = startIdx; i < lines.length; i++) {
    const cells = lines[i].split(/\t|,/).map(c => c.trim())
    const email = (cells[0] || '').toLowerCase()
    const display_name = cells[1] || ''
    const division = cells[2] || ''
    const team = cells[3] || ''
    const roleRaw = cells[4] || ''
    const role = normalizeRole(roleRaw)

    let valid = true
    let warning: string | undefined
    if (!email) {
      valid = false; warning = '이메일 누락'
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      valid = false; warning = '이메일 형식 오류'
    } else if (seen.has(email)) {
      valid = false; warning = '입력 내 중복'
    }
    if (email) seen.add(email)

    result.push({ email, display_name, division, team, role, valid, warning })
  }

  return result
}

const SAMPLE = `email\t이름\t본부\t팀\t권한
hong@example.com\t홍길동\t테스트\t테스트1팀\t일반
kim@example.com\t김민재\t테스트\t테스트1팀\t리더`

interface BulkResult {
  succeeded: Array<{ email: string }>
  failed: Array<{ email: string; reason: string }>
  skipped: Array<{ email: string; reason: string }>
}

export default function BulkRegisterForm({ onDone }: BulkRegisterFormProps) {
  const [text, setText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<BulkResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const parsed = useMemo(() => parseInput(text), [text])
  const validCount = parsed.filter(r => r.valid).length

  const submit = async () => {
    if (validCount === 0) return
    setSubmitting(true)
    setError(null)
    setResult(null)
    try {
      const payload = parsed
        .filter(r => r.valid)
        .map(r => ({
          email: r.email,
          display_name: r.display_name || null,
          division: r.division || null,
          team: r.team || null,
          role: r.role,
        }))
      const res = await fetch('/api/admin/users/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ users: payload }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? '등록 실패')
        return
      }
      setResult(data as BulkResult)
    } catch (err) {
      setError(err instanceof Error ? err.message : '네트워크 오류')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="bg-info-bg border border-info-border rounded-lg p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-primary-700">계정 일괄 사전 등록</h3>
          <p className="mt-1 text-[12px] text-text-secondary">
            엑셀/스프레드시트에서 행을 복사해 붙여넣으세요. 컬럼 순서:&nbsp;
            <code className="px-1 py-0.5 bg-surface rounded text-[11px]">이메일 | 이름 | 본부 | 팀 | 권한</code>
            . 첫 줄이 헤더면 자동 스킵, 권한은 <code className="text-[11px]">일반/리더/관리자</code>(또는 <code className="text-[11px]">user/leader/admin</code>) 허용.
            <br />
            <span className="text-text-muted">약관/개인정보 동의는 사용자의 최초 로그인 시점에 별도로 받습니다.</span>
          </p>
        </div>
        <button
          type="button"
          onClick={onDone}
          className="shrink-0 inline-flex items-center justify-center h-8 w-8 rounded-md text-text-muted hover:bg-surface-muted"
          title="닫기"
          aria-label="닫기"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-[12px] font-semibold text-text-secondary">붙여넣기 (TSV 또는 CSV)</label>
          <button
            type="button"
            onClick={() => setText(SAMPLE)}
            className="text-[11px] text-primary-600 hover:underline inline-flex items-center gap-1"
          >
            <FileText className="h-3 w-3" aria-hidden /> 샘플 채우기
          </button>
        </div>
        <textarea
          rows={6}
          value={text}
          onChange={e => { setText(e.target.value); setResult(null); setError(null) }}
          placeholder={`email\t이름\t본부\t팀\t권한\nuser1@example.com\t...\t...\t...\t일반\n...`}
          className="w-full min-h-[120px] border border-border-strong rounded-md p-3 text-[13px] font-mono bg-surface focus:outline-none focus:ring-1 focus:ring-primary-500 whitespace-pre"
        />
      </div>

      {/* 미리보기 */}
      {parsed.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-[12px]">
            <span className="text-text-secondary">
              파싱된 행: <span className="font-semibold text-text-primary">{parsed.length}</span>
              {' / 유효: '}<span className="font-semibold text-success-text">{validCount}</span>
              {' / 문제: '}<span className="font-semibold text-danger-text">{parsed.length - validCount}</span>
            </span>
          </div>
          <div className="border border-border rounded-md overflow-hidden bg-surface">
            <div className="overflow-x-auto max-h-[280px]">
              <table className="w-full border-collapse text-[12px]">
                <thead className="bg-surface-muted sticky top-0">
                  <tr>
                    <th className="px-2 py-1.5 text-left font-semibold text-text-secondary">#</th>
                    <th className="px-2 py-1.5 text-left font-semibold text-text-secondary">이메일</th>
                    <th className="px-2 py-1.5 text-left font-semibold text-text-secondary">이름</th>
                    <th className="px-2 py-1.5 text-left font-semibold text-text-secondary">본부</th>
                    <th className="px-2 py-1.5 text-left font-semibold text-text-secondary">팀</th>
                    <th className="px-2 py-1.5 text-left font-semibold text-text-secondary">권한</th>
                    <th className="px-2 py-1.5 text-left font-semibold text-text-secondary">상태</th>
                  </tr>
                </thead>
                <tbody>
                  {parsed.map((r, i) => (
                    <tr key={i} className={r.valid ? '' : 'bg-danger-bg/40'}>
                      <td className="px-2 py-1 text-text-muted tabular-nums">{i + 1}</td>
                      <td className="px-2 py-1 text-text-primary">{r.email || '-'}</td>
                      <td className="px-2 py-1 text-text-primary">{r.display_name || '-'}</td>
                      <td className="px-2 py-1 text-text-primary">{r.division || '-'}</td>
                      <td className="px-2 py-1 text-text-primary">{r.team || '-'}</td>
                      <td className="px-2 py-1 text-text-primary">{r.role}</td>
                      <td className="px-2 py-1">
                        {r.valid ? (
                          <span className="inline-flex items-center gap-1 text-success-text">
                            <Check className="h-3 w-3" aria-hidden /> 유효
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-danger-text" title={r.warning}>
                            <AlertCircle className="h-3 w-3" aria-hidden /> {r.warning}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* 액션 */}
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onDone}
          className="px-3 py-1.5 text-sm rounded-md border border-border-strong text-text-secondary hover:bg-surface-muted"
        >
          취소
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={submitting || validCount === 0}
          className="inline-flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium rounded-md bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50"
        >
          {submitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
          {validCount > 0 ? `${validCount}건 일괄 등록` : '등록할 행 없음'}
        </button>
      </div>

      {error && (
        <div className="rounded-md bg-danger-bg border border-danger-border p-3 text-[13px] text-danger-text">
          {error}
        </div>
      )}

      {/* 결과 */}
      {result && (
        <div className="space-y-2">
          <div className="flex items-center gap-3 text-[12px]">
            <span className="text-success-text">
              ✓ 성공 <span className="font-semibold">{result.succeeded.length}</span>
            </span>
            <span className="text-warning-text">
              ⏭ 스킵 <span className="font-semibold">{result.skipped.length}</span>
            </span>
            <span className="text-danger-text">
              ✗ 실패 <span className="font-semibold">{result.failed.length}</span>
            </span>
          </div>

          {(result.skipped.length > 0 || result.failed.length > 0) && (
            <div className="border border-border rounded-md bg-surface max-h-[180px] overflow-y-auto">
              <ul className="text-[12px] divide-y divide-border">
                {result.skipped.map((s, i) => (
                  <li key={`s${i}`} className="flex justify-between gap-2 px-3 py-1.5">
                    <span className="text-text-primary truncate">{s.email}</span>
                    <span className="text-warning-text shrink-0">⏭ {s.reason}</span>
                  </li>
                ))}
                {result.failed.map((s, i) => (
                  <li key={`f${i}`} className="flex justify-between gap-2 px-3 py-1.5">
                    <span className="text-text-primary truncate">{s.email}</span>
                    <span className="text-danger-text shrink-0">✗ {s.reason}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {result.succeeded.length > 0 && (
            <button
              type="button"
              onClick={onDone}
              className="text-[12px] text-primary-600 hover:underline"
            >
              완료 — 목록으로 돌아가기
            </button>
          )}
        </div>
      )}
    </div>
  )
}
