import LoginForm from '@/components/LoginForm'
import NClickLogo from '@/components/NClickLogo'

export default function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8 bg-white dark:bg-gray-800 p-8 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700">
        <div className="flex flex-col items-center">
          <NClickLogo className="h-12 w-auto mb-4" />
          <p className="mt-2 text-center text-sm text-gray-600 dark:text-gray-400">
            NHR 출퇴근보고 및 EW 계산 보조 서비스
          </p>
        </div>
        <LoginForm />
      </div>
    </div>
  )
}
