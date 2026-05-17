import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-check'
import { createAdminClient } from '@/lib/supabase/admin'

// GET /api/admin/users — 전체 계정 목록 (관리자 전용)
export async function GET() {
  const adminUser = await requireAdmin()
  if (!adminUser) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const adminClient = createAdminClient()

  // auth.users에서 last_sign_in_at 가져오기
  const { data: authData, error: authError } = await adminClient.auth.admin.listUsers({ perPage: 1000 })
  if (authError) {
    console.error('[admin/users] auth.listUsers error:', authError.message)
    return NextResponse.json({ error: '사용자 목록 조회에 실패했습니다.' }, { status: 500 })
  }

  // user_profiles 전체 조회
  const { data: profiles, error: profileError } = await adminClient
    .from('user_profiles')
    .select('*')
    .order('created_at', { ascending: false })

  if (profileError) {
    console.error('[admin/users] profiles select error:', profileError.message)
    return NextResponse.json({ error: '사용자 프로필 조회에 실패했습니다.' }, { status: 500 })
  }

  // auth.users 맵 (email → user)
  const authMap = new Map(authData.users.map((u: any) => [u.email, u]))

  const result = (profiles ?? []).map(profile => {
    const authUser = authMap.get(profile.email) as any
    return {
      email: profile.email,
      id: profile.id ?? authUser?.id ?? null,
      display_name: profile.display_name ?? null,
      division: profile.division ?? null,
      team: profile.team ?? null,
      role: profile.role,
      is_active: profile.is_active,
      is_pre_registered: false,
      created_at: profile.created_at,
      last_login_at: profile.last_login_at ?? authUser?.last_sign_in_at ?? null,
      last_submitted_at: profile.last_submitted_at ?? null,
    }
  })

  // pre_approved_emails도 포함 (아직 로그인 안 한 사전등록 계정)
  const { data: preApproved } = await adminClient
    .from('pre_approved_emails')
    .select('*')
    .order('created_at', { ascending: false })

  const preResult = (preApproved ?? []).map((p: any) => ({
    email: p.email,
    id: null,
    display_name: p.display_name ?? null,
    division: p.division ?? null,
    team: p.team ?? null,
    role: p.role,
    is_active: true,
    is_pre_registered: true,
    created_at: p.created_at,
    last_login_at: null,
    last_submitted_at: null,
  }))

  return NextResponse.json([...result, ...preResult])
}

// POST /api/admin/users — 이메일 사전 등록 (관리자 전용)
export async function POST(request: Request) {
  const adminUser = await requireAdmin()
  if (!adminUser) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json()
  const { email, display_name, division, team, role } = body

  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return NextResponse.json({ error: '유효한 이메일을 입력해주세요.' }, { status: 400 })
  }

  const normalizedEmail = email.toLowerCase().trim()
  const adminClient = createAdminClient()

  // 이미 user_profiles에 등록된 경우
  const { data: existingProfile } = await adminClient
    .from('user_profiles')
    .select('email')
    .eq('email', normalizedEmail)
    .maybeSingle()

  if (existingProfile) {
    return NextResponse.json({ error: '이미 등록된 이메일입니다.' }, { status: 409 })
  }

  // 이미 pre_approved_emails에 등록된 경우
  const { data: existingPre } = await adminClient
    .from('pre_approved_emails')
    .select('email')
    .eq('email', normalizedEmail)
    .maybeSingle()

  if (existingPre) {
    return NextResponse.json({ error: '이미 사전 등록된 이메일입니다.' }, { status: 409 })
  }

  // pre_approved_emails에 사전 등록
  const { data, error } = await adminClient
    .from('pre_approved_emails')
    .insert({
      email: normalizedEmail,
      display_name: display_name?.trim() || null,
      division: division?.trim() || null,
      team: team?.trim() || null,
      role: role === 'admin' ? 'admin' : role === 'leader' ? 'leader' : 'user',
    })
    .select()
    .single()

  if (error) {
    // 상세는 server 로그에만 (스키마 추측 방지). 사용자에겐 일반 메시지.
    console.error('[admin/users POST] error:', error)
    return NextResponse.json(
      { error: '사용자 추가에 실패했습니다.' },
      { status: 500 },
    )
  }

  return NextResponse.json(data, { status: 201 })
}
