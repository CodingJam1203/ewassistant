import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-check'

// GET /api/admin/check — 관리자 여부 확인
export async function GET() {
  const adminUser = await requireAdmin()
  return NextResponse.json({ isAdmin: !!adminUser })
}
