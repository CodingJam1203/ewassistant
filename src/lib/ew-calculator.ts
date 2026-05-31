export type WorkTypeCode = 1 | 2 | 3;

/**
 * 공휴일 근무 sub-type. NULL=평일 근무, 그 외는 work_type_code=3과 함께 사용.
 *   saturday     : 토요일 근무
 *   sun_optional : 일요일/공휴일 선택 근무 (EW는 토요일로 상신)
 *   sun_required : 일요일/공휴일 필수 근무 (EW는 일요일로 상신)
 */
export type WorkSubType = 'saturday' | 'sun_optional' | 'sun_required' | null;

export interface EwInput {
  name: string;
  workTypeLabel: string;
  /** 공휴일 근무 sub-type. 미지정 시 null. EW 복사 텍스트 suffix 결정. */
  workSubType?: WorkSubType;
  leaveDate: string;
  startTime: string; // "HH:mm"
  endTime: string; // "HH:mm"
  /**
   * 휴게시간 (= 점심 외 추가 휴게) "HH:mm". 30분 단위.
   *
   * 회사 정책: 점심 1h는 근무유형에 따라 자동 차감되고 EW range에는 자동 포함됨
   * (= getDeductionMinutes 함수 결과 X). 사용자는 점심 외 추가로 쉰 시간만 입력.
   * 실근무 = (퇴-입) - X - 휴게 - 휴가
   * EW range 끝 = ewStart + 실근무 + X
   */
  breakTime: string;
  workLocation: string;
  workContent?: string;
  breakReason?: string;
  /**
   * 휴가/반차 차감 분 (30분 단위 합계).
   * 예: 오전반차 → 300, 오후반차 → 240, 종일 → 480.
   * 미지정 시 0.
   */
  leaveMinutes?: number;
  /**
   * @deprecated 사용자가 차감시간을 직접 조정하므로 사용 안 함.
   */
  leaveIncludesLunch?: boolean;
  /**
   * 종일 휴가 여부 — true이면 actual_work_time을 0으로 강제.
   * 종일 휴가 default span(09:00~18:00) 540분 − leave 480분 = 60분 잔여 버그 방지.
   * 미지정 시 false.
   */
  isFullDayLeave?: boolean;
  /**
   * v1.60 — 8H 미만 휴가용 copyText suffix. 호출처에서 leave_timeline →
   * `buildLeaveCopyTextNotice` 결과를 넘긴다 (예: " // 🗓 캘린더상 오전반차(4H) — 휴게 등록 주의").
   * 미지정/빈 문자열이면 suffix 미부착.
   */
  leaveCopyTextNotice?: string | null;
  /**
   * v1.64 — 8H 미만 근무 시 점심시간 가졌는지 여부.
   *   - undefined/false (기본): 기존 동작. 실근무 8H 미만이면 copyText 끝에
   *     " / 8H 미만 근무이며, 점심시간 가짐" 추가.
   *   - true: 사용자가 점심 안 가졌다고 선택.
   *     copyText의 endTimeText만 +60분 보정 (예: 13:00 → 14:00).
   *     copyText 끝에 " / 8H 미만 근무이며, 점심시간 가지지 않음" 추가.
   *     EW 계산(차감 60분) 자체는 변동 없음 — 표시·복붙만 보정.
   * 8H 이상 실근무거나 종일 휴가면 무시(suffix 안 붙임).
   */
  lunchSkipped?: boolean;
}

