import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import Navbar from "@/components/Navbar";

const inter = Inter({ subsets: ["latin"] });

// 환경변수 우선, 없으면 Vercel 기본 도메인
const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? 'https://ewassistant.vercel.app'

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'N-Click — 출퇴근보고 한 번에',
    template: '%s · N-Click',
  },
  description:
    '클릭 한 번으로 끝나는 NHR 사내 출퇴근 보고 도구. 출퇴근 기록, 휴게/휴가, EW 계산, Teams 알림까지 자동화.',
  applicationName: 'N-Click',
  keywords: ['N-Click', 'NHR', '출퇴근', '근태', 'EW', '근로시간', '휴게', '휴가'],
  authors: [{ name: 'NHR' }],
  // icon.tsx / apple-icon.tsx / opengraph-image.tsx 는 Next.js가 자동 주입
  openGraph: {
    type: 'website',
    locale: 'ko_KR',
    url: SITE_URL,
    siteName: 'N-Click',
    title: 'N-Click — 출퇴근보고 한 번에',
    description:
      '클릭 한 번으로 끝나는 NHR 사내 출퇴근 보고 도구. 출퇴근 기록·휴게·휴가·EW 계산·Teams 알림까지 자동화.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'N-Click — 출퇴근보고 한 번에',
    description:
      '클릭 한 번으로 끝나는 NHR 사내 출퇴근 보고 도구.',
  },
  robots: {
    // 사내 도구라 검색 노출 방지
    index: false,
    follow: false,
    googleBot: { index: false, follow: false },
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body className={`${inter.className} bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100 min-h-screen`}>
        <Navbar />
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {children}
        </main>
      </body>
    </html>
  );
}
