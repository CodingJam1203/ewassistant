/**
 * /my-logs는 /home으로 흡수되어 더 이상 사용하지 않음.
 * 기존 즐겨찾기/링크 호환을 위해 /home으로 리다이렉트.
 */
import { redirect } from 'next/navigation'

export default function MyLogsRedirect() {
  redirect('/home')
}
