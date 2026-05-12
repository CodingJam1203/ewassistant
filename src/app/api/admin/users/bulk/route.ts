import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-check'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * POST /api/admin/users/bulk
 *
 * 다수의 계정을 한 번에 사전 등록 (pre_approved_emails INSERT).
 *
 * Body:
 *   { users: Array<{ email, display_name?, division?, team?, role? }> }
 *
 * 처리:
 *   - 이미 user_profiles 또는 pre_approved_emails에 존재 → skipped
 *   - 검증 실패 (이메일 형식 등) → failed
 *   - 성공 → succeeded
 *   - 약관/개인정보 동의는 최초 로그인 시점에 받음 (admin은 동의 정보 X)
 *
 * 응답:
 *   {
 *     succeeded: Array<{ email, display_name?, ... }>,
 *     failed: Array<{ email, reason }>,
 *     skipped: Array<{ email, reason }>,
 *   }
 */

interface BulkUserInput {
  email?: string
  display_name?: string | null
  division?: string | null
  team?: string | null
  role?: string | null
}

interface ResultRow {
  email: string
  display_name?: string | null
  division?: string | null
  team?: string | null
  role?: string | null
}

interface ErrorRow {
  email: string
  reason: string
}

function normalizeRole(raw: string | null | undefined): 'user' | 'leader' | 'admin' {
  if (!raw) return 'user'
  const r = raw.trim().toLowerCase()
  if (r === 'admin' || r === '관리자') return 'admin'
  if (r === 'leader' || r === '리더') return 'leader'
  return 'user'
}

function isValidEmail(s: string | undefined | null): s is string {
  if (typeof s !== 'string') return false
  const t = s.trim()
  if (!t || !t.includes('@')) return false
  // 기본 형식 — too strict는 피함
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)
}

export async function POST(request: Request) {
  const adminUser = await requireAdmin()
  if (!adminUser) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json().catch(() => null)
  const users: BulkUserInput[] = Array.isArray(body?.users) ? body.users : []
  if (users.length === 0) {
    return NextResponse.json({ error: '등록할 계정이 없습니다.' }, { status: 400 })
  }
  if (users.length > 500) {
    return NextResponse.json({ error: '한 번에 최대 500건까지 등록 가능합니다.' }, { status: 400 })
  }

  const adminClient = createAdminClient()

  // ── 사전 정규화 + 입력 단계 검증 ──────────────────────────────────────────
  const normalized: Array<{ email: string; data: BulkUserInput }> = []
  const failed: ErrorRow[] = []
  const seenInBatch = new Set<string>()

  for (const raw of users) {
    if (!isValidEmail(raw.email)) {
      failed.push({ email: String(raw.email ?? '(빈 값)'), reason: '이메일 형식이 잘못되었습니다.' })
      continue
    }
    const email = raw.email!.toLowerCase().trim()
    if (seenInBatch.has(email)) {
      failed.push({ email, reason: '입력 안에 중복된 이메일이 있습니다.' })
      continue
    }
    seenInBatch.add(email)
    normalized.push({ email, data: raw })
  }

  if (normalized.length === 0) {
    return NextResponse.json({
      succeeded: [],
      failed,
      skipped: [],
    })
  }

  // ── 기존 등록 여부를 한 번에 조회 (효율) ──────────────────────────────────
  const emails = normalized.map(n => n.email)

  const [profileRes, preRes] = await Promise.all([
    adminClient.from('user_profiles').select('email').in('email', emails),
    adminClient.from('pre_approved_emails').select('email').in('email', emails),
  ])

  const existingProfiles = new Set(
    ((profileRes.data ?? []) as Array<{ email: string }>).map(r => r.email),
  )
  const existingPre = new Set(
    ((preRes.data ?? []) as Array<{ email: string }>).map(r => r.email),
  )

  const skipped: ErrorRow[] = []
  const toInsert: Array<{
    email: string
    display_name: string | null
    division: string | null
    team: string | null
    role: 'user' | 'leader' | 'admin'
  }> = []

  for (const { email, data } of normalized) {
    if (existingProfiles.has(email)) {
      skipped.push({ email, reason: '이미 가입된 계정입니다.' })
      continue
    }
    if (existingPre.has(email)) {
      skipped.push({ email, reason: '이미 사전 등록된 이메일입니다.' })
      continue
    }
    toInsert.push({
      email,
      display_name: data.display_name?.toString().trim() || null,
      division: data.division?.toString().trim() || null,
      team: data.team?.toString().trim() || null,
      role: normalizeRole(data.role ?? null),
    })
  }

  let succeeded: ResultRow[] = []

  if (toInsert.length > 0) {
    const { data: inserted, error } = await adminClient
      .from('pre_approved_emails')
      .insert(toInsert)
      .select('email, display_name, division, team, role')

    if (error) {
      // 단일 트랜잭션 실패 — 전체 실패로 표시
      const errObj = error as { message?: string; details?: string; hint?: string; code?: string }
      const detail =
        errObj.message || errObj.details || errObj.hint || errObj.code || JSON.stringify(error)
      console.error('[admin/users/bulk] insert error:', errObj)
      for (const row of toInsert) {
        failed.push({ email: row.email, reason: `INSERT 실패: ${detail}` })
      }
    } else {
      succeeded = (inserted ?? []) as ResultRow[]
    }
  }

  return NextResponse.json({ succeeded, failed, skipped })
}
