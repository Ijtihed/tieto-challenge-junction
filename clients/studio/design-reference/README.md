# Stitch Design Reference

Three HTML mockups from Stitch defining the visual target for Schema Studio.

- `graph-canvas.html` — Main view with workspace open, graph rendered, node inspector
- `diff-visualizer.html` — Diff view with violation banner, floating status pills, changes panel
- `first-launch.html` — Empty state with SVG illustration, open workspace CTA, recent list

These are the pixel-perfect targets. Every Studio component should match these designs.

## Key design tokens (from Stitch Tailwind config)

| Token | Value |
|---|---|
| background | #131313 |
| surface | #131313 |
| surface-container | #201f1f |
| surface-container-low | #1c1b1b |
| surface-container-high | #2a2a2a |
| surface-container-highest | #353534 |
| surface-container-lowest | #0e0e0e |
| surface-variant | #353534 |
| on-surface | #e5e2e1 |
| on-surface-variant | #c4c7c8 |
| primary | #ffffff |
| secondary | #a4c9ff |
| error | #ffb4ab |
| error-container | #93000a |
| outline | #8e9192 |
| outline-variant | #444748 |

## Typography scale

| Name | Size | Line height | Weight | Tracking | Font |
|---|---|---|---|---|---|
| body-sm | 12px | 16px | 400 | — | Inter |
| body-md | 14px | 20px | 400 | — | Inter |
| body-lg | 16px | 24px | 400 | — | Inter |
| code-sm | 11px | 14px | 400 | — | JetBrains Mono |
| code-md | 13px | 18px | 400 | — | JetBrains Mono |
| label-caps | 11px | 16px | 600 | 0.05em | Inter |
| headline-md | 18px | 24px | 600 | -0.02em | Manrope |
| headline-lg | 24px | 32px | 600 | -0.02em | Manrope |
