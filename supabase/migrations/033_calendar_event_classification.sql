-- Phase 1.5 후속 (2026-05-21) — 캘린더별 이벤트 분류 정책
--
-- 배경:
--   기존 inferEventType은 calendar_type='vacation'이면 제목 무관 전부 vacation 분류.
--   ① 휴가/미팅을 한 캘린더에 다 쌓는 팀 → vacation으로 등록하면 미팅까지 휴가 오분류.
--   ② 분리 운영 본부(HR임팩트 등)의 vacation 캘린더에 회의 키워드 섞인 휴가성 이벤트
--      (예: "예비군 교육훈련")가 있어, 제목 키워드 강제 분류는 부작용.
--
-- 해결: 캘린더마다 분류 모드를 둔다.
--   - 'by_type'  (기본, 분리 운영): calendar_type을 따름. 단 제목에 휴가 텍스트 있으면 vacation.
--                기존 동작 보존 — 모든 기존 캘린더가 이 모드라 영향 0.
--   - 'by_title' (통합 운영): 제목에 휴가 텍스트 있을 때만 vacation, 없으면 meeting/other.
--                한 캘린더에 휴가·미팅 섞어 쓰는 팀이 선택.
--
-- N-Click에서 등록한 이벤트는 이 모드와 무관하게 extendedProperties.nclickType(속성)을
-- 최우선 신뢰한다 (sync 코드에서 처리).

ALTER TABLE org_calendars
  ADD COLUMN IF NOT EXISTS event_classification text NOT NULL DEFAULT 'by_type'
    CHECK (event_classification IN ('by_type', 'by_title'));

COMMENT ON COLUMN org_calendars.event_classification IS
  'by_type: calendar_type 따름(분리 운영, 기본) / by_title: 제목 텍스트로 휴가 판단(통합 운영)';
