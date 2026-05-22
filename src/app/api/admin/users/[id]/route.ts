import { NextResponse } from 'next/server'
import { requireAdmin, isBootstrapAdmin } from '@/lib/admin-check'
import { createAdminClient } from '@/lib/supabase/admin'
import { recordAudit, extractRequestMeta } from '@/lib/audit-log'

// PATCH /api/admin/users/[id]
// [id] 파라미터는 URL-encoded email 값입니다 (email이 PK)
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const adminUser = await requireAdmin()
  if (!adminUser) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const targetEmail = decodeURIComponent(id)
  const body = await request.json()

  const adminClient = createAdminClient()

  // 대상 계정 조회 — user_profiles 우선, 없으면 pre_approved_emails로 fallback (사전등록 사용자)
  const { data: target, error: fetchError } = await adminClient
    .from('user_profiles')
    .select('email, id, role, is_active')
    .eq('email', targetEmail)
    .maybeSingle()

  // 사전등록 (아직 로그인 안 한) 사용자 처리 — pre_approved_emails 직접 update
  if (!target) {
    const { data: pre } = await adminClient
      .from('pre_approved_emails')
      .select('email, role')
      .eq('email', targetEmail)
      .maybeSingle()

    if (!pre) {
      return NextResponse.json({ error: '계정을 찾을 수 없습니다.' }, { status: 404 })
    }

    // pre_approved_emails는 is_active/display_order 없음 — display_name/division/team/role만 수정
    const preUpdates: Record<string, unknown> = {}
    if (typeof body.display_name === 'string') preUpdates.display_name = body.display_name.trim() || null
    if (typeof body.division === 'string')     preUpdates.division     = body.division.trim() || null
    if (typeof body.team === 'string')         preUpdates.team         = body.team.trim() || null
    if (typeof body.notify_team === 'string')  preUpdates.notify_team  = body.notify_team.trim() || null
    if (typeof body.role === 'string' && ['admin', 'leader', 'user'].includes(body.role)) {
      preUpdates.role = body.role
    }
    // 이메일 변경
    if (typeof body.email === 'string' && body.email.trim() !== targetEmail) {
      const newEmail = body.email.toLowerCase().trim()
      if (!newEmail.includes('@')) {
        return NextResponse.json({ error: '유효한 이메일 형식이 아닙니다.' }, { status: 400 })
      }
      preUpdates.email = newEmail
    }

    if (Object.keys(preUpdates).length === 0) {
      return NextResponse.json({ message: '변경된 항목이 없습니다.' })
    }

    const { error: preUpdateError } = await adminClient
      .from('pre_approved_emails')
      .update(preUpdates)
      .eq('email', targetEmail)

    if (preUpdateError) {
      const errObj = preUpdateError as { message?: string; details?: string; hint?: string; code?: string }
      const detail = errObj.message || errObj.details || errObj.hint || errObj.code || JSON.stringify(preUpdateError)
      return NextResponse.json({ error: `사전등록 계정 수정 실패: ${detail}` }, { status: 500 })
    }

    return NextResponse.json({ message: '사전등록 계정이 수정되었습니다.' })
  }

  if (fetchError) {
    return NextResponse.json({ error: '계정을 찾을 수 없습니다.' }, { status: 404 })
  }

  // 관리자 계정 보호 (부트스트랩 admin 또는 DB role='admin')
  const isProtectedAdmin = isBootstrapAdmin(target.email) || target.role === 'admin'

  if (body.is_active === false && isProtectedAdmin) {
    return NextResponse.json({ error: '관리자 계정은 비활성화할 수 없습니다.' }, { status: 400 })
  }

  // ─── 이메일 변경 처리 (PK 변경) ───────────────────────────────────────────
  if (typeof body.email === 'string' && body.email.trim() !== targetEmail) {
    const newEmail = body.email.toLowerCase().trim()

    if (!newEmail.includes('@')) {
      return NextResponse.json({ error: '유효한 이메일 형식이 아닙니다.' }, { status: 400 })
    }
    if (isBootstrapAdmin(target.email)) {
      return NextResponse.json({ error: '관리자 이메일은 변경할 수 없습니다.' }, { status: 400 })
    }

    // 새 이메일 중복 확인
    const { data: existing } = await adminClient
      .from('user_profiles')
      .select('email')
      .eq('email', newEmail)
      .single()

    if (existing) {
      return NextResponse.json({ error: '이미 사용 중인 이메일입니다.' }, { status: 409 })
    }

    // user_profiles PK 변경 (UPDATE WHERE email = old)
    // PostgreSQL은 PK 업데이트 허용
    const { error: emailUpdateError } = await adminClient
      .from('user_profiles')
      .update({ email: newEmail })
      .eq('email', targetEmail)

    if (emailUpdateError) {
      return NextResponse.json({ error: '이메일 변경 실패 (서버 에러)' }, { status: 500 })
    }

    // auth.users 이메일도 업데이트 (로그인 계정인 경우)
    if (target.id) {
      const { error: authEmailError } = await adminClient.auth.admin.updateUserById(
        target.id,
        { email: newEmail }
      )
      if (authEmailError) {
        // auth 업데이트 실패 시 rollback
        await adminClient.from('user_profiles').update({ email: targetEmail }).eq('email', newEmail)
        return NextResponse.json({ error: 'Auth 이메일 변경 실패 (서버 에러)' }, { status: 500 })
      }
    }

    // 이메일만 변경하는 경우 바로 반환
    if (Object.keys(body).length === 1) {
      const { data: updated } = await adminClient
        .from('user_profiles')
        .select()
        .eq('email', newEmail)
        .single()
      return NextResponse.json(updated)
    }

    // 이하 추가 필드도 함께 업데이트 → targetEmail을 newEmail로 교체
    // 이미 PK가 변경됐으므로 newEmail로 쿼리
    const updates: Record<string, unknown> = {}
    if (typeof body.display_name === 'string') updates.display_name = body.display_name.trim() || null
    if (typeof body.division === 'string') updates.division = body.division.trim() || null
    if (typeof body.team === 'string') updates.team = body.team.trim() || null
    if (typeof body.notify_team === 'string') updates.notify_team = body.notify_team.trim() || null
    if (typeof body.is_active === 'boolean') updates.is_active = body.is_active
    if (typeof body.display_order === 'number') updates.display_order = body.display_order
    if (typeof body.role === 'string' && !isBootstrapAdmin(target.email)) {
      updates.role = body.role === 'admin' ? 'admin' : body.role === 'leader' ? 'leader' : 'user'
    }

    if (Object.keys(updates).length > 0) {
      await adminClient.from('user_profiles').update(updates).eq('email', newEmail)
    }

    const { data: finalUpdated } = await adminClient
      .from('user_profiles')
      .select()
      .eq('email', newEmail)
      .single()

    return NextResponse.json({ ...finalUpdated, _emailChanged: true, _newEmail: newEmail })
  }

  // ─── 일반 필드 업데이트 ───────────────────────────────────────────────────
  const updates: Record<string, unknown> = {}

  if (typeof body.display_name === 'string') updates.display_name = body.display_name.trim() || null
  if (typeof body.division === 'string') updates.division = body.division.trim() || null
  if (typeof body.team === 'string') updates.team = body.team.trim() || null
  if (typeof body.notify_team === 'string') updates.notify_team = body.notify_team.trim() || null
  if (typeof body.is_active === 'boolean') updates.is_active = body.is_active
  if (typeof body.display_order === 'number') updates.display_order = body.display_order
  if (typeof body.role === 'string' && !isBootstrapAdmin(target.email)) {
    updates.role = body.role === 'admin' ? 'admin' : body.role === 'leader' ? 'leader' : 'user'
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: '변경할 항목이 없습니다.' }, { status: 400 })
  }

  const { data, error } = await adminClient
    .from('user_profiles')
    .update(updates)
    .eq('email', targetEmail)
    .select()
    .single()

  if (error) {
    console.error('Admin PATCH Error:', error)
    return NextResponse.json({ error: '서버 에러가 발생했습니다.' }, { status: 500 })
  }

  // 감사 로그 — 변경된 필드 키만 기록 (값에는 PII 가능성 있어 키만 저장)
  const meta = extractRequestMeta(request)
  recordAudit({
    actorId: adminUser.id,
    actorEmail: adminUser.email ?? null,
    action: 'admin_user_update',
    targetTable: 'user_profiles',
    targetId: target.id ?? targetEmail,
    details: { changedKeys: Object.keys(updates) },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  })

  return NextResponse.json(data)
}

