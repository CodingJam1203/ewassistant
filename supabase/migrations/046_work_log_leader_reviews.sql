-- v1.73 Phase 1: 리더 관리 뷰 — 리더가 팀원 보고에 피드백(체크완료/미상신/오상신)을 박는 기능.
--
-- 1. 신규 테이블 work_log_leader_reviews
--    - 한 보고당 1 리뷰만 (UNIQUE work_log_id) — 마지막 reviewer가 최신 상태 박음
--    - status NOT NULL — 미선택(NULL)은 row 미존재로 표현
--    - 본인 보고가 삭제되면 review도 CASCADE (work_logs.is_deleted=true는 별개 soft delete라 무관)
--
-- 2. 신규 컬럼 org_teams.use_leader_review
--    - 팀별 기능 ON/OFF 토글. 기본 false (회귀 0).
--    - admin UI에서 team row 토글로 변경.

CREATE TABLE IF NOT EXISTS public.work_log_leader_reviews (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_log_id     uuid NOT NULL UNIQUE REFERENCES public.work_logs(id) ON DELETE CASCADE,
  reviewer_email  text NOT NULL,
  status          text NOT NULL CHECK (status IN ('checked', 'missing', 'wrong')),
  note            text,
  reviewed_at     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.work_log_leader_reviews IS
  'v1.73: 리더가 팀원 보고에 박는 피드백. status: checked(체크완료) / missing(미상신) / wrong(오상신). UNIQUE(work_log_id)로 한 보고당 1 리뷰만, 마지막 reviewer가 최신.';

COMMENT ON COLUMN public.work_log_leader_reviews.work_log_id IS '대상 보고 work_logs.id. CASCADE 삭제.';
COMMENT ON COLUMN public.work_log_leader_reviews.reviewer_email IS '리뷰 박은 리더 이메일.';
COMMENT ON COLUMN public.work_log_leader_reviews.status IS 'checked=체크완료(녹) / missing=미상신(빨) / wrong=오상신(빨). 미선택은 row 미존재.';

-- 조회 효율: reviewer_email로 필터링 (예: 본인이 박은 review 목록), status로 미상신/오상신 필터링
CREATE INDEX IF NOT EXISTS idx_leader_reviews_reviewer ON public.work_log_leader_reviews(reviewer_email);
CREATE INDEX IF NOT EXISTS idx_leader_reviews_status ON public.work_log_leader_reviews(status);


ALTER TABLE public.org_teams
  ADD COLUMN IF NOT EXISTS use_leader_review boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.org_teams.use_leader_review IS
  'v1.73: 팀별 리더 관리 뷰 기능 ON/OFF. false(기본)면 해당 팀 리더에게 제출내역의 리더관리 탭 hide. admin이 admin UI에서 토글.';
