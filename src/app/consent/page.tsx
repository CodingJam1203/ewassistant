'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'

export default function ConsentPage() {
  const [displayName, setDisplayName] = useState('')
  const [agreedTerms, setAgreedTerms] = useState(false)
  const [agreedPrivacy, setAgreedPrivacy] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState('')
  const router = useRouter()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmedName = displayName.trim()
    if (!trimmedName) {
      setError('이름을 입력해 주세요.')
      return
    }
    if (trimmedName.length > 50) {
      setError('이름은 50자 이하로 입력해 주세요.')
      return
    }
    if (!agreedTerms || !agreedPrivacy) {
      setError('모든 필수 항목에 동의해 주세요.')
      return
    }

    setIsSubmitting(true)
    setError('')

    // 무한 로딩 방지 (티켓: /consent 무한 로딩 — 신규 가입자 진입 차단)
    // 15초 timeout — 서버 hang 시 사용자에게 에러 표시 + retry 가능 상태로 복귀.
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 15000)

    try {
      const res = await fetch('/api/auth/consent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: trimmedName }),
        signal: controller.signal,
      })

      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || '동의 처리 중 오류가 발생했습니다.')
      }

      // API가 반환한 redirectTo 사용 (활성 계정 → /team, 잠금 계정 → /blocked)
      // router.push가 middleware 차단 등으로 페이지 전환 실패해도 isSubmitting을
      // 풀어주기 위해 명시적으로 false 처리 (next/navigation push는 Promise 반환 안 함).
      setIsSubmitting(false)
      router.push(data.redirectTo ?? '/team')
      router.refresh()
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        setError('서버 응답이 너무 오래 걸립니다. 잠시 후 다시 시도해 주세요.')
      } else {
        setError(err?.message ?? '동의 처리 중 오류가 발생했습니다.')
      }
      setIsSubmitting(false)
    } finally {
      clearTimeout(timeoutId)
    }
  }

  return (
    <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8 bg-surface p-8 rounded-2xl shadow-[var(--shadow-card)] border border-border">
        <div>
          <h2 className="mt-2 text-center text-2xl font-bold text-text-primary tracking-tight">
            서비스 이용 동의
          </h2>
          <p className="mt-2 text-center text-sm text-text-secondary">
            원활한 서비스 이용을 위해 아래 약관 및 개인정보 수집·이용에 동의해 주세요.
          </p>
        </div>

        <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
          <div className="space-y-4">
            <div>
              <label htmlFor="displayName" className="block text-[12px] font-semibold text-text-secondary">
                이름 <span className="text-danger-text">*</span>
              </label>
              <input
                id="displayName"
                name="displayName"
                type="text"
                required
                maxLength={50}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="예: 김도담"
                className="mt-1.5 block w-full h-10 px-3 rounded-[10px] border border-border-strong bg-surface text-sm placeholder:text-text-muted focus:outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20"
                autoComplete="name"
              />
              <p className="mt-1.5 text-[12px] text-text-muted">
                관리자가 가입자를 식별할 수 있도록 본인의 이름을 입력해 주세요.
              </p>
            </div>

            <div className="flex items-start gap-3">
              <input
                id="terms"
                name="terms"
                type="checkbox"
                checked={agreedTerms}
                onChange={(e) => setAgreedTerms(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-border-strong text-primary-600 focus:ring-primary-500"
              />
              <div className="text-sm flex-1">
                <label htmlFor="terms" className="font-medium text-text-primary select-none">
                  [필수] 이용약관에 동의합니다.
                </label>
                <div className="mt-1">
                  <a href="/terms" target="_blank" rel="noopener noreferrer" className="text-primary-600 hover:text-primary-700 text-[12px] font-semibold">
                    이용약관 보기 &rarr;
                  </a>
                </div>
              </div>
            </div>

            {/* 개인정보 수집·이용 동의 — 처리방침(공개·고지 문서)과 분리.
                동의는 '수집·이용'에 대해 받고, 필수 4요소(항목·목적·기간·거부권)를 명시한다.
                처리방침은 동의 대상이 아니라 하단 공개 링크로 열람만 제공. */}
            <div className="space-y-2">
              <div className="rounded-[10px] border border-border bg-surface-muted/50 p-3 max-h-52 overflow-y-auto text-[12px] leading-relaxed text-text-secondary space-y-2.5">
                <p className="font-semibold text-text-primary text-[13px]">개인정보 수집·이용 동의 (필수)</p>
                <div>
                  <p className="font-semibold text-text-primary">① 수집 항목</p>
                  <p>(필수) 이메일, 이름, 본부, 팀, 계정 권한·상태, 출퇴근보고 내용(근무일·출퇴근 예정시간·휴게시간·EW 시작/종료시간·근무장소·근무내용 등), 출근/퇴근/휴게/근무지 변경 상태값, 제출·수정·삭제 일시 및 수정자·삭제자 정보 · (자동 생성) 로그인 일시, 최근 제출일, 계정 생성일, 상태 변경 이력, 접속·오류 로그</p>
                </div>
                <div>
                  <p className="font-semibold text-text-primary">② 이용 목적</p>
                  <p>임직원 계정 식별·권한 관리, 출퇴근보고 제출·조회, 근태(근무일·시간·휴게·장소·상태) 관리, 본부/팀 단위 근무현황 확인, 관리자 승인·계정 관리, 제출 내역 수정·삭제 이력 관리, 내부 인사노무 및 근태관리, 시스템 오류 확인·보안·부정 이용 방지</p>
                </div>
                <div>
                  <p className="font-semibold text-text-primary">③ 보유·이용 기간</p>
                  <p>임직원 재직 기간 동안 보유하며, 퇴사 또는 계정 비활성화 후에도 관련 법령·내부 감사·노무 분쟁 대응·근태 기록 확인을 위해 필요한 기간 동안 보관할 수 있습니다. 구체적인 기간은 회사의 내부 인사노무 기록 보존 기준에 따릅니다.</p>
                </div>
                <div>
                  <p className="font-semibold text-text-primary">④ 동의 거부 권리 및 불이익</p>
                  <p>귀하는 위 개인정보 수집·이용에 대한 동의를 거부할 권리가 있습니다. 다만 위 항목은 출퇴근보고 시스템 이용에 반드시 필요한 필수 정보이므로, 동의를 거부하실 경우 계정 생성 및 서비스(출퇴근보고) 이용이 제한됩니다.</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <input
                  id="privacy"
                  name="privacy"
                  type="checkbox"
                  checked={agreedPrivacy}
                  onChange={(e) => setAgreedPrivacy(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-border-strong text-primary-600 focus:ring-primary-500"
                />
                <label htmlFor="privacy" className="text-sm flex-1 font-medium text-text-primary select-none">
                  [필수] 개인정보 수집·이용에 동의합니다.
                </label>
              </div>
            </div>
          </div>

          {error && (
            <div className="text-sm text-danger-text bg-danger-bg border border-danger-border p-3 rounded-[10px]">
              {error}
            </div>
          )}

          <div>
            <button
              type="submit"
              disabled={isSubmitting || !agreedTerms || !agreedPrivacy || !displayName.trim()}
              className="w-full inline-flex justify-center items-center gap-2 h-12 px-5 rounded-[10px] text-base font-semibold text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-primary-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isSubmitting ? (
                <Loader2 className="animate-spin w-5 h-5" aria-hidden />
              ) : (
                '동의하고 시작하기'
              )}
            </button>
          </div>

          {/* 처리방침은 동의 대상이 아닌 공개·고지 문서 — 열람 링크만 제공 */}
          <p className="text-center text-[12px] text-text-muted">
            회사의 개인정보 처리방침은{' '}
            <a href="/privacy" target="_blank" rel="noopener noreferrer" className="text-primary-600 hover:text-primary-700 font-semibold">
              여기
            </a>
            에서 확인하실 수 있습니다.
          </p>
        </form>
      </div>
    </div>
  )
}
