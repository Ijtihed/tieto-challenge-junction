"use client";

import { useRef, useState, useLayoutEffect } from "react";
import { createPortal } from "react-dom";

/**
 * Detect technology tags embedded in a cluster name (e.g. "PostgREST (Rust)"
 * → ["rust"]). Returns lowercase tech ids in the order they appear.
 */
export function detectTech(label: string): string[] {
  const out: string[] = [];
  const re = /\(([^)]+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(label)) !== null) {
    const tag = m[1].trim().toLowerCase();
    // Split combined tags like "TS, JS"
    for (const part of tag.split(/[,/]+/).map((s) => s.trim())) {
      if (!part) continue;
      out.push(part);
    }
  }
  // Also detect bare keywords in the label (postgres, supabase, etc.)
  const lower = label.toLowerCase();
  const keywords: Record<string, string> = {
    postgres: "postgres",
    postgresql: "postgres",
    sql: "sql",
    redis: "redis",
    docker: "docker",
    k8s: "kubernetes",
    kubernetes: "kubernetes",
    react: "react",
    node: "node",
    python: "python",
    django: "django",
    flask: "flask",
    rails: "rails",
  };
  for (const [k, v] of Object.entries(keywords)) {
    if (lower.includes(k) && !out.includes(v)) out.push(v);
  }
  return out;
}

/** Strip the trailing tech parens from a cluster label so we can render
 *  the clean name alongside the logos. */
export function stripTechSuffix(label: string): string {
  return label.replace(/\s*\(([^)]+)\)\s*$/g, "").trim();
}

interface TechMeta {
  id: string;
  name: string;
  color: string;
  version?: string;
  description: string;
}

const TECH_META: Record<string, TechMeta> = {
  ts: { id: "ts", name: "TypeScript", color: "#3178C6", version: "5.4", description: "Typed superset of JavaScript that compiles to plain JS." },
  typescript: { id: "ts", name: "TypeScript", color: "#3178C6", version: "5.4", description: "Typed superset of JavaScript that compiles to plain JS." },
  js: { id: "js", name: "JavaScript", color: "#F7DF1E", version: "ES2023", description: "Dynamic scripting language for the web." },
  javascript: { id: "js", name: "JavaScript", color: "#F7DF1E", version: "ES2023", description: "Dynamic scripting language for the web." },
  rust: { id: "rust", name: "Rust", color: "#CE412B", version: "1.78", description: "Systems language with memory safety guarantees." },
  go: { id: "go", name: "Go", color: "#00ADD8", version: "1.22", description: "Concurrent language designed at Google." },
  golang: { id: "go", name: "Go", color: "#00ADD8", version: "1.22", description: "Concurrent language designed at Google." },
  python: { id: "python", name: "Python", color: "#3776AB", version: "3.12", description: "High-level dynamic language widely used for data and ML." },
  sql: { id: "sql", name: "SQL", color: "#E48E00", description: "Structured query language for relational databases." },
  postgres: { id: "postgres", name: "PostgreSQL", color: "#336791", version: "16.2", description: "Advanced open-source relational database." },
  redis: { id: "redis", name: "Redis", color: "#DC382D", version: "7.2", description: "In-memory data structure store used as cache and message broker." },
  docker: { id: "docker", name: "Docker", color: "#2496ED", description: "Container platform." },
  kubernetes: { id: "kubernetes", name: "Kubernetes", color: "#326CE5", description: "Container orchestration platform." },
  react: { id: "react", name: "React", color: "#61DAFB", version: "19", description: "Component-based UI library." },
  node: { id: "node", name: "Node.js", color: "#5FA04E", version: "20 LTS", description: "JavaScript runtime built on V8." },
};

interface SVGProps { className?: string; fill?: string; }

