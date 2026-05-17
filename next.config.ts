import type { NextConfig } from "next";

/**
 * 보안 HTTP 헤더 — 전 경로 적용.
 *
 * - HSTS: Vercel은 항상 HTTPS — 브라우저가 HTTP 강제 차단. preload 디렉티브로
 *         HSTS preload list 등록 가능 (Vercel 도메인은 이미 등록되어 있음).
 * - X-Frame-Options: DENY — clickjacking 방지. iframe 임베딩 차단.
 *                    (사내 포털 등에 임베드 필요 시 SAMEORIGIN 또는
 *                     CSP frame-ancestors로 화이트리스트).
 * - X-Content-Type-Options: nosniff — MIME 스니핑 차단.
 * - Referrer-Policy: 외부 링크 클릭 시 같은 origin은 full URL, 외부는 origin만.
 * - Permissions-Policy: 카메라/마이크/위치/USB 등 안 쓰는 권한 명시적 차단.
 */
const securityHeaders = [
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
  { key: 'X-Frame-Options',           value: 'DENY' },
  { key: 'X-Content-Type-Options',    value: 'nosniff' },
  { key: 'Referrer-Policy',           value: 'strict-origin-when-cross-origin' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  },
]

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
    ]
  },
};

export default nextConfig;
