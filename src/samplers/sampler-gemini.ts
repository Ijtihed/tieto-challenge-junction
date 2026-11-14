// Per architecture/schema-v3.md §3.7 — Gemini sampler (BYOK).
import type { Sampler, SamplerRequest, SamplerResponse } from "./index.ts";
import { serializeGraphContext } from "./graph-context.ts";

export const samplerGemini: Sampler = {
  id: "sampler-gemini",
  vendor: "gemini",

  available() {
    return !!(process.env["GEMINI_API_KEY"] || process.env["GOOGLE_API_KEY"]);
  },

  async dispatch(request: SamplerRequest): Promise<SamplerResponse> {
    const key = request.apiKeyOverride ?? process.env["GEMINI_API_KEY"] ?? process.env["GOOGLE_API_KEY"];
    if (!key) throw new Error("GEMINI_API_KEY or GOOGLE_API_KEY not set");

    const systemParts = [request.systemPrompt];
    if (request.graphContext) {
      systemParts.push(serializeGraphContext(request.graphContext));
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=${key}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemParts.join("\n\n") }] },
          contents: [{ parts: [{ text: request.userPrompt }] }],
        }),
      },
    );

    if (!response.ok) throw new Error(`Gemini API error ${response.status}`);
    const data = await response.json() as { candidates: { content: { parts: { text: string }[] } }[] };
    return { vendor: "gemini", model: "gemini-2.5-pro", text: data.candidates?.[0]?.content?.parts?.[0]?.text ?? "" };
  },
};
