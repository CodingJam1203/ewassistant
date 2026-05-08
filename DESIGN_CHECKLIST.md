# Design System Refactor — 검증 체크리스트

> 본 디자인 시스템 정비 PR 머지 전, PC에서 다음 항목을 차례로 확인.
> 자세한 토큰/규칙은 `DESIGN.md` 참고.

## 1. 타입체크 / 빌드

```cmd
cd C:\Users\jmkim\.gemini\antigravity\scratch\ew-assistant\ew-assistant
npx tsc --noEmit
npm run build
```

알려진 잔여 경고 / 무해한 항목:

- `src/components/EditLogModal.tsx`, `src/components/CheckInTimeModal.tsx`
  → 어디에서도 import되지 않는 dead code. raw 컬러 클래스가 남아있으나 빌드에 포함되더라도 런타임에 미사용. 후속 cleanup PR에서 삭제 권장.
- `src/components/Pagination.tsx`의 `tabId` 등 외부 변경 없음.

## 2. raw 컬러 sweep 결과

`src` 아래 페이지/컴포넌트(라이브 코드)에서 raw Tailwind 색상 클래스 직접 사용 = **0건** (dead code 2개 파일 제외).

## 3. 페이지별 시각 검증

각 페이지를 실제 dev 서버에서 로드해 다음 항목 확인:

### `/home`
- [ ] 상단 카드 좌측 4px semantic border가 상태(success/warning/danger)에 따라 색만 다름. 카드 전체는 흰 surface
- [ ] "출근보고 작성"은 secondary, "퇴근보고 작성"은 primary (완료 시 secondary로 강등)
- [ ] 휴게 시작 = warning-soft, 휴게 종료 = warning-soft (강조)
- [ ] 시각 칩(출근예정/퇴근예정/실제 출근/실제 퇴근) 색상이 모두 동일한 neutral 톤
- [ ] WorkHoursCard가 dark navy 아닌 흰 surface + 옅은 회색 progress 배경
- [ ] 진행률 fill: 정상=primary-600 / 주의=warning-text / 위험·초과=danger-text
- [ ] 법정기준선 = warning-text 점선
- [ ] Tab(일자별 최종/RAW) active=primary-600 + bottom border

### `/team` (둘러보기)
- [ ] 카드 좌측 4px border만 semantic 색, 나머지 카드 본체는 흰 surface
- [ ] 상태 배지는 `*-bg + *-text + *-border` 통일 형태
- [ ] 출근/퇴근 = primary, 출근취소/퇴근취소 = ghost-danger, 휴게시작 = warning-soft, 휴게종료 = warning fill
- [ ] 캘린더 일정 박스 = info-bg + info-text (보라 안 보임)
- [ ] FilterBar 우측 요약 chip이 success/warning/danger Badge

### `/history` (제출 내역)
- [ ] FilterBar에 본부/팀/이름/내 기록만 + 우측 ghost 버튼(필터초기화/새로고침)
- [ ] Tab active = primary-600 underline
- [ ] SubmissionsRawTable의 보고유형 배지 = success(출근)/info(퇴근)/warning(수정)
- [ ] EW 셀 = primary-600 굵게
- [ ] 복사 버튼 = ghost (복사 완료 시 success)
- [ ] 수정 아이콘 = muted, hover primary

### `/work-hours`
- [ ] 통계 카드 6개: 전체인원/평균=neutral, 정상=success, 주의=warning, 위험·초과=danger
- [ ] 통계 카드 배경은 모두 흰 surface, 색은 텍스트만
- [ ] 팀별 요약 / 개인별 테이블 모두 같은 TableContainer 셸
- [ ] 인정근로 셀만 primary-600 굵게
- [ ] 위험 상태 = Badge variant (success/warning/danger)
- [ ] 정렬 select가 토큰 기반

### `/admin`
- [ ] PageHeader + 우측 secondary 버튼 (Teams 라우팅 / 알림 발송 내역)
- [ ] 새 계정 등록 = primary-600
- [ ] 권한 배지: 관리자=primary, 리더=info, 일반=neutral
- [ ] 활성 = success, 비활성 = neutral
- [ ] 잠금/삭제 아이콘 muted, hover semantic
- [ ] highlight row(검색 매칭) = warning-bg + warning ring

