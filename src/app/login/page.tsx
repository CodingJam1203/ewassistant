import LoginForm from '@/components/LoginForm'

export default function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8 bg-white p-8 rounded-xl shadow-sm border border-gray-100">
        <div>
          <h2 className="mt-2 text-center text-3xl font-extrabold text-gray-900 tracking-tight">
            EW Assistant
          </h2>
          <p className="mt-2 text-center text-sm text-gray-600">
            출퇴근보고 및 EW 복사용 문구 생성 툴
          </p>
        </div>
        <LoginForm />
      </div>
    </div>
  )
}
