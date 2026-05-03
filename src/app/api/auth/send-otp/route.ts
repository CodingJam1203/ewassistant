import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: Request) {
  try {
    const { email } = await request.json()

    if (!email) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 })
    }

    // Domain validation (Optional)
    const allowedDomainsStr = process.env.ALLOWED_EMAIL_DOMAINS || ''
    const allowedDomains = allowedDomainsStr ? allowedDomainsStr.split(',') : []
    const domain = email.split('@')[1]?.toLowerCase()
    
    if (allowedDomains.length > 0 && !allowedDomains.includes(domain)) {
      return NextResponse.json({ error: '허용되지 않은 이메일 도메인입니다.' }, { status: 403 })
    }

    const supabase = await createClient()

    // Send OTP magic link
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${process.env.APP_URL}/auth/callback`,
      },
    })

    if (error) {
      console.error('Error sending OTP:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ message: 'OTP sent successfully' })
  } catch (err: any) {
    console.error('API Error:', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
