/**
 * The FORGEHSE mark: a 3×3 risk grid. The filled cells trace an "F" in electric blue;
 * the lower-right "critical" corner is held in teal — the one cell a safety system exists to keep empty.
 */
export function Mark({ size = 30 }: { size?: number }) {
  const c = (x: number, y: number, fill: string, op = 1) => <rect x={5 + x * 8} y={5 + y * 8} width={6.5} height={6.5} rx={1.4} fill={fill} opacity={op} />;
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <rect width="32" height="32" rx="7" fill="#13254F" />
      {c(0, 0, '#2563EB')}{c(1, 0, '#2563EB')}{c(2, 0, '#2563EB')}
      {c(0, 1, '#2563EB')}{c(1, 1, '#2563EB')}{c(2, 1, '#2563EB', 0.28)}
      {c(0, 2, '#2563EB')}{c(1, 2, '#2563EB', 0.28)}{c(2, 2, '#0E8A7E')}
    </svg>
  );
}

export function Brand({ withParent = true }: { withParent?: boolean }) {
  return (
    <span className="brand">
      <Mark />
      <span className="brand-text">
        {withParent && <span className="brand-parent">BRITTO'S AI FORGE</span>}
        <span className="brand-name">BRITTO'S FORGEHSE</span>
      </span>
    </span>
  );
}

export const TAGLINE = 'Engineered for Safety. Powered by Intelligence.';
