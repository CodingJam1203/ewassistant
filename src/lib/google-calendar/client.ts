/**
 * Google Calendar API client — Service Account 인증.
 *
 * 정책:
 *   - 단일 service account (env `GOOGLE_SERVICE_ACCOUNT_KEY`) 가 모든 등록된 캘린더에
 *     관리자 권한으로 공유됨. N-Click 백엔드가 사용자 대신 일정을 등록·수정·삭제.
 *   - 사용자 OAuth flow 없음. 사용자 Google 계정에 영향 주지 않음.
 *
 * env 형식:
 *   GOOGLE_SERVICE_ACCOUNT_KEY = service account JSON 파일 전체를 그대로 (1줄 문자열로) 등록.
 *   Vercel env에 등록한 경우 줄바꿈은 자동 처리됨.
 *
 * client wrapper는 module-level 캐싱 (cold start 1회 JWT 생성).
 */

import { JWT } from 'google-auth-library'
import { google, type calendar_v3 } from 'googleapis'

interface ServiceAccountCreds {
  client_email: string
  private_key: string
}

function loadServiceAccountCreds(): ServiceAccountCreds {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY
  if (!raw) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY env 미설정')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY JSON 파싱 실패 — 따옴표/줄바꿈 escape 확인')
  }
  const obj = parsed as { client_email?: string; private_key?: string }
  if (!obj.client_email || !obj.private_key) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY 에 client_email/private_key 필드 누락')
  }
  // Vercel env로 들어올 때 \n이 literal로 들어오는 케이스 보정
  const privateKey = obj.private_key.replace(/\\n/g, '\n')
  return { client_email: obj.client_email, private_key: privateKey }
}

let _client: calendar_v3.Calendar | null = null
let _authEmail: string | null = null

/** singleton Google Calendar client (Service Account 기반) */
export function getGoogleCalendarClient(): calendar_v3.Calendar {
  if (_client) return _client
  const creds = loadServiceAccountCreds()
  const auth = new JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: [
      // events read/write 가능. calendar.readonly는 부족 — write 필요해서 둘 다 포함.
      'https://www.googleapis.com/auth/calendar',
      'https://www.googleapis.com/auth/calendar.events',
    ],
  })
  _client = google.calendar({ version: 'v3', auth })
  _authEmail = creds.client_email
  return _client
}

/** service account 이메일 (캘린더 공유 안내용) */
export function getServiceAccountEmail(): string {
  if (_authEmail) return _authEmail
  return loadServiceAccountCreds().client_email
}

/**
 * org_calendars.google_calendar_id 컬럼은 두 형태가 혼재:
 *   - raw ID: "abc123@group.calendar.google.com"
 *   - private iCal URL: "https://calendar.google.com/calendar/ical/<encoded-id>/private-XXX/basic.ics"
 *
 * Google Calendar API의 calendarId 파라미터는 raw ID(이메일 형태)를 요구하므로 URL인 경우 추출.
 */
export function extractCalendarRawId(input: string): string {
  if (!input) return input
  if (input.startsWith('https://')) {
    // /calendar/ical/<encoded-id>/private-XXX/basic.ics 또는 /calendar/ical/<encoded-id>/public/basic.ics
    const m = input.match(/\/calendar\/ical\/([^/]+)\//)
    if (m) {
      // %40 → @ 등 URL decode
      try {
        return decodeURIComponent(m[1])
      } catch {
        return m[1]
      }
    }
    return input
  }
  return input
}
