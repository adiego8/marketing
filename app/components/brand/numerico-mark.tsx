// The Numerico mark: a 5x5 dot matrix with two solid outer columns, a faint
// field between them, and an accent diagonal cutting through — a number being
// read off a grid.
//
// Authored here rather than copied from numerico-website's public/brand/ so
// this app carries no asset dependency on another project, and so the diagonal
// can take this product's teal instead of the website's amber. Same geometry,
// sibling colour.

const GRID = [12, 22, 32, 42, 52];
const DIAGONAL = [22, 32, 42];

const OUTER = GRID.flatMap((y) => [
  { x: 12, y },
  { x: 52, y },
]);

// Everything in the middle three columns that the diagonal does not claim.
const FIELD = DIAGONAL.flatMap((x) =>
  GRID.filter((y) => y !== x).map((y) => ({ x, y }))
);

export function NumericoMark({
  className = "h-8 w-8",
  reversed = false,
}: {
  className?: string;
  /** For dark surfaces: the ink dots go light. */
  reversed?: boolean;
}) {
  const ink = reversed ? "#F4F6F9" : "#0F172A";

  return (
    <svg
      viewBox="0 0 64 64"
      className={className}
      role="img"
      aria-label="Numerico"
      fill="none"
    >
      {FIELD.map(({ x, y }) => (
        <circle key={`f${x}-${y}`} cx={x} cy={y} r="1.5" fill={ink} opacity="0.16" />
      ))}
      {OUTER.map(({ x, y }) => (
        <circle key={`o${x}-${y}`} cx={x} cy={y} r="3.8" fill={ink} />
      ))}
      {DIAGONAL.map((n) => (
        <circle key={`d${n}`} cx={n} cy={n} r="3.8" fill="#0D9488" />
      ))}
    </svg>
  );
}

/**
 * Mark plus wordmark. The wordmark is live text in Inconsolata, matching the
 * website's hero, which sets "Numerico" in mono at a normal weight.
 */
export function NumericoLockup({
  className = "",
  reversed = false,
  product = "Marketing",
}: {
  className?: string;
  reversed?: boolean;
  /** The product label. Pass null for the bare Numerico lockup. */
  product?: string | null;
}) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <NumericoMark className="h-7 w-7 shrink-0" reversed={reversed} />
      <span
        className={`font-mono text-base leading-none ${
          reversed ? "text-white" : "text-slate-900"
        }`}
      >
        Numerico
      </span>
      {product && (
        <span className="rounded-full bg-teal-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-teal-700">
          {product}
        </span>
      )}
    </span>
  );
}
