// Per architecture/schema-v3.md §3.7 — OpenAI sampler (BYOK).
import type { Sampler, SamplerRequest, SamplerResponse } from "./index.ts";
import { serializeGraphContext } from "./graph-context.ts";

export const samplerOpenai: Sampler = {
  id: "sampler-openai",
  vendor: "openai",

  available() {
    return !!process.env["OPENAI_API_KEY"];
  },

  async dispatch(request: SamplerRequest): Promise<SamplerResponse> {
    const key = request.apiKeyOverride ?? process.env["OPENAI_API_KEY"];
    if (!key) throw new Error("OPENAI_API_KEY not set");

    const systemParts = [request.systemPrompt];
    if (request.graphContext) {
      systemParts.push(serializeGraphContext(request.graphContext));
    }

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [
          { role: "system", content: systemParts.join("\n\n") },
          { role: "user", content: request.userPrompt },
        ],
        max_tokens: 4096,
      }),
    });

    if (!response.ok) throw new Error(`OpenAI API error ${response.status}`);
    const data = await response.json() as { choices: { message: { content: string } }[] };
    return { vendor: "openai", model: "gpt-4o", text: data.choices[0]?.message?.content ?? "" };
  },
};
