-- 003_notification_logs.sql
-- Teams 알림 발송 시도 내역과 결과(SUCCESS/FAILURE/SKIPPED)를 저장하는 테이블
-- 이미 수동으로 실행된 환경에서도 안전하게 재실행할 수 있도록 idempotent하게 작성

CREATE TABLE IF NOT EXISTS public.notification_logs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    event_type TEXT NOT NULL,
    status TEXT NOT NULL,
    department TEXT,
    team_name TEXT,
    target_id TEXT,
    payload JSONB,
    error_message TEXT
);

-- 최근순 조회를 위한 created_at 인덱스 (admin 페이지가 created_at desc로 limit 500)
CREATE INDEX IF NOT EXISTS idx_notification_logs_created_at
    ON public.notification_logs (created_at DESC);

-- status / event_type 별 빠른 필터링용 보조 인덱스
CREATE INDEX IF NOT EXISTS idx_notification_logs_status
    ON public.notification_logs (status);

CREATE INDEX IF NOT EXISTS idx_notification_logs_event_type
    ON public.notification_logs (event_type);

-- RLS 활성화 (서버 API는 service_role을 통해 RLS bypass)
ALTER TABLE public.notification_logs ENABLE ROW LEVEL SECURITY;

-- 기존 정책이 있으면 제거 후 재생성 (idempotent)
DROP POLICY IF EXISTS "Admin users can view notification_logs"
    ON public.notification_logs;

-- 클라이언트에서 직접 조회할 경우를 대비한 admin 전용 SELECT 정책
-- (admin 페이지는 service_role을 사용하므로 이 정책 없이도 동작)
CREATE POLICY "Admin users can view notification_logs"
    ON public.notification_logs
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles p
            WHERE p.id = auth.uid()
              AND p.role = 'admin'
              AND p.is_blocked = false
        )
    );
