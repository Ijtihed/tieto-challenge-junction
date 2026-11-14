// Phase 7 — REST/OpenAPI cross-language bridge.
// Matches URL paths between HTTP clients (fetch calls) and
// server-side route handlers across languages.
// Emits implements_contract + consumes_contract edges.

import { readFileSync } from "node:fs";
import type { GraphNode, GraphEdge, RepoSubgraph } from "./multi-repo.ts";
import { EDGE_RELATIONS, NODE_KINDS } from "./vocabulary.ts";
import { idFromLocator } from "./locator.ts";
import { createHash } from "node:crypto";

export interface RouteInfo {
  readonly method: string;
  readonly path: string;
  readonly nodeId: string;
  readonly repoUri: string;
}

export interface FetchCallInfo {
  readonly url: string;
  readonly method: string;
  readonly nodeId: string;
  readonly repoUri: string;
}

function edgeId(source: string, target: string, relation: string): string {
  return "e_" + createHash("sha256").update(`${source}\0${target}\0${relation}`).digest("hex").slice(0, 12);
}

function contractNodeId(method: string, path: string): string {
  const loc = { scheme: "rest", raw: `rest://${method}${path}` };
  return idFromLocator(loc);
}

function normalisePath(path: string): string {
  return path
    .replace(/\/+$/, "")
    .toLowerCase()
    .replace(/\/:\w+/g, "/:param")
    .replace(/\/\{[^}]+\}/g, "/:param");
}

function extractUrlPath(raw: string): string | null {
  let url = raw.replace(/^https?:\/\/[^/]+/, "");
  url = url.replace(/\$\{[^}]*\}/g, "");
  url = url.replace(/^\/\/[^/]*/, "");
  if (!url.startsWith("/")) return null;
  return url;
}

function extractFetchCalls(content: string, filePath: string, fileNodeId: string, repoUri: string): FetchCallInfo[] {
  const calls: FetchCallInfo[] = [];
  const fetchRe = /fetch\s*\(\s*[`"']([^`"']*?)[`"']/g;
  for (const match of content.matchAll(fetchRe)) {
    const urlPath = extractUrlPath(match[1]!);
    if (!urlPath) continue;
    calls.push({ url: urlPath, method: "GET", nodeId: fileNodeId, repoUri });
  }

  const postRe = /fetch\s*\(\s*[`"']([^`"']*?)[`"']\s*,\s*\{[^}]*method\s*:\s*["'](\w+)["']/g;
  for (const match of content.matchAll(postRe)) {
    const urlPath = extractUrlPath(match[1]!);
    if (!urlPath) continue;
    const method = match[2]!.toUpperCase();
    const existing = calls.find((c) => c.url === urlPath);
    if (existing) {
      calls[calls.indexOf(existing)] = { ...existing, method };
    } else {
      calls.push({ url: urlPath, method, nodeId: fileNodeId, repoUri });
    }
  }

  return calls;
}

export function detectFetchCalls(repos: readonly RepoSubgraph[]): FetchCallInfo[] {
  const calls: FetchCallInfo[] = [];
  for (const repo of repos) {
    for (const node of repo.nodes) {
      const tsExts = [".ts", ".tsx", ".js", ".jsx", ".mts", ".cts", ".mjs", ".cjs"];
      if (node.filePath && tsExts.some((ext) => node.filePath!.endsWith(ext))) {
        if (!node.locator.includes("#")) {
          try {
            const content = readFileSync(node.filePath, "utf-8");
            calls.push(...extractFetchCalls(content, node.filePath, node.id, repo.uri));
          } catch { /* file not readable */ }
        }
      }
    }
  }
  return calls;
}

export function buildRestBridgeEdges(
  routes: RouteInfo[],
  fetchCalls: FetchCallInfo[],
): { contractNodes: GraphNode[]; bridgeEdges: GraphEdge[] } {
  const contractNodes: GraphNode[] = [];
  const bridgeEdges: GraphEdge[] = [];
  const seenContracts = new Set<string>();

  for (const route of routes) {
    const normPath = normalisePath(route.path);
    const cId = contractNodeId(route.method, normPath);

    if (!seenContracts.has(cId)) {
      seenContracts.add(cId);
      contractNodes.push({
        id: cId,
        kind: NODE_KINDS.contract,
        name: `${route.method} ${route.path}`,
        locator: `rest://${route.method}${route.path}`,
      });
    }

    bridgeEdges.push({
      id: edgeId(route.nodeId, cId, EDGE_RELATIONS.implements_contract),
      source: route.nodeId,
      target: cId,
      relation: EDGE_RELATIONS.implements_contract,
    });
  }

  for (const call of fetchCalls) {
    const normUrl = normalisePath(call.url);
    for (const route of routes) {
      const normPath = normalisePath(route.path);
      if (normUrl === normPath) {
        const cId = contractNodeId(route.method, normPath);

        bridgeEdges.push({
          id: edgeId(call.nodeId, cId, EDGE_RELATIONS.consumes_contract),
          source: call.nodeId,
          target: cId,
          relation: EDGE_RELATIONS.consumes_contract,
        });
      }
    }
  }

  return { contractNodes, bridgeEdges };
}
