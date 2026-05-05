-- 007_leave_calendar_cache.sql
-- 외부 Google Sheets 휴가 캘린더 결과 캐시 테이블
--
-- 키 형식: 'calendar:YYYY-MM-DD' (일별 batch — 한 row에 두 본부 데이터 모두 저장)
-- TTL: 30분 (애플리케이션 측에서 updated_at 기준 비교)
-- 갱신 시점: 사용자 요청 캐시 미스 시 + 매일 07:00 KST cron 강제 갱신
--
-- 멀티 인스턴스 환경(Vercel serverless 등)에서 메모리 캐시는 인스턴스 간 공유되지 않으므로
-- DB에 저장하여 일관성 확보.

CREATE TABLE IF NOT EXISTS public.leave_calendar_cache (
    key TEXT PRIMARY KEY,
    data JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE  public.leave_calendar_cache IS
    '외부 Google Sheets 휴가 캘린더 batch 응답 캐시. 일자별 1 row.';
COMMENT ON COLUMN public.leave_calendar_cache.key IS
    '캐시 키 — "calendar:YYYY-MM-DD" 형식';
COMMENT ON COLUMN public.leave_calendar_cache.data IS
    'Apps Script Web App 응답 — { date, departments: { "본부명": [{name, cellValue}] } }';
COMMENT ON COLUMN public.leave_calendar_cache.updated_at IS
    'TTL 비교용. 30분 초과 시 stale → 재호출 (실패 시 stale fallback)';

CREATE INDEX IF NOT EXISTS idx_leave_calendar_cache_updated_at
    ON public.leave_calendar_cache (updated_at DESC);

-- RLS: service_role만 읽기/쓰기 (서버 API에서 adminClient로만 접근)
ALTER TABLE public.leave_calendar_cache ENABLE ROW LEVEL SECURITY;
-- 별도 policy 없음 → 일반 client에서 접근 불가, service_role bypass
