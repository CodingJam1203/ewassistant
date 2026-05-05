/**
 * N-Click 휴가 캘린더 API
 *
 * GET 요청:
 *   ?date=YYYY-MM-DD     필수
 *   ?token=SECRET        선택 (LEAVE_CALENDAR_TOKEN과 일치 필요. 빈 문자열이면 인증 생략)
 *
 * 응답 형식:
 *   {
 *     "date": "2026-05-05",
 *     "departments": {
 *       "HR마케팅본부": [{ "name": "김재민", "cellValue": "휴가" }],
 *       "HR임팩트본부": [{ "name": "이도담", "cellValue": "<10:00~12:00> 미팅" }]
 *     }
 *   }
 */

// ============ 설정 ============

// 빈 문자열이면 인증 생략. 운영에서는 임의 secret 설정 권장.
var EXPECTED_TOKEN = '';

var SHEET_CONFIGS = {
  'HR마케팅본부': {
    spreadsheetId:   '15X1WmlNRbvCCom2PfVx6oSHNtJ5MrrY6-cBb3kBsVbs',
    sheetName:       '시트1',
    nameRange:       'C5:C',
    dateHeaderRange: 'EM4:ZZ4',
    dataRange:       'EM5:ZZ'
  },
  'HR임팩트본부': {
    spreadsheetId:   '1pnvYnyaK4B4o-lRS2sQqp48UAjJR9StZ-VvQUAsyTiM',
    sheetName:       '시트1',
    nameRange:       'C2:C',
    dateHeaderRange: 'X1:ZZ1',
    dataRange:       'X2:ZZ'
  }
};

// ============ 메인 진입점 ============

function doGet(e) {
  try {
    var token = (e && e.parameter && e.parameter.token) || '';
    if (EXPECTED_TOKEN && token !== EXPECTED_TOKEN) {
      return jsonResponse({ error: 'unauthorized' });
    }

    var debug = (e && e.parameter && e.parameter.debug) || '';
    if (debug === 'headers') {
      // 디버그 모드: 각 본부의 날짜 헤더 raw + 변환값을 반환
      var debugOut = {};
      for (var deptName in SHEET_CONFIGS) {
        try {
          debugOut[deptName] = inspectHeaders(SHEET_CONFIGS[deptName]);
        } catch (err) {
          debugOut[deptName] = { error: String(err) };
        }
      }
      return jsonResponse({ debug: 'headers', departments: debugOut });
    }

    var date = (e && e.parameter && e.parameter.date) || '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return jsonResponse({ error: 'invalid_date' });
    }

    var departments = {};
    for (var deptName in SHEET_CONFIGS) {
      try {
        departments[deptName] = readDepartment(SHEET_CONFIGS[deptName], date);
      } catch (err) {
        Logger.log('readDepartment failed for ' + deptName + ': ' + err);
        departments[deptName] = [];
      }
    }

    return jsonResponse({ date: date, departments: departments });
  } catch (err) {
    return jsonResponse({ error: String((err && err.message) || err) });
  }
}

// ============ 디버그: 헤더 inspection ============

function inspectHeaders(config) {
  var ss = SpreadsheetApp.openById(config.spreadsheetId);
  var sheet = ss.getSheetByName(config.sheetName);
  if (!sheet) return { error: 'sheet not found: ' + config.sheetName };

  var headerVals = sheet.getRange(config.dateHeaderRange).getValues()[0];
  var samples = [];
  // 처음부터 20개만 샘플링 (응답 크기 관리)
  var limit = Math.min(headerVals.length, 20);
  for (var i = 0; i < limit; i++) {
    var v = headerVals[i];
    samples.push({
      index: i,
      raw: String(v),
      type: typeof v,
      isDate: v instanceof Date,
      formatted: formatHeaderDate(v)
    });
  }
  return {
    headerRange: config.dateHeaderRange,
    totalCols: headerVals.length,
    samples: samples
  };
}

// ============ 본부 1개 읽기 ============

function readDepartment(config, dateStr) {
  var ss = SpreadsheetApp.openById(config.spreadsheetId);
  var sheet = ss.getSheetByName(config.sheetName);
  if (!sheet) return [];

  var nameVals = sheet.getRange(config.nameRange).getValues();
  var names = nameVals.map(function (r) { return (r[0] || '').toString().trim(); });

  var dateHeaderVals = sheet.getRange(config.dateHeaderRange).getValues()[0];
  var colIndex = -1;
  for (var i = 0; i < dateHeaderVals.length; i++) {
    if (formatHeaderDate(dateHeaderVals[i]) === dateStr) {
      colIndex = i;
      break;
    }
  }
  if (colIndex === -1) return [];

  var allData = sheet.getRange(config.dataRange).getValues();

  var entries = [];
  for (var r = 0; r < names.length; r++) {
    var n = names[r];
    if (!n) continue;
    var row = allData[r];
    if (!row) continue;
    var cell = row[colIndex];
    if (cell === null || cell === undefined || cell === '') continue;
    entries.push({ name: n, cellValue: cell.toString() });
  }
  return entries;
}

// ============ 유틸 ============

function formatHeaderDate(v) {
  if (v === null || v === undefined || v === '') return '';

  // 1) instanceof Date — 가장 표준이지만 Apps Script V8에서 가끔 false
  if (v instanceof Date) {
    return Utilities.formatDate(v, 'Asia/Seoul', 'yyyy-MM-dd');
  }
  // 2) toString tag — '[object Date]' 검출
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return Utilities.formatDate(v, 'Asia/Seoul', 'yyyy-MM-dd');
  }
  // 3) Duck typing — Date 메서드 존재 여부
  if (typeof v === 'object' && v && typeof v.getTime === 'function' && typeof v.getFullYear === 'function') {
    return Utilities.formatDate(v, 'Asia/Seoul', 'yyyy-MM-dd');
  }

  var s = String(v).trim();
  if (!s) return '';

  // 4) Date.toString() 형식 ("Tue May 05 2026 00:00:00 GMT+0900 (한국 표준시)" 등)
  //    → new Date()로 파싱 후 KST 기준 yyyy-MM-dd
  if (/\d{4}/.test(s)) {
    var parsed = new Date(s);
    if (parsed && !isNaN(parsed.getTime())) {
      return Utilities.formatDate(parsed, 'Asia/Seoul', 'yyyy-MM-dd');
    }
  }

  // 5) "2026-05-05" / "2026/05/05" / "2026.05.05" 직접 매칭
  var m = /(\d{4})[.\-\/](\d{1,2})[.\-\/](\d{1,2})/.exec(s);
  if (m) {
    return m[1] + '-' + pad(m[2]) + '-' + pad(m[3]);
  }

  return '';
}

function pad(n) {
  return ('0' + n).slice(-2);
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
