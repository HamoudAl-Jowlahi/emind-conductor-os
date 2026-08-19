/**
 * The eMind mark — the "em" monogram, recreated as a single-stroke inline
 * vector so it scales and themes with the rest of the chrome.
 *
 * Geometry: an open lowercase `e` (crossbar + bowl with the mouth at lower
 * right) whose stroke leaves the bowl tangentially at the top and runs on as
 * the `m` — long fall to the valley, steep rise to the apex, then straight
 * down the stem. Uniform stroke, round caps/joins, exactly like the source.
 *
 * `currentColor` by default so it inherits the theme accent; pass `color` to
 * re-ink it. No wordmark inside the mark — the lockup text lives beside it.
 */
export function EmindMark({
  size = 34,
  color = 'currentColor',
  className,
}: {
  size?: number;
  color?: string;
  className?: string;
}) {
  return (
    <svg
      viewBox="10 16 180 112"
      width={size}
      height={(size * 112) / 180}
      className={className}
      role="img"
      aria-label="eMind"
    >
      <g fill="none" stroke={color} strokeWidth={12} strokeLinecap="round" strokeLinejoin="round">
        {/* crossbar of the e */}
        <path d="M20 68 H84" />
        {/* bowl, open at the lower right, running on into the m */}
        <path d="M76 91 A32 32 0 1 1 68 40 L128 88 L178 27 L178 115" />
      </g>
    </svg>
  );
}
