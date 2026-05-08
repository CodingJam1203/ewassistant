# N-Click Design System

> 사내 출퇴근/근로시간 관리 도구의 디자인 단일 진실(Single Source of Truth).
> 새 화면, 새 컴포넌트, 새 토큰을 추가할 때 반드시 본 문서를 먼저 읽고 위반하지 않도록 한다.

---

## 1. Product Identity

N-Click은 NHR 임직원의 일일 출퇴근·휴게·휴가·근로시간 보고/관리를 위한 **내부 업무 SaaS**다.

지향:
- 빠르고(fast) 정돈된(clean) 신뢰감(trustworthy) 있는 **운영 도구(operational)**
- 화면을 처음 본 0.5초 안에 "지금 해야 하는 행동"이 보여야 함
- 정보 밀도가 높고 반복 작업이 매끄러워야 함

지양:
- 그라데이션, 형광 컬러, 강한 그림자
- 보라/민트/네온 등 의미 없는 색상
- 화면마다 따로 디자인된 일회성 스타일
- 큼지막한 카드로 데이터 밀도가 낮아지는 구조

벤치마크: Toss(명료함), Linear(차분한 밀도), Notion(중성 surface), Vercel(절제된 spacing).

---

## 2. Design Principles

1. **Clarity first** — 화면마다 1차 액션이 즉시 보여야 한다.
2. **Calm operational UI** — 대부분 surface는 중성. 색은 의미·계층·상태에만 사용.
3. **Semantic color only** — 색 = 의미. 장식 금지.
4. **Dense but readable** — 업무 도구는 빽빽해도 OK. 단, 행간/패딩 토큰은 일관.
5. **Consistent components** — 같은 역할은 같은 컴포넌트. 페이지마다 변형 금지.

---

## 3. Color System

모든 색은 토큰을 통해서만 사용한다. 페이지·컴포넌트에서 임의의 hex/Tailwind 컬러 클래스(`bg-green-500` 등) 직접 사용 **금지**.

### 3.1 Primary (Blue)
주요 CTA, 활성 탭/메뉴, 링크, 포커스 ring, 핵심 수치 강조에만 사용.

| token | hex | 용도 |
|---|---|---|
| `primary-50` | `#EFF6FF` | 매우 옅은 배경, info bg |
| `primary-100` | `#DBEAFE` | hover bg, soft chip bg |
| `primary-500` | `#2563EB` | 링크 기본, 보조 강조 |
| `primary-600` | `#1D4ED8` | **Primary CTA 기본** |
| `primary-700` | `#1E40AF` | Primary hover |

### 3.2 Neutral
대부분의 surface · 텍스트 · border에 사용.

| token | hex | 용도 |
|---|---|---|
| `background` | `#F8FAFC` | 페이지 배경 |
| `surface` | `#FFFFFF` | 카드/모달/입력 배경 |
| `surface-muted` | `#F1F5F9` | 헤더, hover bg, 비활성 surface |
| `border` | `#E2E8F0` | 기본 border, divider |
| `border-strong` | `#CBD5E1` | input/select border, 강조 divider |
| `text-primary` | `#0F172A` | 본문, 제목 |
| `text-secondary` | `#475569` | 보조 텍스트, 라벨, 헤더 |
| `text-muted` | `#94A3B8` | 비활성, 메타 |
| `text-disabled` | `#CBD5E1` | disabled 텍스트 |

### 3.3 Semantic
상태 의미 표현 전용. 버튼/카드/배지 모두 동일 토큰 셋을 공유.

| 의미 | bg | text | border |
|---|---|---|---|
| Success (정상/근무중/완료) | `#ECFDF5` | `#15803D` | `#BBF7D0` |
| Warning (주의/대기/작성됨) | `#FEFCE8` | `#CA8A04` | `#FDE68A` |
| Danger (위험/미제출/초과/삭제) | `#FEF2F2` | `#DC2626` | `#FECACA` |
| Info (정보/리더 배지/알림) | `#EFF6FF` | `#2563EB` | `#BFDBFE` |

