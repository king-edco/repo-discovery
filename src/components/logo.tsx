// Foundry logo: a bold "F" monogram in a rounded square. Inline SVG so it
// works in server components, matches the current theme via currentColor
// for the letter, and needs no asset request.

export function Logo({ className = "size-6" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 512 512"
      className={className}
      role="img"
      aria-label="Foundry logo"
    >
      <rect width="512" height="512" rx="96" className="fill-foreground" />
      <text
        x="50%"
        y="50%"
        dy=".35em"
        textAnchor="middle"
        fontFamily="Arial, Helvetica, sans-serif"
        fontSize="300"
        fontWeight="700"
        className="fill-background"
      >
        F
      </text>
    </svg>
  );
}
