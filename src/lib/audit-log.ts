/**
 * audit_logs 테이블에 관리자 작업 등 중요 액션을 기록하는 헬퍼.
 *
 * - service_role(createAdminClient)로 INSERT 수행 → RLS 우회
 * - 실패해도 호출자 흐름은 막지 않음 (fire-and-forget, 로깅만)
 * - 호출처: 관리자 PATCH/DELETE, work-logs PATCH/DELETE 등 민감한 작업
 *
 * 기록되는 정보 (PII 최소화):
 *   - actor_id: 작업자 user.id
 *   - actor_email: 작업자 email (감사 목적상 필요. 클라이언트에는 노출 안 함)
 *   - action: 'admin_user_update' 등 자유 텍스트 코드
 *   - target_table: 'user_profiles' 등
 *   - target_id: 대상 row의 PK (UUID 또는 string)
 *   - details: jsonb — 변경 전후 값, 사유 등 (민감하지 않은 메타데이터만)
 */

import { createAdminClient } from '@/lib/supabase/admin'

export interface AuditLogInput {
  actorId: string
  actorEmail?: string | null
  action: string
  targetTable?: string | null
  targetId?: string | null
  details?: Record<string, unknown> | null
  ipAddress?: string | null
  userAgent?: string | null
}

/**
 * 감사 로그 INSERT — 절대 throw하지 않음. 실패 시 콘솔 로깅만.
 */
export async function recordAudit(input: AuditLogInput): Promise<void> {
  try {
    const adminClient = createAdminClient()
    const { error } = await adminClient.from('audit_logs').insert({
      actor_id: input.actorId,
      actor_email: input.actorEmail ?? null,
      action: input.action,
      target_table: input.targetTable ?? null,
      target_id: input.targetId ?? null,
      details: input.details ?? null,
      ip_address: input.ipAddress ?? null,
      user_agent: input.userAgent ?? null,
    })
    if (error) {
      console.warn('[audit] insert failed:', error.code, error.message)
    }
  } catch (err) {
    // 감사 로그 실패는 메인 로직에 영향을 주지 않음
    console.warn('[audit] insert exception:', err)
  }
}

/**
 * Request 헤더에서 IP, User-Agent 추출 헬퍼.
 * Vercel/Next.js 환경에서 일반적으로 동작.
 */
export function extractRequestMeta(request: Request): { ipAddress: string | null; userAgent: string | null } {
  const headers = request.headers
  const ipAddress =
    headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    headers.get('x-real-ip') ||
    null
  const userAgent = headers.get('user-agent') || null
  return { ipAddress, userAgent }
}
