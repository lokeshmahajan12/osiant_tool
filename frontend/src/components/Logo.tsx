export function Logo({ size = 34 }: { size?: number }) {
  return (
    <div className="flex items-center gap-2.5">
      <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden>
        <rect width="32" height="32" rx="7" fill="#111a2c" stroke="#22d3ee" strokeOpacity="0.4" />
        <path d="M8 18a8 8 0 0 1 16 0" stroke="#22d3ee" strokeWidth="2.4" strokeLinecap="round" />
        <circle cx="16" cy="18" r="3" fill="#22d3ee" />
        <path d="M16 9V7" stroke="#22d3ee" strokeWidth="2.4" strokeLinecap="round" />
      </svg>
      <div className="leading-tight">
        <div className="font-mono text-sm font-bold tracking-[0.2em] text-slate-100">
          SENTINEL
        </div>
        <div className="text-[10px] uppercase tracking-[0.22em] text-accent-dim">OSINT Platform</div>
      </div>
    </div>
  );
}
