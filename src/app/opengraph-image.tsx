// 링크 미리보기(Teams/Slack/카카오톡/Twitter 등) 이미지 — Next.js 자동 인식
// (앱 라우트 컨벤션: src/app/opengraph-image.tsx → og:image meta 자동 주입)

import { ImageResponse } from 'next/og'

export const alt = 'N-Click — 출퇴근보고 자동화 도구'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'
export const runtime = 'edge'

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          background:
            'linear-gradient(135deg, #EFF6FF 0%, #E0E7FF 60%, #DBEAFE 100%)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          padding: 80,
        }}
      >
        {/* 로고 + 텍스트 */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 36,
          }}
        >
          {/* N 아이콘 박스 */}
          <div
            style={{
              width: 200,
              height: 200,
              background:
                'linear-gradient(135deg, #3B82F6 0%, #4F46E5 100%)',
              borderRadius: 40,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'white',
              fontSize: 150,
              fontWeight: 900,
              letterSpacing: -6,
              boxShadow: '0 20px 50px rgba(59, 130, 246, 0.35)',
            }}
          >
            N
          </div>
          {/* 텍스트 */}
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div
              style={{
                fontSize: 130,
                fontWeight: 900,
                color: '#0F172A',
                letterSpacing: -4,
                lineHeight: 1,
              }}
            >
              N-Click
            </div>
            <div
              style={{
                fontSize: 32,
                fontWeight: 600,
                color: '#1D4ED8',
                marginTop: 16,
                letterSpacing: -0.5,
              }}
            >
              출퇴근보고 · EW 계산 · 한 번에
            </div>
          </div>
        </div>

        {/* 하단 부제 */}
        <div
          style={{
            marginTop: 60,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <div
            style={{
              fontSize: 28,
              color: '#475569',
              fontWeight: 500,
            }}
          >
            클릭 한 번으로 끝나는 NHR 사내 출퇴근 도구
          </div>
          <div
            style={{
              fontSize: 22,
              color: '#94A3B8',
              fontWeight: 500,
            }}
          >
            ewassistant.vercel.app
          </div>
        </div>
      </div>
    ),
    { ...size }
  )
}
