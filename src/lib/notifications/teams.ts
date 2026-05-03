/**
 * Teams / 외부 알림 유틸리티
 *
 * 현재: console.log / TODO 처리
 * 추후: Make Webhook / Power Automate / Teams API 연결
 *
 * 환경변수:
 *   EXTERNAL_TEAMS_WEBHOOK_URL - Make 또는 Power Automate Webhook URL
 */

// ─── 타입 ────────────────────────────────────────────────────────────────────

export interface WorkLogSnapshot {
  startTime: string
  endTime: string
  workPlace: string
  breakTime?: string
  workContent?: string
  ewValue?: string
}

export interface WorkLogUpdatedPayload {
  type: 'work_log_updated'
  workLogId: string
  updatedBy: string        // 수정자 email
  userEmail: string        // 원 제출자 email
  name: string             // 제출자 이름
  workDate: string         // 근무일 (YYYY-MM-DD)
  before: WorkLogSnapshot
  after: WorkLogSnapshot
  updatedAt: string
}

// ─── 출퇴근보고 수정 알림 ────────────────────────────────────────────────────

/**
 * 출퇴근보고 수정 시 Teams 알림 발송 (틀)
 *
 * TODO: 아래 주석을 해제하고 Webhook URL을 설정하면 실제 알림이 발송됩니다.
 */
export async function notifyWorkLogUpdated(
  payload: WorkLogUpdatedPayload
): Promise<void> {
  // ── TODO: 실제 발송 구현 ─────────────────────────────────────────────────
  //
  // const webhookUrl = process.env.EXTERNAL_TEAMS_WEBHOOK_URL
  // if (!webhookUrl) {
  //   console.warn('[Teams] EXTERNAL_TEAMS_WEBHOOK_URL 미설정 — 알림 스킵')
  //   return
  // }
  //
  // await fetch(webhookUrl, {
  //   method: 'POST',
  //   headers: { 'Content-Type': 'application/json' },
  //   body: JSON.stringify(payload),
  // })
  // ────────────────────────────────────────────────────────────────────────

  // 현재: 콘솔 출력으로 대체
  console.log('[Teams] 출퇴근보고 수정 알림 (미발송)')
  console.log('  작업자  :', payload.updatedBy)
  console.log('  대상자  :', payload.userEmail, '/', payload.name)
  console.log('  근무일  :', payload.workDate)
  console.log('  수정 전 :', JSON.stringify(payload.before))
  console.log('  수정 후 :', JSON.stringify(payload.after))
}
