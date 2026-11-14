/**
 * Web Worker that runs ELK layout off the main thread.
 *
 * Used for graphs with 50+ nodes to prevent UI jank. The main thread
 * converts React Flow nodes/edges into an ELK JSON graph, posts it
 * here, and we return the laid-out graph with positions + edge routes.
 */

import ELK from "elkjs/lib/elk.bundled.js";

const elk = new ELK();

self.onmessage = async (e: MessageEvent<{ id: number; elkGraph: unknown }>) => {
  const { id, elkGraph } = e.data;
  try {
    const result = await elk.layout(elkGraph as never);
    self.postMessage({ id, result });
  } catch (err: unknown) {
    self.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
