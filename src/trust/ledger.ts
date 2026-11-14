// Append-only decision log, sign-offs, and per-area track record.
// Everything is plain JSON under junction/ledger so a judge can read it in git.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const JUNCTION_DIR = process.env.SCHEMA_JUNCTION_DIR
  ?? resolve(dirname(fileURLToPath(import.meta.url)), "../../junction");

const LEDGER = join(JUNCTION_DIR, "ledger");

function ensure(path: string): string {
  mkdirSync(dirname(path), { recursive: true });
  return path;
}

export interface DecisionEntry {
  at: string;
  actor: string;
  action: string;
  receiptId?: string;
  detail: string;
}

export function logDecision(entry: Omit<DecisionEntry, "at">): DecisionEntry {
  const full = { at: new Date().toISOString(), ...entry };
  appendFileSync(ensure(join(LEDGER, "decisions.jsonl")), JSON.stringify(full) + "\n");
  return full;
}

export function readDecisions(receiptId?: string): DecisionEntry[] {
  const p = join(LEDGER, "decisions.jsonl");
  if (!existsSync(p)) return [];
  return readFileSync(p, "utf8").split("\n").filter(Boolean)
    .map((l) => JSON.parse(l) as DecisionEntry)
    .filter((e) => !receiptId || e.receiptId === receiptId);
}

export interface AreaRecord {
  area: string;
  accepted: number;
  rejected: number;
  escapes: { at: string; receiptId: string; note: string }[];
  /** Consecutive accepted sign-offs since the last escape. */
  cleanStreak: number;
}

export type AreaBook = Record<string, AreaRecord>;

export function readAreas(): AreaBook {
  const p = join(LEDGER, "areas.json");
  return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as AreaBook) : {};
}

function writeAreas(book: AreaBook): void {
  writeFileSync(ensure(join(LEDGER, "areas.json")), JSON.stringify(book, null, 2) + "\n");
}

function area(book: AreaBook, id: string): AreaRecord {
  return (book[id] ??= { area: id, accepted: 0, rejected: 0, escapes: [], cleanStreak: 0 });
}

export function recordSignoffOutcome(areas: string[], decision: string): void {
  const book = readAreas();
  for (const id of areas) {
    const a = area(book, id);
    if (decision === "accept") { a.accepted++; a.cleanStreak++; } else { a.rejected++; }
  }
  writeAreas(book);
}

export function recordEscape(areaId: string, receiptId: string, note: string): AreaRecord {
  const book = readAreas();
  const a = area(book, areaId);
  a.escapes.push({ at: new Date().toISOString(), receiptId, note });
  a.cleanStreak = 0;
  writeAreas(book);
  return a;
}

export function saveJson(rel: string, value: unknown): string {
  const p = ensure(join(JUNCTION_DIR, rel));
  writeFileSync(p, JSON.stringify(value, null, 2) + "\n");
  return p;
}

export function saveText(rel: string, text: string): string {
  const p = ensure(join(JUNCTION_DIR, rel));
  writeFileSync(p, text);
  return p;
}

export function loadJson<T>(rel: string): T | null {
  const p = join(JUNCTION_DIR, rel);
  return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as T) : null;
}
