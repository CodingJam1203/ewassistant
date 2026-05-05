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

-- Enable RLS but allow admin client access
ALTER TABLE public.notification_logs ENABLE ROW LEVEL SECURITY;

-- Allow read access to admin roles (if any specific RLS is needed, else adminClient bypasses it)
-- Since we use service_role key for admin API, RLS policies are bypassed for server inserts.
-- If you want to view it from the client with admin role:
CREATE POLICY "Admin users can view notification_logs"
    ON public.notification_logs
    FOR SELECT
    USING (
        auth.jwt() ->> 'email' = 'hrb.main@gmail.com'
    );
