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

    try {
      const res = await fetch('/api/auth/consent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: trimmedName }),
      })

      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || '동의 처리 중 오류가 발생했습니다.')
      }

      // API가 반환한 redirectTo 사용 (활성 계정 → /team, 잠금 계정 → /blocked)
      router.push(data.redirectTo ?? '/team')
      router.refresh()
    } catch (err: any) {
      setError(err.message)
      setIsSubmitting(false)
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
            원활한 서비스 이용을 위해 아래 정책에 동의해 주세요.
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

            <div className="flex items-start gap-3">
              <input
                id="privacy"
                name="privacy"
                type="checkbox"
                checked={agreedPrivacy}
                onChange={(e) => setAgreedPrivacy(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-border-strong text-primary-600 focus:ring-primary-500"
              />
              <div className="text-sm flex-1">
                <label htmlFor="privacy" className="font-medium text-text-primary select-none">
                  [필수] 개인정보 처리방침을 확인하고 동의합니다.
                </label>
                <div className="mt-1">
                  <a href="/privacy" target="_blank" rel="noopener noreferrer" className="text-primary-600 hover:text-primary-700 text-[12px] font-semibold">
                    개인정보 처리방침 보기 &rarr;
                  </a>
                </div>
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
        </form>
      </div>
    </div>
  )
}
