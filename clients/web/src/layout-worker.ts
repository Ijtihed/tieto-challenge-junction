interface LayoutNode {
  id: string;
  x: number;
  y: number;
}

interface LayoutMessage {
  nodes: { id: string }[];
  edges: { source: string; target: string }[];
  width: number;
  height: number;
}

self.onmessage = (e: MessageEvent<LayoutMessage>) => {
  const { nodes, edges, width, height } = e.data;
  const positions = computeLayout(nodes, edges, width, height);
  self.postMessage(positions);
};

// ── Barnes-Hut quadtree for O(n log n) repulsion ──────────────

class QuadTree {
  cx = 0;
  cy = 0;
  mass = 0;
  body: LayoutNode | null = null;
  nw: QuadTree | null = null;
  ne: QuadTree | null = null;
  sw: QuadTree | null = null;
  se: QuadTree | null = null;

  constructor(
    public x1: number,
    public y1: number,
    public x2: number,
    public y2: number,
  ) {}

  insert(p: LayoutNode): void {
    if (this.x2 - this.x1 < 0.01) return;
    if (this.mass === 0) {
      this.body = p;
      this.cx = p.x;
      this.cy = p.y;
      this.mass = 1;
      return;
    }
    if (this.body) {
      const old = this.body;
      this.body = null;
      this.addToChild(old);
    }
    this.cx = (this.cx * this.mass + p.x) / (this.mass + 1);
    this.cy = (this.cy * this.mass + p.y) / (this.mass + 1);
    this.mass += 1;
    this.addToChild(p);
  }

  private addToChild(p: LayoutNode): void {
    const mx = (this.x1 + this.x2) / 2;
    const my = (this.y1 + this.y2) / 2;
    if (p.x < mx) {
      if (p.y < my) {
        this.nw ??= new QuadTree(this.x1, this.y1, mx, my);
        this.nw.insert(p);
      } else {
        this.sw ??= new QuadTree(this.x1, my, mx, this.y2);
        this.sw.insert(p);
      }
    } else {
      if (p.y < my) {
        this.ne ??= new QuadTree(mx, this.y1, this.x2, my);
        this.ne.insert(p);
      } else {
        this.se ??= new QuadTree(mx, my, this.x2, this.y2);
        this.se.insert(p);
      }
    }
  }

  repulse(
    p: LayoutNode,
    k: number,
    theta: number,
  ): { fx: number; fy: number } {
    if (this.mass === 0 || (this.mass === 1 && this.body === p)) {
      return { fx: 0, fy: 0 };
    }
    const dx = p.x - this.cx;
    const dy = p.y - this.cy;
    const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 0.01);
    const size = this.x2 - this.x1;

    if (size / dist < theta || this.body !== null) {
      const force = (k * k * this.mass) / dist;
      return { fx: (dx / dist) * force, fy: (dy / dist) * force };
    }
    let fx = 0,
      fy = 0;
    for (const child of [this.nw, this.ne, this.sw, this.se]) {
      if (child) {
        const f = child.repulse(p, k, theta);
        fx += f.fx;
        fy += f.fy;
      }
    }
    return { fx, fy };
  }
}

function computeLayout(
  nodes: { id: string }[],
  edges: { source: string; target: string }[],
  W: number,
  H: number,
): LayoutNode[] {
  if (nodes.length === 0) return [];

  const area = W * H;
  const k = Math.sqrt(area / nodes.length);
  const positions: LayoutNode[] = nodes.map((n) => ({
    id: n.id,
    x: W / 2 + (Math.random() - 0.5) * W * 0.8,
    y: H / 2 + (Math.random() - 0.5) * H * 0.8,
  }));

  const posMap = new Map(positions.map((p) => [p.id, p]));
  const iterations = 200;
  const tempStart = W / 10;
  const theta = 0.8;

  for (let iter = 0; iter < iterations; iter++) {
    const temp = tempStart * (1 - iter / iterations);

    // Barnes-Hut repulsion via quadtree — O(n log n) per iteration
    const qt = new QuadTree(0, 0, W, H);
    for (const p of positions) qt.insert(p);

    for (const p of positions) {
      const f = qt.repulse(p, k, theta);
      p.x += Math.max(-temp, Math.min(f.fx, temp));
      p.y += Math.max(-temp, Math.min(f.fy, temp));
    }

    // Attraction along edges
    for (const edge of edges) {
      const p1 = posMap.get(edge.source);
      const p2 = posMap.get(edge.target);
      if (!p1 || !p2) continue;
      const dx = p1.x - p2.x;
      const dy = p1.y - p2.y;
      const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 0.01);
      const force = (dist * dist) / k;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      p1.x -= Math.max(-temp, Math.min(fx, temp));
      p1.y -= Math.max(-temp, Math.min(fy, temp));
      p2.x += Math.max(-temp, Math.min(fx, temp));
      p2.y += Math.max(-temp, Math.min(fy, temp));
    }

    for (const p of positions) {
      p.x = Math.max(50, Math.min(W - 50, p.x));
      p.y = Math.max(50, Math.min(H - 50, p.y));
    }
  }

  return positions;
}