const ICONS: Record<string, (p: SVGProps) => React.ReactElement> = {
  ts: ({ className, fill }) => (
    <svg viewBox="0 0 24 24" className={className} fill={fill ?? "currentColor"} aria-hidden>
      <rect x="2" y="2" width="20" height="20" rx="2" />
      <text x="12" y="17" textAnchor="middle" fontSize="11" fontWeight="700" fill="#0b1320" fontFamily="ui-monospace, monospace">TS</text>
    </svg>
  ),
  js: ({ className, fill }) => (
    <svg viewBox="0 0 24 24" className={className} fill={fill ?? "currentColor"} aria-hidden>
      <rect x="2" y="2" width="20" height="20" rx="2" />
      <text x="12" y="17" textAnchor="middle" fontSize="11" fontWeight="700" fill="#0b1320" fontFamily="ui-monospace, monospace">JS</text>
    </svg>
  ),
  rust: ({ className, fill }) => (
    <svg viewBox="-53 -53 106 106" className={className} aria-hidden>
      <defs>
        <mask id="rust-holes">
          <rect x="-60" y="-60" width="120" height="120" fill="white"/>
          <circle cy="-40" r="3" fill="black"/>
          <circle cy="-40" r="3" fill="black" transform="rotate(72)"/>
          <circle cy="-40" r="3" fill="black" transform="rotate(144)"/>
          <circle cy="-40" r="3" fill="black" transform="rotate(216)"/>
          <circle cy="-40" r="3" fill="black" transform="rotate(288)"/>
        </mask>
      </defs>
      <g fill={fill ?? "currentColor"} stroke={fill ?? "currentColor"}>
        <path strokeWidth="1" strokeLinejoin="round" d="M -9,-15 H 4 C 12,-15 12,-7 4,-7 H -9 Z M -40,22 H 0 V 11 H -9 V 3 H 1 C 12,3 6,22 15,22 H 40 V 3 H 34 V 5 C 34,13 25,12 24,7 C 23,2 19,-2 18,-2 C 33,-10 24,-26 12,-26 H -35 V -15 H -25 V 11 H -40 Z" transform="translate(0.5, 0.5)"/>
        <g mask="url(#rust-holes)">
          <circle r="43" fill="none" strokeWidth="9"/>
          <polygon strokeWidth="3" strokeLinejoin="round" points="46,3 51,0 46,-3"/>
          <polygon strokeWidth="3" strokeLinejoin="round" points="46,3 51,0 46,-3" transform="rotate(45)"/>
          <polygon strokeWidth="3" strokeLinejoin="round" points="46,3 51,0 46,-3" transform="rotate(90)"/>
          <polygon strokeWidth="3" strokeLinejoin="round" points="46,3 51,0 46,-3" transform="rotate(135)"/>
          <polygon strokeWidth="3" strokeLinejoin="round" points="46,3 51,0 46,-3" transform="rotate(180)"/>
          <polygon strokeWidth="3" strokeLinejoin="round" points="46,3 51,0 46,-3" transform="rotate(225)"/>
          <polygon strokeWidth="3" strokeLinejoin="round" points="46,3 51,0 46,-3" transform="rotate(270)"/>
          <polygon strokeWidth="3" strokeLinejoin="round" points="46,3 51,0 46,-3" transform="rotate(315)"/>
          <polygon strokeWidth="6" strokeLinejoin="round" points="-7,-42 0,-35 7,-42"/>
          <polygon strokeWidth="6" strokeLinejoin="round" points="-7,-42 0,-35 7,-42" transform="rotate(72)"/>
          <polygon strokeWidth="6" strokeLinejoin="round" points="-7,-42 0,-35 7,-42" transform="rotate(144)"/>
          <polygon strokeWidth="6" strokeLinejoin="round" points="-7,-42 0,-35 7,-42" transform="rotate(216)"/>
          <polygon strokeWidth="6" strokeLinejoin="round" points="-7,-42 0,-35 7,-42" transform="rotate(288)"/>
        </g>
      </g>
    </svg>
  ),
  go: ({ className, fill }) => (
    <svg viewBox="0 0 205.4 76.7" className={className} aria-hidden preserveAspectRatio="xMidYMid meet">
      <g fill={fill ?? "currentColor"}>
        <path d="M15.5,23.2c-0.4,0-0.5-0.2-0.3-0.5l2.1-2.7c0.2-0.3,0.7-0.5,1.1-0.5h35.7c0.4,0,0.5,0.3,0.3,0.6l-1.7,2.6 c-0.2,0.3-0.7,0.6-1,0.6L15.5,23.2z"/>
        <path d="M0.4,32.4c-0.4,0-0.5-0.2-0.3-0.5l2.1-2.7c0.2-0.3,0.7-0.5,1.1-0.5h45.6c0.4,0,0.6,0.3,0.5,0.6l-0.8,2.4 c-0.1,0.4-0.5,0.6-0.9,0.6L0.4,32.4z"/>
        <path d="M24.6,41.6c-0.4,0-0.5-0.3-0.3-0.6l1.4-2.5c0.2-0.3,0.6-0.6,1-0.6h20c0.4,0,0.6,0.3,0.6,0.7L47.1,41 c0,0.4-0.4,0.7-0.7,0.7L24.6,41.6z"/>
        <path d="M128.4,21.4c-6.3,1.6-10.6,2.8-16.8,4.4c-1.5,0.4-1.6,0.5-2.9-1c-1.5-1.7-2.6-2.8-4.7-3.8 c-6.3-3.1-12.4-2.2-18.1,1.5c-6.8,4.4-10.3,10.9-10.2,19c0.1,8,5.6,14.6,13.5,15.7c6.8,0.9,12.5-1.5,17-6.6 c0.9-1.1,1.7-2.3,2.7-3.7c-3.6,0-8.1,0-19.3,0c-2.1,0-2.6-1.3-1.9-3c1.3-3.1,3.7-8.3,5.1-10.9c0.3-0.6,1-1.6,2.5-1.6 c5.1,0,23.9,0,36.4,0c-0.2,2.7-0.2,5.4-0.6,8.1c-1.1,7.2-3.8,13.8-8.2,19.6c-7.2,9.5-16.6,15.4-28.5,17 c-9.8,1.3-18.9-0.6-26.9-6.6c-7.4-5.6-11.6-13-12.7-22.2c-1.3-10.9,1.9-20.7,8.5-29.3c7.1-9.3,16.5-15.2,28-17.3 c9.4-1.7,18.4-0.6,26.5,4.9c5.3,3.5,9.1,8.3,11.6,14.1C130,20.6,129.6,21.1,128.4,21.4z"/>
        <path d="M161.5,76.7c-9.1-0.2-17.4-2.8-24.4-8.8c-5.9-5.1-9.6-11.6-10.8-19.3c-1.8-11.3,1.3-21.3,8.1-30.2 c7.3-9.6,16.1-14.6,28-16.7c10.2-1.8,19.8-0.8,28.5,5.1c7.9,5.4,12.8,12.7,14.1,22.3c1.7,13.5-2.2,24.5-11.5,33.9 c-6.6,6.7-14.7,10.9-24,12.8C166.8,76.3,164.1,76.4,161.5,76.7z M185.3,36.3c-0.1-1.3-0.1-2.3-0.3-3.3 c-1.8-9.9-10.9-15.5-20.4-13.3c-9.3,2.1-15.3,8-17.5,17.4c-1.8,7.8,2,15.7,9.2,18.9c5.5,2.4,11,2.1,16.3-0.6 C180.5,51.3,184.8,44.9,185.3,36.3z"/>
      </g>
    </svg>
  ),
  python: ({ className, fill }) => (
    <svg viewBox="0 0 24 24" className={className} fill={fill ?? "currentColor"} aria-hidden>
      <path d="M12 2c-3 0-5 1-5 3v3h5v1H5c-2 0-3 1-3 4s1 4 3 4h2v-3c0-2 2-3 4-3h5c2 0 3-1 3-3V5c0-2-2-3-5-3zm-2 2a1 1 0 110 2 1 1 0 010-2zm5 5v3c0 2-2 3-4 3H6c-2 0-3 1-3 3s1 4 3 4h6c3 0 5-1 5-3v-3h-5v-1h7c2 0 3-1 3-4s-1-4-3-4h-4zm-1 12a1 1 0 110 2 1 1 0 010-2z"/>
    </svg>
  ),
  sql: ({ className, fill }) => (
    <svg viewBox="0 0 24 24" className={className} fill={fill ?? "currentColor"} aria-hidden>
      <ellipse cx="12" cy="5" rx="8" ry="2.5"/>
      <path d="M4 8c0 1.4 3.6 2.5 8 2.5S20 9.4 20 8v3c0 1.4-3.6 2.5-8 2.5S4 12.4 4 11V8z"/>
      <path d="M4 14c0 1.4 3.6 2.5 8 2.5s8-1.1 8-2.5v3c0 1.4-3.6 2.5-8 2.5s-8-1.1-8-2.5v-3z"/>
    </svg>
  ),
  postgres: ({ className, fill }) => (
    <svg viewBox="0 0 24 24" className={className} fill={fill ?? "currentColor"} aria-hidden>
      <path d="M12 2C7.6 2 4 4.4 4 7.5v9c0 3 3.6 5.5 8 5.5s8-2.5 8-5.5v-9C20 4.4 16.4 2 12 2zm0 2c3.3 0 6 1.6 6 3.5S15.3 11 12 11 6 9.4 6 7.5 8.7 4 12 4zm-6 6.5c1.3 1 3.5 1.5 6 1.5s4.7-.5 6-1.5v3c0 1.9-2.7 3.5-6 3.5s-6-1.6-6-3.5v-3z"/>
    </svg>
  ),
  redis: ({ className, fill }) => (
    <svg viewBox="0 0 24 24" className={className} fill={fill ?? "currentColor"} aria-hidden>
      <path d="M2 7l10-4 10 4-10 4L2 7zm0 5l10-4 10 4-10 4L2 12zm0 5l10-4 10 4-10 4L2 17z"/>
    </svg>
  ),
  docker: ({ className, fill }) => (
    <svg viewBox="0 0 24 24" className={className} fill={fill ?? "currentColor"} aria-hidden>
      <path d="M2 12h3v2H2v-2zm4 0h3v2H6v-2zm4 0h3v2h-3v-2zm4 0h3v2h-3v-2zm-8-4h3v2H6V8zm4 0h3v2h-3V8zm4 0h3v2h-3V8zm-4-4h3v2h-3V4zM2 16c0 2 2 4 6 4 5 0 9-2 12-7-1 .5-3 .5-4 0-1 1.5-3 2-5 2H2v1z"/>
    </svg>
  ),
  kubernetes: ({ className, fill }) => (
    <svg viewBox="0 0 24 24" className={className} fill={fill ?? "currentColor"} aria-hidden>
      <path d="M12 2L2 7v10l10 5 10-5V7L12 2zm0 3.5l6 3v7l-6 3-6-3v-7l6-3zm0 3l-3 1.5 3 4.5 3-4.5L12 8.5z"/>
    </svg>
  ),
  react: ({ className, fill }) => (
    <svg viewBox="0 0 24 24" className={className} fill={fill ?? "currentColor"} aria-hidden>
      <circle cx="12" cy="12" r="2"/>
      <ellipse cx="12" cy="12" rx="10" ry="4"/>
      <ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(60 12 12)"/>
      <ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(120 12 12)"/>
    </svg>
  ),
  node: ({ className, fill }) => (
    <svg viewBox="0 0 24 24" className={className} fill={fill ?? "currentColor"} aria-hidden>
      <path d="M12 2L3 7v10l9 5 9-5V7L12 2zm0 2.5l6.5 3.5v8L12 19.5 5.5 16V8L12 4.5z"/>
    </svg>
  ),
};