export interface EwCalculationResult {
  workTypeCode: WorkTypeCode;
  workSubType: WorkSubType;
  deductionMinutes: number;
  actualWorkMinutes: number;
  actualWorkText: string;
  dateText: string;
  ewStartText: string;
  ewEndText: string;
  ewValue: string;
  copyText: string;
  /**
   * 점심시간 자동 처리에 어색한 케이스 — 별도 휴게 검토 안내.
   *   - 실근무 4h 이하 (= 240분 이하): 점심을 안 쓰고 일찍 끝낸 경우 1h 자동 차감이 부적절
   *   - 공휴일근무 (workTypeCode=3): X=0이지만 점심 시간 자체는 사용했을 수 있음
   * true면 미리보기 박스를 빨간색으로 강조하고, copyText 끝에 " / 휴게시간 주의하여 상신" 추가.
   */
  showLunchAdvisory: boolean;
  /**
   * v1.64 — 실근무 8H 미만이면 true. UI가 이 플래그를 보고 "점심시간 가지셨나요?"
   * 라디오를 노출. 종일 휴가는 false (트리거 대상 아님).
   */
  showLunchSkipRadio: boolean;
  // ─── 계산식 breakdown 노출용 (CalculationPreview 표 렌더링) ─────────────
  /** 실제 출근시간 'HH:mm' (입력 원본) */
  startTimeText: string;
  /** 실제 퇴근시간 'HH:mm' — 자정 넘김 케이스는 27:00 형식 (>24h) */
  endTimeText: string;
  /** 총 근무 (퇴근 - 출근) 분. 자정 넘김 자동 가산. */
  totalSpanMinutes: number;
  /** 사용자 입력 휴게 분 (= 점심 외 추가 휴게) */
  breakMinutes: number;
  /** 휴가 차감 분 (오전반차 240·오후반차 240·종일 480, 사용자 조정 가능) */
  leaveMinutes: number;
  /** 종일 휴가 여부 — true면 실근무 강제 0, breakdown은 별도 표시 */
  isFullDayLeave: boolean;
}

const weekdayKo = ["일", "월", "화", "수", "목", "금", "토"];

// 7.1 근무유형 정규화
export function normalizeWorkTypeLabel(value: string): string {
  return value
    .replace(/\u00A0/g, " ")
    .replace(/\u200B/g, "")
    .replace(/\n/g, " ")
    .trim();
}

export function getWorkTypeCode(label: string): WorkTypeCode {
  const normalized = normalizeWorkTypeLabel(label);
  // 신규 5종
  if (normalized === "(평일) 기본 근무") return 1;
  if (normalized === "(평일) 간주 근무") return 2;
  if (normalized === "토요일 근무") return 3;
  if (normalized === "일요일·공휴일 근무 (선택)") return 3;
  if (normalized === "일요일·공휴일 근무 (필수)") return 3;
  // 레거시 3종 — 기존 DB 데이터 호환
  if (normalized === "기본근무 등록") return 1;
  if (normalized === "간주근로 등록") return 2;
  if (normalized === "공휴일근로 등록") return 3;
  throw new Error(`지원하지 않는 근무유형입니다: ${normalized}`);
}

/** 라벨에서 workSubType 추출 — 신규 라벨에서만 의미 있음. 레거시는 null. */
export function getWorkSubTypeFromLabel(label: string): WorkSubType {
  const normalized = normalizeWorkTypeLabel(label);
  if (normalized === "토요일 근무") return 'saturday';
  if (normalized === "일요일·공휴일 근무 (선택)") return 'sun_optional';
  if (normalized === "일요일·공휴일 근무 (필수)") return 'sun_required';
  return null;
}

/** workSubType 별 EW 복사 텍스트 끝에 붙는 suffix (없으면 빈 문자열) */
export function getCopyTextSuffix(subType: WorkSubType): string {
  if (subType === 'sun_optional') return ' / 선택적 휴일 근무 - 토요일 상신';
  if (subType === 'sun_required') return ' / 필수적 휴일 근무 - 일요일 상신';
  return '';
}

// 7.2 차감시간 X
export function getDeductionMinutes(workTypeCode: WorkTypeCode): number {
  if (workTypeCode === 1 || workTypeCode === 2) return 60;
  if (workTypeCode === 3) return 0;
  throw new Error("잘못된 근무유형입니다.");
}