### `/admin/teams-routing`
- [ ] 본부/팀별 카드 헤더 = primary tinted
- [ ] 활성 토글 = success-bg + success-text 또는 surface-muted
- [ ] 추가 버튼 = primary-600
- [ ] 에러 알림 박스 = danger-bg + danger-border

### `/admin/notifications`
- [ ] PageHeader + 우측 secondary "관리자 홈으로"
- [ ] 상태 배지: SUCCESS=success, FAILURE=danger, 그 외=warning
- [ ] 테이블 셸 = TableContainer + Th/Td

### `/login`
- [ ] 카드 = bg-surface + border + radius-2xl + shadow-card
- [ ] Google 버튼 = secondary 형태(흰 배경 + border-strong)
- [ ] 에러 박스 = danger-bg + danger-border

### `/consent`
- [ ] 입력 필드 = h-10 + radius-10 + border-strong
- [ ] 동의하고 시작하기 = primary-600 (h-12)
- [ ] 외부 링크 = primary-600 (보라 없음)
- [ ] 에러 박스 = danger-bg + danger-border

### `/blocked`
- [ ] 경고 아이콘 원 = danger-bg + danger-border
- [ ] 로그아웃 버튼 = secondary

### `/terms`, `/privacy`
- [ ] 본문 surface 카드 + border
- [ ] 텍스트 = text-text-primary, 메타 = text-text-muted

## 4. Navbar
- [ ] 상단 64px high, 흰 surface, border-bottom border
- [ ] active 메뉴 = primary-600 + 600 weight + 아래 0.5h primary 라인
- [ ] EW/NPM 바로가기 = 동일 primary link, 보라 NPM 색 없음
- [ ] 사용자명 = text-secondary, 로그아웃 아이콘 ghost
- [ ] 모바일: chip nav 가로 스크롤, active = bg-primary-50 + text-primary-600

## 5. 모달
- [ ] WorkLogModal: 헤더 border-bottom, 닫기 버튼 ghost, PC 우측 sticky 제출 버튼 = primary
- [ ] CheckInModal: 모든 input/select가 토큰, 저장 버튼 = primary
- [ ] WorkLogForm 내부:
  - 점심 안내 박스 = warning-bg + warning-border
  - 모바일 fixed bottom 제출 버튼 = primary
  - 에러 메시지 = danger-text
- [ ] WorkLocationTimelineInput: 행 = surface, 종료(checkout) 행 = info-bg
- [ ] LeaveTimelineInput: Plane 아이콘 = warning-text, select 토큰
- [ ] CalculationPreview: 결과 셀 = neutral, EW = primary, 점심 별도 안내 = warning-bg

## 6. 글로벌
- [ ] Pretendard 폰트가 적용 (제목/본문 모두). 잘 안 뜨면 CDN(`cdn.jsdelivr.net`) 차단 여부 점검
- [ ] 자간 -0.02em이 전체 적용
- [ ] 다크모드 클래스 잔여 영향 없음 (다크모드 비활성화됨)
- [ ] focus ring이 모든 interactive에서 primary-500

## 7. 데이터 / 기능 회귀 점검 (필수)

UI만 손봤지만 만약을 대비해 확인:

- [ ] 출근 → 퇴근보고 → 휴게 시작/종료 → 근무지 변경 흐름 동작
- [ ] 제출 내역 수정 → PATCH 요청 → 재로드 시 반영
- [ ] 관리자: 새 계정 등록 → 잠금/해제 → 삭제
- [ ] Teams 알림이 정상 발송 (각 페이지 액션 후 dev tools network 확인)

## 8. 푸시

```cmd
git status
git add DESIGN.md DESIGN_CHECKLIST.md src
git commit -m "feat(design): N-Click 디자인 시스템 정비 — 토큰/공통 컴포넌트/페이지 리팩토링"
git push origin main
```

## 9. 잔여 (선택 cleanup)

`src/components/EditLogModal.tsx`, `src/components/CheckInTimeModal.tsx`는 import되지 않는 dead code. 다음 PR에서 삭제 권장:

```cmd
del src\components\EditLogModal.tsx
del src\components\CheckInTimeModal.tsx
```
