/**
 * Tiny fuzzy matcher: subsequence match with bonus for consecutive characters
 * and prefix matches. Returns null if no match, else a positive score
 * (higher = better).
 */
export function fuzzyScore(query: string, text: string): number | null {
  if (!query) return 0;
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  let score = 0;
  let qi = 0;
  let prevMatchedAt = -2;
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] === q[qi]) {
      score += 1;
      if (i === prevMatchedAt + 1) score += 2; // consecutive
      if (i === 0) score += 3; // prefix
      // word-start bonus
      if (i > 0 && /[\s/.\-_:]/.test(t[i - 1])) score += 2;
      prevMatchedAt = i;
      qi++;
    }
  }
  if (qi < q.length) return null;
  // Penalize length
  return score - Math.floor(t.length / 40);
}

export interface ScoredItem<T> {
  item: T;
  score: number;
  matchedHaystack: string;
}

export function fuzzyRank<T>(
  query: string,
  items: T[],
  haystacks: (item: T) => string[],
): ScoredItem<T>[] {
  if (!query.trim()) {
    return items.slice(0, 50).map((item) => ({
      item,
      score: 0,
      matchedHaystack: haystacks(item)[0] ?? "",
    }));
  }
  const out: ScoredItem<T>[] = [];
  for (const item of items) {
    let best: { score: number; haystack: string } | null = null;
    for (const h of haystacks(item)) {
      const s = fuzzyScore(query, h);
      if (s === null) continue;
      if (!best || s > best.score) best = { score: s, haystack: h };
    }
    if (best) out.push({ item, score: best.score, matchedHaystack: best.haystack });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, 50);
}
