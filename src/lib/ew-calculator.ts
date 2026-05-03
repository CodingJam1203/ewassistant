export type WorkTypeCode = 1 | 2 | 3;

export interface EwInput {
  name: string;
  workTypeLabel: string;
  leaveDate: string;
  startTime: string; // "HH:mm"
  endTime: string; // "HH:mm"
  breakTime: string; // "HH:mm"
  workLocation: string;
  workContent?: string;
  breakReason?: string;
}

export interface EwCalculationResult {
  workTypeCode: WorkTypeCode;
  deductionMinutes: number;
  actualWorkMinutes: number;
  actualWorkText: string;
  dateText: string;
  ewStartText: string;
  ewEndText: string;
  ewValue: string;
  copyText: string;
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
  if (normalized === "기본근무 등록") return 1;
  if (normalized === "간주근로 등록") return 2;
  if (normalized === "공휴일근로 등록") return 3;
  throw new Error(`지원하지 않는 근무유형입니다: ${normalized}`);
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

// 분(minutes)을 시간(HH:mm)으로 변환
export function formatTimeHHMM(totalMinutes: number): string {
  const normalized = ((totalMinutes % 1440) + 1440) % 1440;
  const hours = Math.floor(normalized / 60);
  const minutes = normalized % 60;
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

// 7.3 실근무시간 Y
export function getActualWorkMinutes(
  startMinutes: number,
  endMinutes: number,
  breakMinutes: number,
  deductionMinutes: number
): number {
  return diffMinutes(startMinutes, endMinutes) - breakMinutes - deductionMinutes;
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

// 7.7 EW 종료시간 AH
export function getEwEndMinutes(
  ewStartMinutes: number,
  actualWorkMinutes: number,
  deductionMinutes: number
): number {
  return ewStartMinutes + actualWorkMinutes + deductionMinutes;
}

// 7.8 간주근로용 AC
export function getAcMinutes(
  startMinutes: number,
  actualWorkMinutes: number,
  deductionMinutes: number
): number {
  return startMinutes + actualWorkMinutes + deductionMinutes;
}

// 7.9 간주근로 EW 값 AB
export function getDeemedWorkEwValue(
  actualWorkMinutes: number,
  acMinutes: number,
  ewEndMinutes: number
): string {
  if (actualWorkMinutes < 8 * 60) {
    return `${formatTimeHHMM(acMinutes)}~${formatTimeHHMM(ewEndMinutes)}`;
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

  throw new Error("간주근로 시간이 16:30을 초과했습니다.");
}

// 7.10 최종 EW 값
export function getFinalEwValue(
  workTypeCode: WorkTypeCode,
  ewStartMinutes: number,
  ewEndMinutes: number,
  deemedWorkEwValue: string | null
): string {
  if (workTypeCode === 1 || workTypeCode === 3) {
    return `${formatTimeHHMM(ewStartMinutes)}~${formatTimeHHMM(ewEndMinutes)}`;
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
  breakTimeText: string;
  ewValue: string;
  workContent?: string;
  breakReason?: string;
}): string {
  let text = `${params.dateText} ${params.workLocation} ${params.startTimeText}~${params.endTimeText} (실근무시간 : ${params.actualWorkText}) (휴게시간 : ${params.breakTimeText}) EW : ${params.ewValue}`;
  if (params.workContent) {
    text += ` //⭐근무⭐ ${params.workContent}`;
  }
  if (params.breakReason) {
    text += ` //🌳휴게🌳 ${params.breakReason}`;
  }
  return text;
}

// 메인 계산 함수
export function calculateEw(input: EwInput): EwCalculationResult {
  const workTypeCode = getWorkTypeCode(input.workTypeLabel);
  const deductionMinutes = getDeductionMinutes(workTypeCode);
  
  const startMinutes = parseTimeHHMM(input.startTime);
  const endMinutes = parseTimeHHMM(input.endTime);
  const breakMinutes = parseTimeHHMM(input.breakTime || "00:00");
  
  const actualWorkMinutes = getActualWorkMinutes(startMinutes, endMinutes, breakMinutes, deductionMinutes);
  const actualWorkText = formatDurationHHMM(actualWorkMinutes);
  
  const ewStartMinutes = getEwStartMinutes(startMinutes);
  const ewEndMinutes = getEwEndMinutes(ewStartMinutes, actualWorkMinutes, deductionMinutes);
  
  let deemedWorkEwValue: string | null = null;
  if (workTypeCode === 2) {
    const acMinutes = getAcMinutes(startMinutes, actualWorkMinutes, deductionMinutes);
    deemedWorkEwValue = getDeemedWorkEwValue(actualWorkMinutes, acMinutes, ewEndMinutes);
  }
  
  const ewValue = getFinalEwValue(workTypeCode, ewStartMinutes, ewEndMinutes, deemedWorkEwValue);
  const dateText = formatKoreanDate(input.leaveDate);
  const breakTimeText = formatDurationHHMM(breakMinutes);

  const copyText = buildCopyText({
    dateText,
    workLocation: input.workLocation,
    startTimeText: input.startTime,
    endTimeText: input.endTime,
    actualWorkText,
    breakTimeText,
    ewValue,
    workContent: input.workContent,
    breakReason: input.breakReason,
  });

  return {
    workTypeCode,
    deductionMinutes,
    actualWorkMinutes,
    actualWorkText,
    dateText,
    ewStartText: formatTimeHHMM(ewStartMinutes),
    ewEndText: formatTimeHHMM(ewEndMinutes),
    ewValue,
    copyText,
  };
}
