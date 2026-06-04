-- v1.75 (2026-06-04) — org_calendars UNIQUE 키 완화
--
-- 배경:
--   기존 UNIQUE (division_id, google_calendar_id) 는 같은 본부에 같은 Google Calendar ID 를
--   단 한 row 만 허용. 그러나 운영상 같은 공용 캘린더를 본부 전체 / 1팀 / 2팀 같이 여러
--   라벨·범위로 등록하거나, 같은 캘린더를 회의(meeting)와 휴가(vacation) 두 유형으로
--   동시 등록해야 하는 케이스가 발생. POST/PATCH 시 23505 → "이미 등록된 캘린더입니다." 로
--   막혔다.
--
-- 정책:
--   본부 + 팀 + Google Calendar ID + calendar_type 네 가지가 모두 동일한 경우만 진짜 중복으로
--   판단하고 막는다. 그 외 (다른 팀, 다른 유형, team_id NULL vs 특정 팀 등)는 자유 등록.
--
-- 화면/알림 중복 노출:
--   sync 자체는 row 단위라 같은 캘린더가 N row 면 같은 이벤트가 N row 로 저장된다.
--   lookup.ts 의 dedupe(google_event_id 키) 로 사용자 화면·알림 텍스트 빌더에 1번만 노출한다.
--   reminder-22 알림은 v1.67 자체 (startTime+endTime+title) dedupe 이미 보유.

-- Step 1: 기존 UNIQUE 제약 drop (이름이 자동 부여되었으면 constraint 명도 자동)
ALTER TABLE public.org_calendars
  DROP CONSTRAINT IF EXISTS org_calendars_division_id_google_calendar_id_key;

-- Step 2: 확장 UNIQUE 추가
--   team_id 가 NULL 인 경우 Postgres 표준 동작상 NULL ≠ NULL 이라 같은 (division, gcal_id, type)
--   에서 team_id NULL row 가 둘 이상 만들어질 수 있다. 운영 의도(본부 전체용은 1개)에 위배
--   되므로 NULLS NOT DISTINCT 로 NULL 도 같은 값으로 취급해 막는다 (PG 15+).
ALTER TABLE public.org_calendars
  ADD CONSTRAINT org_calendars_div_team_gcal_type_unique
  UNIQUE NULLS NOT DISTINCT (division_id, team_id, google_calendar_id, calendar_type);

COMMENT ON CONSTRAINT org_calendars_div_team_gcal_type_unique ON public.org_calendars IS
  'v1.75: (division, team, gcal_id, calendar_type) 4튜플 UNIQUE. 다른 팀/유형 등록 자유. NULLS NOT DISTINCT 로 team_id NULL 도 같은 값 취급.';
