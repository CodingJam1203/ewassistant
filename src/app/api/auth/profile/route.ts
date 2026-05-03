import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * GET /api/auth/profile
 * 현재 로그인한 사용자의 프로필 (division, team, display_name 등) 반환
 * history 페이지 필터 기본값 등에 사용
 */
export async function GET() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const adminClient = createAdminClient()
    const { data: profile, error } = await adminClient
      .from('user_profiles')
      .select('email, display_name, division, team, role, is_active')
      .eq('id', user.id)
      .single()

    if (error || !profile) {
      // id로 못 찾으면 email로 시도
      const { data: profileByEmail } = await adminClient
        .from('user_profiles')
        .select('email, display_name, division, team, role, is_active')
        .eq('email', user.email)
        .single()

      if (!profileByEmail) {
        return NextResponse.json({ error: '프로필을 찾을 수 없습니다.' }, { status: 404 })
      }
      return NextResponse.json(profileByEmail)
    }

    return NextResponse.json(profile)
  } catch (err: any) {
    console.error('Profile GET Error:', err)
    return NextResponse.json({ error: '서버 에러가 발생했습니다.' }, { status: 500 })
  }
}

/**
 * PATCH /api/auth/profile
 * 현재 로그인한 사용자의 display_name 업데이트
 * body: { display_name: string }
 */
export async function PATCH(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const display_name = typeof body.display_name === 'string' ? body.display_name.trim() : null

    if (!display_name) {
      return NextResponse.json({ error: '이름을 입력해주세요.' }, { status: 400 })
    }

    const adminClient = createAdminClient()

    // id로 먼저 시도
    const { error } = await adminClient
      .from('user_profiles')
      .update({ display_name })
      .eq('id', user.id)

    if (error) {
      // fallback: email로 시도
      const { error: error2 } = await adminClient
        .from('user_profiles')
        .update({ display_name })
        .eq('email', user.email)

      if (error2) {
        return NextResponse.json({ error: error2.message }, { status: 500 })
      }
    }

    return NextResponse.json({ display_name })
  } catch (err: any) {
    console.error('Profile PATCH Error:', err)
    return NextResponse.json({ error: '서버 에러가 발생했습니다.' }, { status: 500 })
  }
}