토큰 선택 노트:
- **success-text** = `green-700`. 이전 emerald-700(`#047857`)은 청록 기운 + 어두움 때문에 갈색처럼 보였다. green-700이 더 친근하면서 신뢰감 유지.
- **warning-text** = `yellow-600`. 이전 amber-700(`#B45309`)은 갈색이 너무 강했다. yellow-600은 노랑 톤이 살아있어 "주의"라는 의미가 한눈에 들어온다.
- **success-border** = `green-200`. 이전 emerald-200보다 밝아 칩이 더 밝게 떠보임.
- bg는 `success`만 emerald-50 유지 (mint 느낌이 신선), `warning`은 yellow-50으로 시프트.

### 3.4 Color Rules

- 외부 링크(EW/NPM 바로가기)도 모두 **primary link**로 통일. 색을 다르게 줘서 구분 금지.
- 초록 CTA 남발 금지. Success는 **상태 배지/부수 표현**에만.
- 빨강은 진짜 위험/삭제에만. 주의(amber)와 위험(red)을 함부로 섞지 않는다.
- 보라/청록/민트/형광 컬러는 사용하지 않는다.

---

## 4. Typography

### Font

```
Pretendard, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif
```

전역:
- `letter-spacing: -0.02em`
- `-webkit-font-smoothing: antialiased`
- `text-rendering: optimizeLegibility`

### Type Scale

| 토큰 | size / line-height / weight | 용도 |
|---|---|---|
| `display` | 32 / 40 / 700 | 랜딩 hero (사용 빈도 매우 낮음) |
| `h1` | 28 / 36 / 700 | 페이지 제목 |
| `h2` | 24 / 32 / 700 | 섹션 제목 |
| `h3` | 20 / 28 / 700 | 카드/모달 제목 |
| `body-lg` | 16 / 24 / 500 | 큰 본문, 카드 강조 텍스트 |
| `body` | 14 / 22 / 500 | 기본 본문 |
| `body-sm` | 13 / 20 / 500 | 테이블 셀, 보조 본문 |
| `caption` | 12 / 18 / 500 | 메타, 설명 |
| `label` | 12 / 16 / 600 | 폼 라벨, 배지 |

### 규칙
- 한 카드 안에서 폰트 크기는 **3종 이하**.
- 숫자 강조는 `font-weight: 600` 이상.
- 시간/숫자 컬럼은 `font-variant-numeric: tabular-nums`.

---

## 5. Spacing

base = **4px**, scale = 4 / 8 / 12 / 16 / 20 / 24 / 32 / 40 / 48 / 64.

| 영역 | 값 |
|---|---|
| Page padding (desktop) | 32 |
| Page padding (tablet) | 24 |
| Page padding (mobile) | 16 |
| Section gap | 24 |
| Card gap (grid) | 16 |
| Card padding | 20 또는 24 |
| Form field gap | 12 |
| Table cell padding | 12 16 |

규칙:
- 임의 padding/margin 발명 금지. 위 scale에서만 선택.
- 기본 내부 gap은 **16**, 섹션 간은 **24**, 페이지 레벨은 **32**.

---

## 6. Radius

| 토큰 | 값 | 용도 |
|---|---|---|
| `radius-xs` | 6 | tag |
| `radius-sm` | 8 | 작은 input |
| `radius-md` | 10 | **Button / Input / Select 기본** |
| `radius-lg` | 12 | 작은 카드/툴팁 |
| `radius-xl` | 16 | **Card / FilterBar 기본** |
| `radius-2xl` | 20 | Modal |
| `radius-full` | 999 | Badge, avatar, dot |

---

## 7. Elevation

그림자는 거의 안 보일 만큼 절제. 카드 분리는 **border가 우선**, 그림자는 보조.

| 토큰 | 값 | 용도 |
|---|---|---|
| `shadow-card` | `0 1px 2px rgba(15,23,42,.04)` | 기본 카드 — 단일 레이어, 매우 옅게 |
| `shadow-popover` | `0 8px 24px rgba(15,23,42,.10)` | 드롭다운, 팝오버, 모달 |
| `focus-ring` | `0 0 0 3px rgba(37,99,235,.16)` | 포커스 |

규칙:
- 인위적인 떠오름 효과 금지. 카드는 border + 매우 옅은 그림자.
- hover 강조가 필요한 클릭 가능 카드는 색이 아니라 `shadow-popover`로 살짝 떠올림.

