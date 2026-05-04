export default function NClickLogo({ className = '' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 124 32"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="N-Click"
      role="img"
    >
      {/* N 박스 */}
      <rect x="0" y="1" width="30" height="30" rx="6" fill="#1B4F8A"/>
      {/* N 글자 */}
      <path d="M8 23V9h2.8l6.4 9.2V9H20v14h-2.8L10.8 13.8V23H8z" fill="white"/>
      {/* 파란 점 (클릭 커서) */}
      <circle cx="25" cy="24" r="3.5" fill="#60A5FA"/>
      {/* -Click 텍스트 */}
      <text x="36" y="22" fontFamily="Arial, Helvetica, sans-serif" fontWeight="700" fontSize="15" fill="#1B4F8A">-Click</text>
    </svg>
  )
}
