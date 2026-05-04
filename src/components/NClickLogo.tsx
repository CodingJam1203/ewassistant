export default function NClickLogo({ className = '' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 148 40"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="N-Click"
      role="img"
    >
      {/* N 박스 배경 */}
      <rect x="0" y="0" width="40" height="40" rx="8" fill="#2563EB"/>
      {/* N 글자 */}
      <path d="M9 30V10h3.6l8.4 12.4V10H25v20h-3.6L13 17.6V30H9z" fill="white"/>
      {/* 커서 아이콘 (마우스 포인터) */}
      <g transform="translate(24, 22)">
        <path d="M0 0 L0 10 L2.8 7.2 L5.2 12 L6.8 11.2 L4.4 6.4 L8 6.4 Z" fill="white" stroke="#2563EB" strokeWidth="0.5"/>
      </g>
      {/* N-Click 텍스트 */}
      <text x="48" y="27" fontFamily="-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" fontWeight="800" fontSize="18" fill="#0F172A">N-Click</text>
    </svg>
  )
}