---

## 8. Components

> 공통 컴포넌트는 `src/components/ui/` 아래에 둔다. 새 화면을 만들 때 페이지에서 직접 markup하지 말고 반드시 이 컴포넌트를 사용한다.

### 8.1 Button

variant: `primary | secondary | ghost | danger | warning-soft`
size: `sm(32) | md(40) | lg(48)`

- **primary** — 섹션당 1개의 핵심 CTA (예: 퇴근보고 작성, 새 계정 등록, 저장)
  - bg `primary-600`, hover `primary-700`, text white
- **secondary** — 보조 액션 (수정, 필터 적용, 보기 전환, 외부 라우팅 관리 등)
  - bg `surface`, border `border-strong`, text `text-primary`, hover `surface-muted`
- **ghost** — 약한 액션 (취소, 새로고침, 닫기)
  - bg transparent, text `text-secondary`, hover `surface-muted`
- **danger** — 파괴적 액션 (삭제, 잠금, 출근취소)
  - 강조형: bg `danger-text`(#DC2626), text white
  - 약한 형: bg `danger-bg`, text `danger-text`, border `danger-border`
- **warning-soft** — 일시중지/휴게 시작 같은 caution 류
  - bg `warning-bg`, text `warning-text`, border `warning-border`

규칙:
- 한 섹션에 primary는 최대 1개. 다수 액션이 있으면 위계를 secondary/ghost로 낮춘다.
- 초록 CTA 금지. Success는 배지에서만.

### 8.2 Badge

variant: `success | warning | danger | info | neutral`

| 사례 | variant |
|---|---|
| 근무 중, 정상, 활성 | success |
| 출근보고 작성됨, 주의 | warning |
| 미제출, 초과, 잠금(강조) | danger |
| 리더, 알림, 정보 | info |
| 일반, 미사용 | neutral |

스타일(공통):
- height 24, padding 0 10, radius full, font-size 12, font-weight 600
- bg는 *-bg, text는 *-text, border는 *-border 토큰 사용

### 8.3 Card

`Card` (default), `StatCard`(통계), `StatusCard`(좌측 semantic border).

기본:
- bg `surface`, border `1px solid border`, radius `xl(16)`, padding 20 또는 24
- shadow: `shadow-card`
- hover가 의미 있는 카드만 `hover:border-primary-200`

`StatusCard`의 좌측 4px border:
- `success` → 근무 중/정상
- `warning` → 출근보고 작성됨/주의
- `danger` → 미제출/위험
- `neutral` → 정보 없음/비활성

### 8.4 Input / Select / FilterBar

Input/Select:
- height 40, radius `md(10)`, border `border-strong`
- focus: border `primary-500` + ring `focus-ring`
- placeholder: `text-muted`
- disabled: bg `surface-muted`, text `text-disabled`

FilterBar:
- 카드형 컨테이너: bg `surface`, border, radius `xl(16)`, padding 16
- 필드 간 gap 12, 라벨은 `label` 타입(12/600/text-secondary)

### 8.5 Table

- 컨테이너: bg `surface`, border, radius `xl(16)`, overflow hidden
- header: bg `background`(=#F8FAFC), text `text-secondary`, font 12/600 uppercase 옵션
- cell: padding 12 16, font `body-sm`(13/20)
- row hover: bg `surface-muted`(#F1F5F9)
- 시간/숫자 컬럼: `tabular-nums`
- 강조는 굵기·primary 색상 1군데만. 색상으로 도배 금지.

### 8.6 Navigation

상단 네비:
- height 64, bg `surface`, border-bottom `border`
- 로고 좌측, 메뉴 좌-중, 사용자 우측
- active 메뉴: `primary-600` text + 600 weight (bottom border 또는 light bg 중 **하나만**)
- 외부 링크(EW/NPM 바로가기): primary link 동일 스타일. 외부 아이콘만 14px로 작게.

### 8.7 Icon

- lucide-react 단일 사용
- 기본 16, 카드 18, 섹션 20, stroke 2
- 색상은 `currentColor` 또는 텍스트/상태 토큰. 아이콘 임의 색 금지.

---

## 9. Screen Rules

### 9.1 MY PAGE (`/home`)
- 1차 액션: **퇴근보고 작성** (Primary)
- 출근보고 작성 완료 → Secondary disabled-like
- 휴게 시작 → warning-soft Secondary
- 근무지 변경 → compact Select
- 근로현황 카드 → 흰 surface 또는 매우 옅은 primary-50 tint, **dark navy 금지**
  - 진행률: primary
  - 법정 기준선: warning
  - 정상 15% 등 상태: success badge

### 9.2 둘러보기 (`/team`)
- 카드 좌측 4px border만 semantic, 카드 전체를 강한 색으로 칠하지 않음
- 배지: 연한 *-bg + 진한 *-text
- 버튼:
  - 출근 → Primary
  - 퇴근 → Primary
  - 휴게 시작 → warning-soft
  - 출근취소 → Ghost-Danger
  - 근무지 변경 → Secondary

### 9.3 제출 내역 (`/history`)
- 테이블 우선 디자인
- EW value만 굵게(가능하면 primary)
- Copy → Secondary 또는 Ghost
- Edit 아이콘 → muted, hover primary
- Delete 아이콘 → muted, hover danger

### 9.4 근로시간 관리 (`/work-hours`)
- 통계 카드 semantic 매핑:
  - 전체 인원 / 평균 인정근로 → neutral
  - 정상 → success
  - 주의 → warning
  - 위험 / 초과 → danger
- 배경색은 매우 옅게(*-bg). 강한 톤은 텍스트/border만.
- 테이블에서 인정근로 숫자만 primary
- 위험 상태는 반드시 Badge로

### 9.5 관리자 (`/admin`)
- Primary는 **새 계정 등록** 1개
- Teams 라우팅 관리, 알림 발송 내역, 새로고침 → Secondary
- 권한 배지: 일반 neutral / 리더 info / 관리자 primary
- 상태 배지: 활성 success / 잠금 danger or neutral
- 테이블 액션 아이콘: muted → hover primary/warning/danger

---

## 10. AI / 협업 규칙

UI를 새로 만들거나 수정할 때:

1. 본 `DESIGN.md`를 먼저 확인한다.
2. 새 색·새 토큰·새 버튼 스타일을 발명하지 않는다.
3. 페이지 컴포넌트에서 raw Tailwind 색 클래스(`bg-green-*`, `text-purple-*` 등)를 직접 쓰지 않는다. 공통 컴포넌트의 variant를 사용한다.
4. 비즈니스 로직(Supabase 쿼리, Teams 알림, EW 계산, 권한 체크)은 건드리지 않는다.
5. 작업 끝나기 전 체크:
   - 각 페이지의 색상이 토큰 외 색 없이 일관한가
   - 모든 버튼이 정의된 variant를 사용하는가
   - 모든 상태가 Badge variant로 표현되는가
   - 테이블이 공통 셸을 쓰는가
   - 모든 spacing이 4px scale을 따르는가
   - 모바일·데스크탑 모두 점검했는가

---

## 11. 모바일

PC와 모바일 사용자 비율이 비슷하다. 모든 페이지·컴포넌트는 **모바일에서도 정상 동작**해야 한다.

- 모바일 page padding 16, 카드 padding 20
- 테이블은 모바일에서 가로 스크롤 또는 카드 리스트로 fallback
- 1차 액션은 모바일에서 sticky bottom bar 형태도 허용
- 폰트 크기는 모바일에서 그대로 유지(축소 금지). 대신 카드 padding을 줄여 밀도 확보
- tap target 최소 40 × 40

---

## 12. 디렉토리

```
src/
  app/
    globals.css            ← @theme 토큰 + Pretendard import
  components/
    ui/                    ← 공통 디자인 시스템 컴포넌트
      Button.tsx
      Badge.tsx
      Card.tsx             ← Card / StatCard / StatusCard
      Input.tsx
      Select.tsx
      FilterBar.tsx
      PageHeader.tsx
      Table.tsx            ← Table / Th / Td / TableEmpty
    ...                    ← 도메인 컴포넌트(예: WorkLogForm)는 위 ui 컴포넌트를 조합
```
