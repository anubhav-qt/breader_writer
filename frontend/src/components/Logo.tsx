/** Doto's lowercase b: sixteen dots on a 5 × 7 grid, the same mark as the favicon. */
const DOTS: Array<[col: number, row: number]> = [
  [0, 0], [0, 1], [0, 2], [2, 2], [3, 2], [0, 3], [1, 3], [4, 3],
  [0, 4], [4, 4], [0, 5], [1, 5], [4, 5], [0, 6], [2, 6], [3, 6],
];
const PITCH = 3.5;
const DOT = 3;

/** Ink on the page, with no box around it, so it inverts with the theme. */
export function Logo() {
  return (
    <svg className="logo" viewBox="0 0 32 32" role="img" aria-label="Breader">
      <g className="logo-b">
        {DOTS.map(([c, r]) => (
          <rect key={`${c}-${r}`} x={7.5 + c * PITCH} y={4 + r * PITCH} width={DOT} height={DOT} />
        ))}
      </g>
    </svg>
  );
}
