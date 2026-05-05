import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdmin } from '@/lib/admin-check'
import { redirect } from 'next/navigation'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

interface NotificationLog {
  id: string
  created_at: string
  event_type: string
  status: string
  department: string | null
  team_name: string | null
  error_message: string | null
}

export default async function NotificationsAdminPage() {
  const adminUser = await requireAdmin()

  if (!adminUser) {
    redirect('/login')
  }

  const adminClient = createAdminClient()

  // 2. 이력 조회 (최근 500건)
  const { data: logs, error } = await adminClient
    .from('notification_logs')
    .select('id, created_at, event_type, status, department, team_name, error_message')
    .order('created_at', { ascending: false })
    .limit(500)

  if (error) {
    console.error('Failed to load notification logs:', error)
  }

  return (
    <div className="max-w-6xl mx-auto p-4 sm:p-6 pb-20">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">알림 발송 내역 (Make Webhook)</h1>
        <Link
          href="/admin"
          className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded hover:bg-gray-200 dark:text-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700"
        >
          관리자 홈으로 돌아가기
        </Link>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead className="bg-gray-50 dark:bg-gray-900">
              <tr>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">발송 일시</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">상태</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">이벤트 유형</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">대상 (본부/팀)</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">실패 사유</th>
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
              {(!logs || logs.length === 0) && (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
                    발송 이력이 없습니다.
                  </td>
                </tr>
              )}
              {logs?.map((log: NotificationLog) => (
                <tr key={log.id} className="hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100">
                    {new Date(log.created_at).toLocaleString('ko-KR')}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm">
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                      log.status === 'SUCCESS' ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' :
                      log.status === 'FAILURE' ? 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200' :
                      'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200'
                    }`}>
                      {log.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                    {log.event_type}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                    {log.department ? `${log.department} / ${log.team_name}` : '-'}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-500 dark:text-gray-400 max-w-xs truncate" title={log.error_message || ''}>
                    {log.error_message || '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
