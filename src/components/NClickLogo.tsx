export default function NClickLogo({ className = '' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 168 40"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="N-Click"
      role="img"
    >
      <defs>
        <linearGradient id="nclick-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%"   stopColor="#3B82F6"/>
          <stop offset="100%" stopColor="#4F46E5"/>
        </linearGradient>
        <linearGradient id="nclick-text" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%"   stopColor="#1D4ED8"/>
          <stop offset="100%" stopColor="#0F172A"/>
        </linearGradient>
      </defs>
      {/* 배경 — 둥근 그라디언트 사각형 */}
      <rect x="0" y="0" width="40" height="40" rx="9" fill="url(#nclick-bg)"/>
      {/* 흰색 N (조금 더 두꺼운 sans-serif 느낌) */}
      <path d="M9.5 31V9h4.2l9 13.6V9h4.3v22h-4.2l-9-13.6V31z" fill="#fff"/>
      {/* 클릭 커서 — N의 오른쪽 아래 모서리 */}
      <g transform="translate(25.6, 22.2)">
        <path
          d="M0 0 L0 11.4 L3.2 8.3 L5.7 13.4 L7.4 12.6 L4.9 7.5 L9 7.5 Z"
          fill="#ffffff"
          stroke="#4F46E5"
          strokeWidth="0.7"
          strokeLinejoin="round"
        />
      </g>
      {/* "N-Click" 워드마크 */}
      <text
        x="48" y="28"
        fontFamily="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
        fontWeight="800" fontSize="20" letterSpacing="-0.5"
        fill="url(#nclick-text)"
      >N-Click</text>
      {/* "i" 위 dot 액센트 (Click의 i 위치, 시각적 포인트) */}
      <circle cx="120.5" cy="13" r="1.7" fill="#3B82F6"/>
    </svg>
  )
}
