// Next.js 자동 favicon — /favicon.ico 대신 동적 PNG 생성
// (앱 라우트 컨벤션: src/app/icon.tsx → /icon → meta 자동 주입)

import { ImageResponse } from 'next/og'

export const size = { width: 32, height: 32 }
export const contentType = 'image/png'
export const runtime = 'edge'

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          background: 'linear-gradient(135deg, #3B82F6 0%, #4F46E5 100%)',
          borderRadius: 6,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'white',
          fontSize: 22,
          fontWeight: 900,
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          letterSpacing: -1,
        }}
      >
        N
      </div>
    ),
    { ...size }
  )
}
