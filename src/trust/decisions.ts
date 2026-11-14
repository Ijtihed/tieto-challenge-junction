// Gemini Decisions API (gemini-decision-1): scores closed-set questions with calibrated
// probabilities instead of generating text. One request can carry up to 1,000 questions.
// Docs: https://aistudio.google.com/docs/decisions-api

export type DecisionQuestion =
  | { type: "noul"; instructions: string; criteria?: { true_description: string; false_description: string } }
  | { type: "choice"; instructions: string; criteria: Record<string, string> }
  | { type: "score"; instructions: string; criteria: string[] };

export type DecisionAnswer =
  | { type: "noul"; noul: number; confidence: number }
  | { type: "choice"; choice: string; probabilities: Record<string, number>; confidence: number }
  | { type: "score"; score: number; probabilities: Record<string, number>; legend: Record<string, string>; confidence: number };

export interface DecisionsResult { answers: Record<string, DecisionAnswer>; usage?: { total_input_tokens?: number }; ms: number; model: string }

export const DECISION_MODEL = process.env.SCHEMA_DECISION_MODEL ?? "gemini-decision-1";

export function decisionsKey(): string | undefined {
  return process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
}

export async function decide(input: string, questions: Record<string, DecisionQuestion>): Promise<DecisionsResult> {
  const key = decisionsKey();
  if (!key) throw new Error("GEMINI_API_KEY not set");
  const entries = Object.entries(questions);
  if (!entries.length) return { answers: {}, ms: 0, model: DECISION_MODEL };
  const t0 = Date.now();
  const answers: Record<string, DecisionAnswer> = {};
  let tokens = 0;
  // The API takes at most 1,000 questions per request.
  for (let i = 0; i < entries.length; i += 1000) {
    const res = await fetch("https://generativelanguage.googleapis.com/v1beta/decisions", {
      method: "POST",
      headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify({ model: DECISION_MODEL, input, questions: Object.fromEntries(entries.slice(i, i + 1000)) }),
    });
    const json = (await res.json()) as { answers?: Record<string, DecisionAnswer>; usage?: { total_input_tokens?: number }; error?: { code: number; message: string } };
    if (!res.ok || json.error) throw new Error(`Decisions API ${res.status}: ${json.error?.message ?? "request failed"}`);
    Object.assign(answers, json.answers ?? {});
    tokens += json.usage?.total_input_tokens ?? 0;
  }
  return { answers, usage: { total_input_tokens: tokens }, ms: Date.now() - t0, model: DECISION_MODEL };
}

/** Question keys must match [A-Za-z0-9_-]{1,64}. */
export function questionKey(i: number, label: string): string {
  return `q${i}_${label.replace(/[^A-Za-z0-9_-]/g, "_")}`.slice(0, 64);
}
