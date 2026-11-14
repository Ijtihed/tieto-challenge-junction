// Per architecture/schema-v3.md §3.7 — sampler dispatcher.
// Tries each vendor in samplerPrefs order until one succeeds.

import type { MultiRepoGraph } from "../domain/multi-repo.ts";
import { logger } from "../obs/index.ts";

export interface SamplerRequest {
  readonly task: "plan" | "evaluate-rule";
  readonly systemPrompt: string;
  readonly userPrompt: string;
  readonly graphContext?: MultiRepoGraph;
  readonly apiKeyOverride?: string;
}

export interface SamplerResponse {
  readonly vendor: string;
  readonly text: string;
  readonly model: string;
}

export interface Sampler {
  readonly id: string;
  readonly vendor: string;
  available(): boolean;
  dispatch(request: SamplerRequest): Promise<SamplerResponse>;
}

const samplers = new Map<string, Sampler>();

export function registerSampler(sampler: Sampler): void {
  samplers.set(sampler.id, sampler);
}

export async function dispatchSampler(
  prefs: readonly string[],
  request: SamplerRequest,
): Promise<SamplerResponse | null> {
  for (const pref of prefs) {
    const sampler = [...samplers.values()].find((s) => s.vendor === pref && (s.available() || !!request.apiKeyOverride));
    if (sampler) {
      try {
        return await sampler.dispatch(request);
      } catch (err) {
        logger.warn("samplers", `${sampler.id} failed, trying next`, {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }
  return null;
}

export { samplerMock } from "./sampler-mock.ts";
