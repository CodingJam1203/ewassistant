import LoginForm from '@/components/LoginForm'
import NClickLogo from '@/components/NClickLogo'

export default function LoginPage() {
  return (
    <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8 bg-surface p-8 rounded-2xl shadow-[var(--shadow-card)] border border-border">
        <div className="flex flex-col items-center">
          <NClickLogo className="h-12 w-auto mb-4" />
          <p className="mt-2 text-center text-sm text-text-secondary">
            NHR 출퇴근보고 및 EW 계산 보조 서비스
          </p>
        </div>
        <LoginForm />
      </div>
    </div>
  )
}