// DELETE /api/admin/users/[id] — 계정 완전 삭제
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const adminUser = await requireAdmin()
  if (!adminUser) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const targetEmail = decodeURIComponent(id)
  const adminClient = createAdminClient()

  const { data: target, error: fetchError } = await adminClient
    .from('user_profiles')
    .select('email, id, role')
    .eq('email', targetEmail)
    .single()

  if (fetchError || !target) return NextResponse.json({ error: '계정을 찾을 수 없습니다.' }, { status: 404 })

  if (isBootstrapAdmin(target.email) || target.role === 'admin') {
    return NextResponse.json({ error: '관리자 계정은 삭제할 수 없습니다.' }, { status: 400 })
  }

  const meta = extractRequestMeta(request)
  const auditCommon = {
    actorId: adminUser.id,
    actorEmail: adminUser.email ?? null,
    action: 'admin_user_delete',
    targetTable: 'user_profiles',
    targetId: target.id ?? targetEmail,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  }

  // auth.users 삭제 (ON DELETE CASCADE → user_profiles 자동 삭제됨)
  if (target.id) {
    const { error: authDeleteError } = await adminClient.auth.admin.deleteUser(target.id)
    if (authDeleteError) {
      return NextResponse.json({ error: 'Auth 삭제 실패 (서버 에러)' }, { status: 500 })
    }
    recordAudit({ ...auditCommon, details: { mode: 'auth+cascade' } })
    // CASCADE로 user_profiles도 삭제됨
    return NextResponse.json({ success: true })
  }

  // 사전 등록 계정 (auth.users 없음) — user_profiles만 삭제
  const { error } = await adminClient.from('user_profiles').delete().eq('email', targetEmail)
  if (error) {
    console.error('Admin DELETE Error:', error)
    return NextResponse.json({ error: '서버 에러가 발생했습니다.' }, { status: 500 })
  }

  recordAudit({ ...auditCommon, details: { mode: 'profile-only' } })
  return NextResponse.json({ success: true })
}
