import { calculateEw, EwInput } from './ew-calculator';

describe('EW Calculator', () => {
  const baseInput: Omit<EwInput, 'workTypeLabel' | 'startTime' | 'endTime'> = {
    name: '김재민',
    leaveDate: '2026-05-01', // Friday
    breakTime: '00:00',
    workLocation: 'NHR타워',
  };

  test('15.1 기본근무', () => {
    const input: EwInput = { ...baseInput, workTypeLabel: '기본근무 등록', startTime: '09:00', endTime: '18:00' };
    const result = calculateEw(input);
    expect(result.deductionMinutes).toBe(60);
    expect(result.actualWorkText).toBe('08:00');
    expect(result.ewStartText).toBe('09:00');
    expect(result.ewEndText).toBe('18:00');
    expect(result.ewValue).toBe('09:00~18:00');
  });

  test('15.2 기본근무, 9시 이후 출근', () => {
    const input: EwInput = { ...baseInput, workTypeLabel: '기본근무 등록', startTime: '10:00', endTime: '19:00' };
    const result = calculateEw(input);
    expect(result.deductionMinutes).toBe(60);
    expect(result.actualWorkText).toBe('08:00');
    expect(result.ewStartText).toBe('09:00');
    expect(result.ewEndText).toBe('18:00');
    expect(result.ewValue).toBe('09:00~18:00');
  });

  test('15.3 기본근무, 9시 이전 출근', () => {
    const input: EwInput = { ...baseInput, workTypeLabel: '기본근무 등록', startTime: '08:30', endTime: '17:30' };
    const result = calculateEw(input);
    expect(result.deductionMinutes).toBe(60);
    expect(result.actualWorkText).toBe('08:00');
    expect(result.ewStartText).toBe('08:30');
    expect(result.ewEndText).toBe('17:30');
    expect(result.ewValue).toBe('08:30~17:30');
  });

  test('15.4 공휴일근로', () => {
    const input: EwInput = { ...baseInput, workTypeLabel: '공휴일근로 등록', startTime: '09:00', endTime: '18:00' };
    const result = calculateEw(input);
    expect(result.deductionMinutes).toBe(0);
    expect(result.actualWorkText).toBe('09:00');
    expect(result.ewStartText).toBe('09:00');
    expect(result.ewEndText).toBe('18:00');
    expect(result.ewValue).toBe('09:00~18:00');
  });

  test('15.5 간주근로 L1', () => {
    const input: EwInput = { ...baseInput, workTypeLabel: '간주근로 등록', startTime: '09:00', endTime: '18:00' };
    const result = calculateEw(input);
    expect(result.deductionMinutes).toBe(60);
    expect(result.actualWorkText).toBe('08:00');
    expect(result.ewValue).toBe('L1');
  });

  test('15.6 간주근로 8시간 미만', () => {
    const input: EwInput = { ...baseInput, workTypeLabel: '간주근로 등록', startTime: '10:00', endTime: '17:00' };
    const result = calculateEw(input);
    expect(result.deductionMinutes).toBe(60);
    expect(result.actualWorkText).toBe('06:00');
    expect(result.ewStartText).toBe('09:00');
    expect(result.ewEndText).toBe('16:00');
    // AC = 17:00
    // EW = 17:00~16:00
    expect(result.ewValue).toBe('17:00~16:00');
  });

  test('15.7 간주근로 L코드 경계값', () => {
    // Y = 08:30 -> L1
    let input: EwInput = { ...baseInput, workTypeLabel: '간주근로 등록', startTime: '09:00', endTime: '18:30' };
    expect(calculateEw(input).ewValue).toBe('L1');

    // Y = 08:31 -> L2
    input = { ...baseInput, workTypeLabel: '간주근로 등록', startTime: '09:00', endTime: '18:31' };
    expect(calculateEw(input).ewValue).toBe('L2');

    // Y = 09:30 -> L2
    input = { ...baseInput, workTypeLabel: '간주근로 등록', startTime: '09:00', endTime: '19:30' };
    expect(calculateEw(input).ewValue).toBe('L2');

    // Y = 09:31 -> L3
    input = { ...baseInput, workTypeLabel: '간주근로 등록', startTime: '09:00', endTime: '19:31' };
    expect(calculateEw(input).ewValue).toBe('L3');

    // Y = 16:30 -> L9
    input = { ...baseInput, workTypeLabel: '간주근로 등록', startTime: '09:00', endTime: '02:30' }; // next day
    expect(calculateEw(input).ewValue).toBe('L9');

    // Y = 16:31 -> Error
    input = { ...baseInput, workTypeLabel: '간주근로 등록', startTime: '09:00', endTime: '02:31' }; // next day
    expect(() => calculateEw(input)).toThrow('간주근로 시간이 16:30을 초과했습니다.');
  });
  
  test('복사용 문구 생성', () => {
    const input: EwInput = { ...baseInput, workTypeLabel: '기본근무 등록', startTime: '09:00', endTime: '18:00' };
    const result = calculateEw(input);
    expect(result.copyText).toBe('2026-05-01 (금) NHR타워 09:00~18:00 (실근무시간 : 08:00) (휴게시간 : 00:00) EW : 09:00~18:00');
  });
});
