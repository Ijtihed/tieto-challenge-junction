// The Claude Code crab, drawn as pixels after the mascot Claude Code prints in the terminal.
// It marks every action that hands work to Claude Code. Motion lives in style.css (.crab):
// a hop when its row is hovered, a two-frame walk while the agent is working.

/** Pixel runs per row: [x, width]. Rows are 2 units tall on an 18 x 10 grid. */
const BODY: [number, number][][] = [
  [[3, 12]],
  [[3, 2], [6, 6], [13, 2]], // the two gaps are the eyes
  [[1, 16]], // arms
  [[3, 12]],
];
const LEGS_A = [4, 6, 11, 13];
const LEGS_B = [5, 7, 10, 12];

export default function ClaudeCrab({ size = 18, walking = false, className = "" }: { size?: number; walking?: boolean; className?: string }) {
  return (
    <svg
      className={`crab ${walking ? "crab-walk" : ""} ${className}`}
      width={size}
      height={(size * 10) / 18}
      viewBox="0 0 18 10"
      fill="currentColor"
      shapeRendering="crispEdges"
      aria-hidden="true"
      focusable="false"
    >
      {BODY.flatMap((row, y) => row.map(([x, w]) => <rect key={`${x}-${y}`} x={x} y={y * 2} width={w} height={2} />))}
      <g className="crab-legs-a">{LEGS_A.map((x) => <rect key={x} x={x} y={8} width={1} height={2} />)}</g>
      <g className="crab-legs-b">{LEGS_B.map((x) => <rect key={x} x={x} y={8} width={1} height={2} />)}</g>
    </svg>
  );
}