export function TechLogo({ tech, size = 14 }: { tech: string; size?: number }) {
  const meta = TECH_META[tech.toLowerCase()];
  const [hover, setHover] = useState(false);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    if (!hover) { setPos(null); return; }
    const el = anchorRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ left: r.left + r.width / 2, top: r.bottom + 6 });
  }, [hover]);

  if (!meta) return null;
  const Icon = ICONS[meta.id];
  if (!Icon) return null;

  return (
    <span
      ref={anchorRef}
      className="inline-flex items-center"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{ width: size, height: size }}
    >
      <span style={{ width: size, height: size, display: "inline-flex" }}>
        <Icon className="w-full h-full" fill={meta.color} />
      </span>
      {hover && pos && typeof document !== "undefined" && createPortal(
        <div
          className="fixed z-[10000] w-56 -translate-x-1/2 rounded-lg border border-outline-variant bg-surface-dim/95 backdrop-blur shadow-2xl px-3 py-2 pointer-events-none"
          style={{ left: pos.left, top: pos.top }}
        >
          <div className="flex items-baseline justify-between gap-2 mb-1">
            <span className="text-xs font-medium text-white">{meta.name}</span>
            {meta.version && (
              <span className="font-[JetBrains_Mono] text-[10px] text-on-surface-faint">v{meta.version}</span>
            )}
          </div>
          <p className="text-[11px] text-on-surface-faint leading-relaxed">{meta.description}</p>
        </div>,
        document.body,
      )}
    </span>
  );
}

export function TechLogoRow({ techs, size = 14 }: { techs: string[]; size?: number }) {
  const unique = Array.from(new Set(techs.map((t) => t.toLowerCase()))).filter((t) => TECH_META[t]);
  if (unique.length === 0) return null;
  return (
    <span className="inline-flex items-center gap-1.5">
      {unique.map((t) => <TechLogo key={t} tech={t} size={size} />)}
    </span>
  );
}