// 시간(HH:mm)을 분(minutes)으로 변환
export function parseTimeHHMM(timeStr: string): number {
  if (!timeStr) return 0;
  const parts = timeStr.split(":");
  if (parts.length !== 2) throw new Error(`잘못된 시간 형식입니다: ${timeStr}`);
  const hours = parseInt(parts[0], 10);
  const minutes = parseInt(parts[1], 10);
  if (isNaN(hours) || isNaN(minutes)) throw new Error(`잘못된 시간 형식입니다: ${timeStr}`);
  return hours * 60 + minutes;
}

// 분(minutes)을 시간(HH:mm)으로 변환 — 24h normalize (시계 표시용)
export function formatTimeHHMM(totalMinutes: number): string {
  const normalized = ((totalMinutes % 1440) + 1440) % 1440;
  const hours = Math.floor(normalized / 60);
  const minutes = normalized % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

// 분 → HH:mm — normalize 안 함. 24h 초과해도 그대로 (예: 27:00, 33:30).
// 명일까지 이어지는 근무의 종료시간 표시용.
export function formatTimeOver24(totalMinutes: number): string {
  if (totalMinutes < 0) totalMinutes = 0;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

export function formatDurationHHMM(totalMinutes: number): string {
  if (totalMinutes < 0) {
    throw new Error("실근무시간이 음수입니다. 출퇴근시간과 휴게시간을 확인하세요.");
  }
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

// 두 시간의 차이 계산 (익일 퇴근 고려)
export function diffMinutes(startMinutes: number, endMinutes: number): number {
  if (endMinutes < startMinutes) {
    return endMinutes + 24 * 60 - startMinutes;
  }
  return endMinutes - startMinutes;
}

// 7.3 실근무시간 Y (= Google Sheets Y열)
//
// 실근무시간 = (퇴근 - 출근) - X(deductionMinutes) - 휴게 - 휴가
//   X: getDeductionMinutes — 기본/간주 = 60, 공휴일 = 0
//   휴게(breakMinutes): 사용자 입력 = 점심 외 추가 휴게
export function getActualWorkMinutes(
  startMinutes: number,
  endMinutes: number,
  breakMinutes: number,
  deductionMinutes: number,
  leaveMinutes: number = 0,
  _leaveIncludesLunch: boolean = false,
): number {
  return diffMinutes(startMinutes, endMinutes) - deductionMinutes - breakMinutes - leaveMinutes;
}

// 7.4 날짜 표시값 Z
export function formatKoreanDate(dateStr: string): string {
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) throw new Error(`잘못된 날짜 형식입니다: ${dateStr}`);
  
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const day = weekdayKo[date.getDay()];
  return `${yyyy}-${mm}-${dd} (${day})`;
}

// 7.6 EW 시작시간 AF: 9시 캡 처리
export function getEwStartMinutes(startMinutes: number): number {
  const nineAM = 9 * 60;
  return Math.min(startMinutes, nineAM);
}

// 7.7 EW 종료시간 AH (= Google Sheets AG열)
// 공식: EW 종료 = ewStart + 실근무 + X(deductionMinutes)
//   - 점심(X = 1h for 기본/간주, 0 for 공휴일)이 EW range에 자동 포함
//   - 휴게(break)는 EW range에서 빠짐 (실근무에서 차감되어 자연 반영)
//   - ewStart: 9시 이후 출근은 09:00로 cap, 9시 이전 출근은 그대로
//   - 인자 _breakMinutes / _endMinutes는 이전 호환성을 위해 시그니처에 남겨두지만 사용하지 않음.
export function getEwEndMinutes(
  ewStartMinutes: number,
  actualWorkMinutes: number,
  _breakMinutes: number,
  _endMinutes: number,
  deductionMinutes: number = 0,
): number {
  return ewStartMinutes + actualWorkMinutes + deductionMinutes
}

// 7.8 간주근로용 AC (= Google Sheets AC열)
// 동일 규칙: deductionMinutes만 EW range에 포함. cap 없이 startMinutes 그대로 사용.
export function getAcMinutes(
  startMinutes: number,
  actualWorkMinutes: number,
  _breakMinutes: number,
  _endMinutes: number,
  deductionMinutes: number = 0,
): number {
  return startMinutes + actualWorkMinutes + deductionMinutes
}

// 7.9 간주근로 EW 값 AB
export function getDeemedWorkEwValue(
  actualWorkMinutes: number,
  acMinutes: number,
  ewEndMinutes: number
): string {
  if (actualWorkMinutes < 8 * 60) {
    return `${formatTimeHHMM(acMinutes)}~${formatTimeOver24(ewEndMinutes)}`;
  }

  if (actualWorkMinutes <= 8 * 60 + 30) return "L1";
  if (actualWorkMinutes <= 9 * 60 + 30) return "L2";
  if (actualWorkMinutes <= 10 * 60 + 30) return "L3";
  if (actualWorkMinutes <= 11 * 60 + 30) return "L4";
  if (actualWorkMinutes <= 12 * 60 + 30) return "L5";
  if (actualWorkMinutes <= 13 * 60 + 30) return "L6";
  if (actualWorkMinutes <= 14 * 60 + 30) return "L7";
  if (actualWorkMinutes <= 15 * 60 + 30) return "L8";
  if (actualWorkMinutes <= 16 * 60 + 30) return "L9";

  // 16:30 초과 시 L9로 cap (이전: 에러 throw)
  // 운영 정책상 L9가 최대 코드. 그 이상 근무한 시간은 EW에 표시되지 않으며,
  // 실근무시간(actualWorkMinutes) 자체는 그대로 유지됨.
  return "L9";
}

// 7.10 최종 EW 값
export function getFinalEwValue(
  workTypeCode: WorkTypeCode,
  ewStartMinutes: number,
  ewEndMinutes: number,
  deemedWorkEwValue: string | null
): string {
  if (workTypeCode === 1 || workTypeCode === 3) {
    return `${formatTimeHHMM(ewStartMinutes)}~${formatTimeOver24(ewEndMinutes)}`;
  }

  if (workTypeCode === 2) {
    if (!deemedWorkEwValue) throw new Error("간주근로 EW 값이 없습니다.");
    return deemedWorkEwValue;
  }

  throw new Error("잘못된 근무유형입니다.");
}

// 7.11 최종 복사용 문구 AI
export function buildCopyText(params: {
  dateText: string;
  workLocation: string;
  startTimeText: string;
  endTimeText: string;
  actualWorkText: string;
  /** 사용자 입력 휴게(= 점심 외 추가 휴게) 'HH:MM'. 시트와 동일하게 K값 그대로 표시 */
  breakTimeText: string;
  /** 휴가/반차 차감 시간 'HH:MM'. 없거나 0이면 생략 */
  leaveTimeText?: string;
  ewValue: string;
  workContent?: string;
  breakReason?: string;
}): string {
  let text = `${params.dateText} ${params.workLocation} ${params.startTimeText}~${params.endTimeText} (실근무시간 : ${params.actualWorkText}) (휴게시간 : ${params.breakTimeText})`;
  if (params.leaveTimeText) {
    text += ` (휴가시간 : ${params.leaveTimeText})`;
  }
  text += ` EW : ${params.ewValue}`;
  if (params.workContent) {
    text += ` //⭐근무⭐ ${params.workContent}`;
  }
  if (params.breakReason) {
    text += ` //🌳휴게🌳 ${params.breakReason}`;
  }
  return text;
}

// 메인 계산 함수 — Google Sheets 기존 함수 정렬
export function calculateEw(input: EwInput): EwCalculationResult {
  const workTypeCode = getWorkTypeCode(input.workTypeLabel);
  const deductionMinutes = getDeductionMinutes(workTypeCode);

  const startMinutes = parseTimeHHMM(input.startTime);
  const endMinutes = parseTimeHHMM(input.endTime);
  const breakMinutes = parseTimeHHMM(input.breakTime || "00:00");

  const leaveMinutes = Number.isFinite(input.leaveMinutes) ? Math.max(0, Number(input.leaveMinutes)) : 0;
  const leaveIncludesLunch = !!input.leaveIncludesLunch;

  // 시트 정책 정렬:
  //   실근무 = (퇴근 - 출근) - X(deductionMinutes) - 휴게 - 휴가
  //   EW range 끝 = ewStart + 실근무 + X
  //     X = 1h(기본/간주) | 0h(공휴일) — 점심 자동 차감
  //     휴게(K) = 사용자 입력 = 점심 외 추가 휴게
  //   종일 휴가는 actual_work_time을 0으로 강제 (default span 09:00~18:00 - 휴가 480분 = 60분 잔여 버그 방지)
  const actualWorkMinutes = input.isFullDayLeave
    ? 0
    : getActualWorkMinutes(
        startMinutes,
        endMinutes,
        breakMinutes,
        deductionMinutes,
        leaveMinutes,
        leaveIncludesLunch,
      );
  const actualWorkText = formatDurationHHMM(actualWorkMinutes);

  const ewStartMinutes = getEwStartMinutes(startMinutes);
  const ewEndMinutes = getEwEndMinutes(ewStartMinutes, actualWorkMinutes, breakMinutes, endMinutes, deductionMinutes);

  let deemedWorkEwValue: string | null = null;
  if (workTypeCode === 2) {
    const acMinutes = getAcMinutes(startMinutes, actualWorkMinutes, breakMinutes, endMinutes, deductionMinutes);
    deemedWorkEwValue = getDeemedWorkEwValue(actualWorkMinutes, acMinutes, ewEndMinutes);
  }

  // 종일 휴가: EW는 NPM(휴가 상신)으로만 보내야 하므로 EW 시간/코드는 '휴가'로 명시.
  //   기존엔 09:00~10:00 같은 1시간짜리 EW가 자동으로 들어가서 사용자가 헷갈렸음.
  const ewValue = input.isFullDayLeave
    ? '휴가'
    : getFinalEwValue(workTypeCode, ewStartMinutes, ewEndMinutes, deemedWorkEwValue);
  // 종일 휴가면 점심도 안 먹으니 X(자동 점심 차감)도 0으로 표시.
  const effectiveDeductionMinutes = input.isFullDayLeave ? 0 : deductionMinutes;
  // workSubType — explicit input 우선, 없으면 라벨에서 추출
  const workSubType: WorkSubType =
    input.workSubType !== undefined ? input.workSubType : getWorkSubTypeFromLabel(input.workTypeLabel);
  const dateText = formatKoreanDate(input.leaveDate);
  // 시트 동일: (휴게시간 : K) — 사용자 입력 K값 그대로 표시 (점심은 자동이라 K에 포함 안 됨)
  const breakTimeText = formatDurationHHMM(breakMinutes);
  // 휴가 시간이 있을 때만 복사 문구에 (휴가시간 : HH:MM) 포함
  const leaveTimeText = leaveMinutes > 0 ? formatDurationHHMM(leaveMinutes) : undefined;

  // 종료시간이 명일이면 27:00 형식으로 표시
  const isNextDay = endMinutes < startMinutes
  const displayEndTimeText = isNextDay
    ? formatTimeOver24(endMinutes + 1440)
    : input.endTime

  // v1.64 — 8H 미만 + 점심 안 가짐 옵션 처리.
  //   - showLunchSkipRadio: UI 라디오 노출 트리거 (실근무 < 8H + 종일휴가 X)
  //   - lunchSkipApplied: 사용자가 "아니오(점심 안 가짐)" 선택 + 라디오 노출 조건 만족
  //   - 적용 시 endTimeText만 +60분 보정. EW 계산·차감·실근무 시간은 변동 없음.
  //   - 24시 넘기는 케이스도 그대로 +60분 (formatTimeOver24가 27:00, 33:30 같은 표기 지원).
  const showLunchSkipRadio = !input.isFullDayLeave && actualWorkMinutes < 8 * 60;
  const lunchSkipApplied = !!input.lunchSkipped && showLunchSkipRadio;
  const displayEndTimeForCopy = lunchSkipApplied
    ? formatTimeOver24((isNextDay ? endMinutes + 1440 : endMinutes) + 60)
    : displayEndTimeText;

  const baseCopyText = buildCopyText({
    dateText,
    workLocation: input.workLocation,
    startTimeText: input.startTime,
    endTimeText: displayEndTimeForCopy,
    actualWorkText,
    breakTimeText,
    leaveTimeText,
    ewValue,
    workContent: input.workContent,
    breakReason: input.breakReason,
  });
  // 점심시간 자동 처리에 어색한 케이스:
  //   1) 실근무 4h 이하 (= 240분 이하)
  //   2) 공휴일근로 (workTypeCode=3): X=0
  // → 사용자가 직접 휴게/점심 시간 검토 후 EW 상신하도록 안내 + copyText에도 명시.
  // 종일 휴가는 EW 자체가 NPM으로 가므로 advisory 무관 — 끔.
  // v1.64: lunch_skipped로 사용자가 명시 선택한 경우 별도 suffix가 붙으므로 이 advisory는 끔.
  const showLunchAdvisory = !input.isFullDayLeave && !lunchSkipApplied && (actualWorkMinutes <= 4 * 60 || workTypeCode === 3);
  const lunchAdvisorySuffix = showLunchAdvisory ? ' / 휴게시간 주의하여 상신' : '';
  // v1.60 — 8H 미만 휴가가 있는 일자엔 copyText 끝에 안내 suffix. 호출처에서 통째로 넘김.
  const leaveNoticeSuffix = input.leaveCopyTextNotice ? input.leaveCopyTextNotice : '';
  // v1.64 — 8H 미만 근무 시 점심 가졌는지 명시 표기.
  //   - lunchSkipApplied=true:  " / 8H 미만 근무이며, 점심시간 가지지 않음" (+endTime 보정 완료)
  //   - lunchSkipApplied=false & showLunchSkipRadio=true: " / 8H 미만 근무이며, 점심시간 가짐"
  //   - showLunchSkipRadio=false (8H 이상 또는 종일휴가): suffix 안 붙임
  const lunchSkipSuffix = showLunchSkipRadio
    ? (lunchSkipApplied
        ? ' / 8H 미만 근무이며, 점심시간 가지지 않음'
        : ' / 8H 미만 근무이며, 점심시간 가짐')
    : '';
  const copyText = baseCopyText + getCopyTextSuffix(workSubType) + lunchAdvisorySuffix + leaveNoticeSuffix + lunchSkipSuffix;

  // 총 근무 (퇴 - 출, 자정 넘김 자동 가산)
  const totalSpanMinutes = diffMinutes(startMinutes, endMinutes);

  return {
    workTypeCode,
    workSubType,
    deductionMinutes: effectiveDeductionMinutes,
    actualWorkMinutes,
    actualWorkText,
    dateText,
    ewStartText: formatTimeHHMM(ewStartMinutes),
    ewEndText: formatTimeOver24(ewEndMinutes),
    ewValue,
    copyText,
    showLunchAdvisory,
    showLunchSkipRadio,
    startTimeText: input.startTime,
    endTimeText: displayEndTimeText,
    totalSpanMinutes,
    breakMinutes,
    leaveMinutes,
    isFullDayLeave: !!input.isFullDayLeave,
  };
}
