import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdmin } from '@/lib/admin-check'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Badge, TableContainer, TableScroll, Table, Th, Td, TR_HOVER, PageHeader } from '@/components/ui'
import type { BadgeVariant } from '@/components/ui'

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

function statusVariant(status: string): BadgeVariant {
  if (status === 'SUCCESS') return 'success'
  if (status === 'FAILURE') return 'danger'
  return 'warning'
}

export default async function NotificationsAdminPage() {
  const adminUser = await requireAdmin()
  if (!adminUser) redirect('/login')

  const adminClient = createAdminClient()

  // 최근 500건
  const { data: logs, error } = await adminClient
    .from('notification_logs')
    .select('id, created_at, event_type, status, department, team_name, error_message')
    .order('created_at', { ascending: false })
    .limit(500)

  if (error) {
    console.error('Failed to load notification logs:', error)
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="알림 발송 내역"
        description="Make Webhook을 통해 발송된 Teams 알림의 최근 500건 이력을 조회합니다."
        actions={
          <Link
            href="/admin"
            className="inline-flex items-center justify-center h-10 px-4 rounded-[10px] border border-border-strong text-sm font-medium text-text-primary bg-surface hover:bg-surface-muted transition-colors"
          >
            관리자 홈으로
          </Link>
        }
      />

      <TableContainer>
        <TableScroll>
          <Table>
            <thead>
            <tr>
              <Th>발송 일시</Th>
              <Th>상태</Th>
              <Th>이벤트 유형</Th>
              <Th>대상 (본부/팀)</Th>
              <Th>실패 사유</Th>
            </tr>
          </thead>
          <tbody>
            {(!logs || logs.length === 0) && (
              <tr>
                <td colSpan={5} className="px-4 py-12 text-center text-[13px] text-text-muted">
                  발송 이력이 없습니다.
                </td>
              </tr>
            )}
            {logs?.map((log: NotificationLog) => (
              <tr key={log.id} className={TR_HOVER}>
                <Td className="text-text-primary tabular-nums">
                  {new Date(log.created_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}
                </Td>
                <Td>
                  <Badge variant={statusVariant(log.status)} dot>{log.status}</Badge>
                </Td>
                <Td muted>{log.event_type}</Td>
                <Td muted>
                  {log.department ? `${log.department} / ${log.team_name}` : '-'}
                </Td>
                <Td className="max-w-xs truncate text-text-muted" title={log.error_message || ''}>
                  {log.error_message || '-'}
                </Td>
              </tr>
            ))}
            </tbody>
          </Table>
        </TableScroll>
      </TableContainer>
    </div>
  )
}
