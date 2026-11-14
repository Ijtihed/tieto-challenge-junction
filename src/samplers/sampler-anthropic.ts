// Per architecture/schema-v3.md §3.7 — Anthropic sampler (BYOK).
// Uses ANTHROPIC_API_KEY env var. Real API call to Claude.
import type { Sampler, SamplerRequest, SamplerResponse } from "./index.ts";

import { serializeGraphContext } from "./graph-context.ts";

export const samplerAnthropic: Sampler = {
  id: "sampler-anthropic",
  vendor: "anthropic",

  available() {
    return !!process.env["ANTHROPIC_API_KEY"];
  },

  async dispatch(request: SamplerRequest): Promise<SamplerResponse> {
    const key = request.apiKeyOverride ?? process.env["ANTHROPIC_API_KEY"];
    if (!key) throw new Error("ANTHROPIC_API_KEY not set");

    const systemParts = [request.systemPrompt];
    if (request.graphContext) {
      systemParts.push(serializeGraphContext(request.graphContext));
    }

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4096,
        system: systemParts.join("\n\n"),
        messages: [{ role: "user", content: request.userPrompt }],
      }),
    });

    if (!response.ok) {
      throw new Error(`Anthropic API error ${response.status}: ${await response.text()}`);
    }

    const data = await response.json() as { content: { text: string }[] };
    return { vendor: "anthropic", model: "claude-sonnet-4-20250514", text: data.content[0]?.text ?? "" };
  },
};
