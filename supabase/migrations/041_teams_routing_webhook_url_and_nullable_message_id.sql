-- 041_teams_routing_webhook_url_and_nullable_message_id.sql
-- 2026-05-27 (v1.50): 라우팅별 webhook URL 옵션 + message_id NOT NULL 해제.
--
-- 정책 (사용자 결정 2026-05-27):
--   - webhook_url NULL이면 기존 env var MAKE_WEBHOOK_URL로 발송 (회귀 위험 0).
--   - webhook_url 있으면 그 URL로 payload POST (Power Automate / 다른 워크플로우 라우팅별 지원).
--   - 채널 새 메시지 방식 라우팅(Power Automate)은 thread root message_id 미사용 → NULL 허용.
--
-- 사용자 책임:
--   - Power Automate 워크플로우 만들고 URL을 라우팅 모달에 입력.
--   - 그 워크플로우가 기존 N-Click payload schema {teamId, channelId, messageId, message, ...}
--     를 그대로 받을 수 있어야 함 (사용자 측 JSON 구문 분석에서 필요 field만 추출).

ALTER TABLE teams_routing
  ADD COLUMN IF NOT EXISTS webhook_url text;

COMMENT ON COLUMN teams_routing.webhook_url IS
  '라우팅별 webhook URL (v1.50, 2026-05-27). NULL이면 환경변수 MAKE_WEBHOOK_URL 사용. 채워져 있으면 그 URL로 payload POST (Power Automate / 다른 워크플로우 지원).';

-- message_id NULL 허용 — 채널 새 메시지 방식 라우팅은 thread root 미사용.
ALTER TABLE teams_routing
  ALTER COLUMN message_id DROP NOT NULL;

COMMENT ON COLUMN teams_routing.message_id IS
  'Thread root 메시지 ID (thread reply 방식). 채널 새 메시지 방식 라우팅은 NULL (v1.50).';
