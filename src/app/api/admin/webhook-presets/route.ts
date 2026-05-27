import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-check'

/**
 * GET /api/admin/webhook-presets
 *
 * v1.54 (2026-05-27) — Power Automate webhook URL preset 응답 (admin 전용).
 *
 * 보안:
 *   - 종전 admin/teams-routing/page.tsx의 const WEBHOOK_PRESETS array에 trigger URL을
 *     박아두었다가 commit으로 GitHub 노출 → GitGuardian 감지(v1.53 hotfix). 본 endpoint는
 *     URL을 코드 대신 server-only env var(`POWER_AUTOMATE_WEBHOOK_REPLY`/`_NEW`)에 두고
 *     `requireAdmin` 통과 시에만 응답하도록 분리.
 *   - 응답을 본 admin이 외부 유출시키는 경우는 신뢰 경계 내 이슈(별도 audit/통제 대상).
 *
 * 응답 형식:
 *   [{ value: string, label: string, hint: string }]
 *   - value='' default 항목은 항상 포함 (env MAKE_WEBHOOK_URL fallback)
 *   - Power Automate preset은 해당 env var 가 설정된 경우에만 포함
 */
export async function GET() {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const presets: Array<{ value: string; label: string; hint: string }> = [
    {
      value: '',
      label: 'default (Make / thread reply)',
      hint: 'env MAKE_WEBHOOK_URL 사용. Anchor Message ID 필요.',
    },
  ]

  const replyUrl = process.env.POWER_AUTOMATE_WEBHOOK_REPLY
  if (replyUrl) {
    presets.push({
      value: replyUrl,
      label: 'Power Automate — 채널 내 게시글 회신',
      hint: 'thread reply 방식. Anchor Message ID 필요.',
    })
  }

  const newUrl = process.env.POWER_AUTOMATE_WEBHOOK_NEW
  if (newUrl) {
    presets.push({
      value: newUrl,
      label: 'Power Automate — 채널에 새 메시지',
      hint: 'new message 방식. Anchor Message ID 비워두기.',
    })
  }

  return NextResponse.json({ presets }, {
    headers: {
      // server-only env이지만 응답 자체는 캐시 X — admin이 env rotate 후 새로고침 시 즉시 반영.
      'Cache-Control': 'no-store',
    },
  })
}
