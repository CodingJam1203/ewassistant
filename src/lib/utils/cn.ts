/**
 * className concatenation helper.
 * - falsy 제거 (undefined, null, false, '')
 * - 마지막 공백 정리
 * 외부 의존(clsx 등) 없이 가볍게.
 */
export function cn(...inputs: Array<string | undefined | null | false>): string {
  return inputs.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim()
}
