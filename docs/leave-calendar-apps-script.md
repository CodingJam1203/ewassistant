# 휴가 캘린더 Apps Script Web App 셋업 가이드

N-Click이 외부 Google Sheets 휴가 캘린더를 읽으려면 Apps Script Web App을
한 번만 배포하면 됩니다. 두 본부 시트(HR마케팅본부 / HR임팩트본부)를 한 호출로
batch 처리하므로 Web App 1개만 만들면 됩니다.

## 1. 사전 조건

- 본 가이드 작성자(또는 운영 담당자)의 Google 계정에서 두 시트 모두 **편집 권한**으로 접근 가능해야 함
- 시트 ID는 코드에 박혀 있음 — 변경 시 아래 `SHEET_CONFIGS` 수정

## 2. Apps Script 작성

1. [Apps Script](https://script.google.com) 접속 → **새 프로젝트**
2. 프로젝트 이름: `N-Click Leave Calendar API`
3. 기본 `Code.gs` 내용을 모두 지우고 아래 코드 붙여넣기
4. `Ctrl+S`로 저장

```javascript
/**
 * N-Click 휴가 캘린더 API
 *
 * GET 요청:
 *   ?date=YYYY-MM-DD     필수
 *   ?token=SECRET        선택 (env LEAVE_CALENDAR_TOKEN과 일치 필요. 빈 문자열이면 인증 생략)
 *
 * 응답:
 *   {
 *     "date": "2026-05-05",
 *     "departments": {
 *       "HR마케팅본부": [{ "name": "김재민", "cellValue": "휴가" }, ...],
 *       "HR임팩트본부": [{ "name": "...", "cellValue": "..." }, ...]
 *     }
 *   }
 */

// ─── 설정 ──────────────────────────────────────────────────────────────────────

/** 빈 문자열이면 인증 생략. 운영에서는 반드시 임의 secret 설정 권장 */
const EXPECTED_TOKEN = ''

const SHEET_CONFIGS = {
  'HR마케팅본부': {
    spreadsheetId:  '15X1WmlNRbvCCom2PfVx6oSHNtJ5MrrY6-cBb3kBsVbs',
    sheetName:      '시트1',
    nameRange:      'C5:C',     // 사람 이름 (5행부터 끝까지)
    dateHeaderRange:'EM4:ZZ4',  // 날짜 헤더 (4행)
    dataRange:      'EM5:ZZ',   // 데이터 영역 (5행부터)
  },
  'HR임팩트본부': {
    spreadsheetId:  '1pnvYnyaK4B4o-lRS2sQqp48UAjJR9StZ-VvQUAsyTiM',
    sheetName:      '시트1',
    nameRange:      'C2:C',
    dateHeaderRange:'X1:ZZ1',
    dataRange:      'X2:ZZ',
  },
}

// ─── 메인 진입점 ───────────────────────────────────────────────────────────────

function doGet(e) {
  try {
    var token = (e && e.parameter && e.parameter.token) || ''
    if (EXPECTED_TOKEN && token !== EXPECTED_TOKEN) {
      return jsonResponse({ error: 'unauthorized' })
    }

    var date = (e && e.parameter && e.parameter.date) || ''
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return jsonResponse({ error: 'invalid_date' })
    }

    var departments = {}
    for (var deptName in SHEET_CONFIGS) {
      try {
        departments[deptName] = readDepartment(SHEET_CONFIGS[deptName], date)
      } catch (err) {
        // 한 시트가 실패해도 다른 시트는 계속 처리
        Logger.log('readDepartment failed for ' + deptName + ': ' + err)
        departments[deptName] = []
      }
    }

    return jsonResponse({ date: date, departments: departments })
  } catch (err) {
    return jsonResponse({ error: String(err && err.message || err) })
  }
}

// ─── 본부 1개 읽기 ─────────────────────────────────────────────────────────────

function readDepartment(config, dateStr) {
  var ss = SpreadsheetApp.openById(config.spreadsheetId)
  var sheet = ss.getSheetByName(config.sheetName)
  if (!sheet) return []

  // 1) 이름 컬럼
  var nameVals = sheet.getRange(config.nameRange).getValues()
  var names = nameVals.map(function (r) { return (r[0] || '').toString().trim() })

  // 2) 날짜 헤더 → 날짜 → column index 매핑
  var dateHeaderVals = sheet.getRange(config.dateHeaderRange).getValues()[0]
  var colIndex = -1
  for (var i = 0; i < dateHeaderVals.length; i++) {
    if (formatHeaderDate(dateHeaderVals[i]) === dateStr) {
      colIndex = i
      break
    }
  }
  if (colIndex === -1) return []

  // 3) 데이터 영역 → 해당 컬럼만
  var allData = sheet.getRange(config.dataRange).getValues()

  var entries = []
  for (var r = 0; r < names.length; r++) {
    var n = names[r]
    if (!n) continue
    var row = allData[r]
    if (!row) continue
    var cell = row[colIndex]
    if (cell === null || cell === undefined || cell === '') continue
    entries.push({ name: n, cellValue: cell.toString() })
  }
  return entries
}

// ─── 유틸 ──────────────────────────────────────────────────────────────────────

/** 헤더 셀이 Date 객체일 수도, 문자열일 수도 있어 모두 'YYYY-MM-DD'로 정규화 */
function formatHeaderDate(v) {
  if (v instanceof Date) {
    return Utilities.formatDate(v, 'Asia/Seoul', 'yyyy-MM-dd')
  }
  var s = String(v || '').trim()
  // '2026-05-05', '2026/05/05', '2026.05.05' 등 허용 → 일자만 비교
  var m = /(\d{4})[.\-\/](\d{1,2})[.\-\/](\d{1,2})/.exec(s)
  if (m) {
    return m[1] + '-' + pad(m[2]) + '-' + pad(m[3])
  }
  return ''
}

function pad(n) { return ('0' + n).slice(-2) }

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON)
}
```

## 3. Web App 배포

1. 우상단 **배포 → 새 배포**
2. 톱니바퀴 → **웹 앱** 선택
3. 설명: `N-Click leave calendar v1`
4. **다음 사용자 인증 정보로 실행**: **나 (시트 owner 계정)** ← 중요
5. **액세스 권한이 있는 사용자**: **모든 사용자** (token 검증으로 보호)
6. **배포** 클릭
7. 권한 승인 (시트 읽기 권한 요청 — 본인 계정으로 승인)
8. 표시되는 **웹 앱 URL** 복사 — 형식: `https://script.google.com/macros/s/.../exec`

## 4. N-Click 환경변수 등록

Vercel Dashboard → Project → Settings → Environment Variables 에 두 개 추가:

```
LEAVE_CALENDAR_WEBHOOK_URL  = https://script.google.com/macros/s/.../exec
LEAVE_CALENDAR_TOKEN        = <임의 secret 문자열, Apps Script EXPECTED_TOKEN과 일치>
```

- `LEAVE_CALENDAR_TOKEN`은 Apps Script의 `EXPECTED_TOKEN` 상수와 동일 값.
- `EXPECTED_TOKEN = ''`(빈 값)이면 token 검증 생략됨 — 개발용으로만.
- 운영에서는 반드시 token 설정 (예: `crypto.randomUUID()` 결과 사용).

env 변경 후 Vercel 재배포 → N-Click이 자동으로 캘린더 호출 활성화.

## 5. 동작 확인

### 현재 활성 배포 URL (참고)

```
https://script.google.com/macros/s/AKfycbwrFA61e9ME7H_tDmC48wYTA2g66_r8fBDifDsRzz15syux2XWHp6RRQJ4yl7YvsvuJ/exec
```

(배포 갱신 시 URL이 바뀔 수 있으므로 항상 Apps Script "배포 관리"에서 확인)

### 테스트 URL 모음

브라우저에서 직접 호출 테스트:

**디버그 (헤더 인식 확인)**:
```
.../exec?debug=headers
```

**실제 데이터 조회**:
```
.../exec?date=2026-05-05&token=YOUR_TOKEN
```

응답 예시:
```json
{
  "date": "2026-05-05",
  "departments": {
    "HR마케팅본부": [
      { "name": "김재민", "cellValue": "오전반차" }
    ],
    "HR임팩트본부": [
      { "name": "이도담", "cellValue": "<10:00~12:00> 미팅" }
    ]
  }
}
```

## 6. 운영 팁

- **시트 변경 → N-Click 반영 지연**: 최대 30분 (TTL). 07:00 KST cron에서 강제 갱신.
- **즉시 반영 필요시**: Vercel에서 `leave_calendar_cache` 테이블 row 삭제 → 다음 호출에서 재조회.
- **Apps Script 한도**: Custom function 6분 / URL Fetch 분당 ~100회 / 일 ~20,000회.
  N-Click의 호출량(5분에 1회 + cron 1회/일)은 한도의 1% 미만.
- **장애 대응**: Apps Script 응답 실패 시 N-Click은 stale 캐시(TTL 만료된 이전 데이터) 사용.
  로그에서 `[leave-calendar]` 검색.
