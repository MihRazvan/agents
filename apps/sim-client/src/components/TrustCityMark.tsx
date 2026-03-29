interface Props {
  size?: number;
  className?: string;
}

export default function TrustCityMark({ size = 120, className }: Props) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 120 120"
      role="img"
      aria-label="Trust City mark"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="trust-city-core" x1="16" y1="12" x2="96" y2="104" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#62daff" />
          <stop offset="52%" stopColor="#8bb5ff" />
          <stop offset="100%" stopColor="#ffca7a" />
        </linearGradient>
        <linearGradient id="trust-city-shell" x1="8" y1="10" x2="106" y2="110" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="rgba(103, 205, 255, 0.92)" />
          <stop offset="100%" stopColor="rgba(255, 206, 129, 0.86)" />
        </linearGradient>
      </defs>

      <rect x="18" y="18" width="84" height="84" rx="24" fill="rgba(6,11,18,0.88)" stroke="url(#trust-city-shell)" strokeWidth="2.5" />
      <path d="M36 72 L60 46 L84 72" fill="none" stroke="url(#trust-city-core)" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M34 84 H86" fill="none" stroke="url(#trust-city-core)" strokeWidth="6" strokeLinecap="round" />
      <circle cx="60" cy="34" r="7" fill="url(#trust-city-core)" />
      <circle cx="36" cy="72" r="4.5" fill="#84ecff" />
      <circle cx="84" cy="72" r="4.5" fill="#ffd28d" />
      <path d="M24 52 C40 44, 80 44, 96 52" fill="none" stroke="rgba(112,196,255,0.32)" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M26 60 C42 68, 78 68, 94 60" fill="none" stroke="rgba(255,205,138,0.26)" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
