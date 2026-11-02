export function Mark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" className="mark">
      <circle cx="16" cy="16" r="14.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="16" cy="16" r="10.5" fill="none" stroke="currentColor" strokeWidth="0.75" strokeDasharray="1.2 2.2" opacity=".55" />
      <g stroke="currentColor" strokeWidth="0.7" opacity=".45">
        <path d="M16 6.5 14.4 25.5" />
        <path d="M10.5 11.6 21.5 14.7" />
      </g>
      <circle cx="16" cy="6.5" r="1.5" fill="var(--terra)" />
      <circle cx="10.5" cy="11.6" r="1.15" fill="currentColor" />
      <circle cx="21.5" cy="14.7" r="1.35" fill="currentColor" />
      <circle cx="12.6" cy="16.9" r="0.85" fill="currentColor" opacity=".8" />
      <g className="mark-hero">
        <circle cx="14.4" cy="25.5" r="1.6" fill="currentColor" />
        <path d="M14.4 22.3v-1.2M14.4 28.7v1.2M11.2 25.5h-1.2M17.6 25.5h1.2" stroke="currentColor" strokeWidth="0.8" opacity=".7" />
      </g>
    </svg>
  );
}

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <span className="logo">
      <Mark />
      <span className="logo-text">
        <b>词光</b>
        {!compact && <small>Word Atlas</small>}
      </span>
    </span>
  );
}
