/**
 * Make Custom Webhook을 통해 Microsoft Teams에 메시지를 전송합니다.
 * 환경변수 EXTERNAL_TEAMS_WEBHOOK_URL이 비어있으면 전송을 건너뜁니다.
 * 이 모듈은 서버(API Route)에서만 사용합니다 — 클라이언트에 URL이 노출되지 않습니다.
 */

export interface ExternalWebhookPayload {
  /** 사용자 이름 */
  name: string
  /** 사용자 이메일 */
  email: string
  /** 근무 날짜 (yyyy-MM-dd) */
  workDate: string
  /** 근무 장소 */
  workPlace: string
  /** 출근 시간 (HH:mm) */
  startTime: string
  /** 퇴근 시간 (HH:mm) */
  endTime: string
  /** 휴게 시간 (HH:mm) */
  breakTime: string
  /** EW 시작 시간 (HH:mm) */
  ewStartTime: string
  /** EW 종료 시간 또는 L코드 */
  ewEndTime: string
  /** 지각/출근수정 여부 ('아니오' | '예') */
  lateType: string
  /** 지각/출근수정 사유 */
  lateReason: string
  /** 출근보고 유형 */
  morningReportType: string
  /** 출근보고 상세 (날짜 / 시간 / 장소) */
  morningReportReason: string
  /** 근무내용 + 감사 마카롱 메시지 */
  note: string
}

/**
 * Make Custom Webhook URL로 POST 요청을 보냅니다.
 *
 * - URL이 비어있으면 조용히 건너뜁니다.
 * - 전송 실패 시 Error를 throw합니다 (호출부에서 catch하여 처리).
 */
export async function sendExternalWebhook(payload: ExternalWebhookPayload): Promise<void> {
  const webhookUrl = process.env.EXTERNAL_TEAMS_WEBHOOK_URL

  if (!webhookUrl) {
    console.log('[Webhook] EXTERNAL_TEAMS_WEBHOOK_URL이 설정되지 않아 전송을 건너뜁니다.')
    return
  }

  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    const responseText = await response.text().catch(() => '(응답 없음)')
    throw new Error(
      `[Webhook] 전송 실패: HTTP ${response.status} ${response.statusText} — ${responseText}`
    )
  }
}
