// Per architecture/schema-v3.md §5.3 action 1
// Phase 7: multi-extractor (TS + Python + Go) + REST bridge.
// Phase 13: + gRPC bridge + SQL bridge.
import { openSession } from "../session/index.ts";
import { buildAdapterSet, type AdapterMode } from "../adapters/index.ts";
import { extractorTypescript } from "../extractors/extractor-typescript/index.ts";
import { extractorPython } from "../extractors/extractor-python/index.ts";
import { extractorGo } from "../extractors/extractor-go/index.ts";
import { extractorCsharp } from "../extractors/extractor-csharp/index.ts";
import { extractorJavaKotlin } from "../extractors/extractor-java-kotlin/index.ts";
import { extractorRuby } from "../extractors/extractor-ruby/index.ts";
import { extractorRust } from "../extractors/extractor-rust/index.ts";
import { extractorGenericConfig } from "../extractors/extractor-generic-config/index.ts";
import { CURRENT_WIRE_VERSION } from "../domain/wire-format.ts";
import { graphHash } from "../domain/graph-hash.ts";
import { detectFetchCalls, buildRestBridgeEdges, type RouteInfo } from "../domain/bridge-rest.ts";
import { detectGrpcImpls, buildGrpcBridgeEdges } from "../domain/bridge-grpc.ts";
import { detectOrmModels, buildSqlBridgeEdges } from "../domain/bridge-sql.ts";
import { logger } from "../obs/index.ts";
import type { ExtractContext } from "../extractors/extract-types.ts";
import type {
  ExtractionStats,
  ExtractorStats,
  FilterCounts,
  FilteredFile,
} from "../domain/extraction-stats.ts";
import { emptyFilterCounts } from "../domain/extraction-stats.ts";
import { createStatsSink, type StatsSink } from "../extractors/parser-config.ts";
import { computeChangedFiles, contentHash } from "../extractors/file-hash.ts";
import { fsAdapterImpls } from "../adapters/fs/index.ts";
import { readdir as fsReaddir } from "node:fs/promises";
import { relative, resolve as pathResolve } from "node:path";
import { NODE_KINDS } from "../domain/vocabulary.ts";
import { detectArchetype, detectMonorepo } from "../domain/archetype-detect.ts";
import type { RepoSubgraph, MultiRepoGraph, GraphNode, GraphEdge } from "../domain/multi-repo.ts";
import { populateEdb } from "../domain/datalog/edb.ts";
import { buildClusters } from "../domain/cluster.ts";
import { openStore, type CacheKey } from "../domain/persistence/store.ts";
import { computeExtractorVersionHash, computeBridgesVersionHash } from "../domain/persistence/version.ts";
import { BUILTIN_RULES } from "../domain/builtin-rules.ts";
import type { Violation } from "../domain/types.ts";
import { homedir } from "node:os";
import { join } from "node:path";

const DB_PATH = join(homedir(), ".schema", "graph-cache.db");
const BRIDGE_IDS = ["rest", "grpc", "sql"] as const;

const EXTRACTORS = [
  extractorTypescript, extractorPython, extractorGo,
  extractorJavaKotlin, extractorRuby, extractorRust, extractorGenericConfig,
  extractorCsharp,
] as const;

type ProgressCallback = (event: { kind: string; extractorId: string; message?: string; at: number }) => void;

async function runExtractor(
  extractor: (typeof EXTRACTORS)[number],
  repoUri: string,
  adapterMode: AdapterMode,
  stats: StatsSink,
  changedFiles?: ReadonlySet<string>,
  onProgress?: ProgressCallback,
): Promise<RepoSubgraph | null> {
  const adapters = buildAdapterSet(adapterMode);
  const ctx: ExtractContext = changedFiles
    ? { repoUri, fs: adapters.fs, changedFiles, stats }
    : { repoUri, fs: adapters.fs, stats };

  onProgress?.({ kind: "extractor.start", extractorId: extractor.id, at: Date.now() });

  for await (const event of extractor.extract(ctx)) {
    if (event.kind === "done" && event.data) {
      onProgress?.({ kind: "extractor.done", extractorId: extractor.id, at: Date.now() });
      return event.data;
    }
    if (event.kind === "progress") {
      onProgress?.({ kind: "extractor.progress", extractorId: extractor.id, ...(event.message ? { message: event.message } : {}), at: Date.now() });
    }
    if (event.kind === "error") {
      onProgress?.({ kind: "extractor.error", extractorId: extractor.id, ...(event.message ? { message: event.message } : {}), at: Date.now() });
      logger.warn("workspace-open", `${extractor.id} error: ${event.message}`);
      return null;
    }
  }
  onProgress?.({ kind: "extractor.done", extractorId: extractor.id, at: Date.now() });
  return null;
}

function freezeStats(extractorId: string, sink: StatsSink): ExtractorStats {
  return {
    extractorId,
    filesAttempted: sink.attempted,
    filesParsed: sink.parsed,
    filesSkipped: sink.skipped,
    failures: sink.failures.slice(),
    filtered: { ...sink.filtered },
  };
}

const WORKSPACE_FILTERED_SAMPLE_CAP = 50;

/** Step 4 — workspace-level gitignore + always-ignored filter
 *  audit. Run once per repo at workspace.open BEFORE any
 *  extractor runs. Walks the full unfiltered listDir, applies
 *  the composed filter, and tallies per-reason counts +
 *  samples filenames so `caching.stats.filtered` carries the
 *  breakdown ("4,200 gitignored, 122 always-ignored"). */
async function computeWorkspaceFilterStats(
  workspaceRoot: string,
): Promise<{ counts: FilterCounts; sample: FilteredFile[] }> {
  const counts = emptyFilterCounts();
  const sample: FilteredFile[] = [];
  try {
    const fsImpl = fsAdapterImpls.real;
    if (!fsImpl.buildFilter) return { counts, sample };
    const filter = await fsImpl.buildFilter(workspaceRoot);
    const entries = await fsReaddir(workspaceRoot, { recursive: true, withFileTypes: true });
    for (const e of entries) {
      if (!e.isFile()) continue;
      const full = pathResolve(e.parentPath, e.name);
      const rel = relative(workspaceRoot, full);
      const outcome = filter.check(rel);
      if (outcome.allowed) continue;
      const reason = outcome.reason ?? "always";
      counts[reason] = (counts[reason] ?? 0) + 1;
      if (sample.length < WORKSPACE_FILTERED_SAMPLE_CAP) {
        sample.push({ filePath: full, reason, extractorId: "fs-adapter" });
      }
    }
  } catch (err) {
    logger.warn(
      "workspace-open",
      `filter audit failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return { counts, sample };
}

function aggregateExtractionStats(
  perExtractor: readonly ExtractorStats[],
  workspaceFiltered?: FilterCounts,
  workspaceFilteredSample?: readonly FilteredFile[],
): ExtractionStats {
  let filesAttempted = 0;
  let filesParsed = 0;
  let filesSkipped = 0;
  const failures = [] as ExtractionStats["failures"][number][];
  const filtered: FilterCounts = emptyFilterCounts();
  const filteredSample = [] as FilteredFile[];

  // Workspace-level filtering happens once at workspace.open before
  // any extractor runs (gitignore + always-ignored). The counts come
  // from comparing the unfiltered-vs-filtered listDir results.
  if (workspaceFiltered) {
    for (const key of Object.keys(filtered) as (keyof FilterCounts)[]) {
      filtered[key] = (filtered[key] ?? 0) + (workspaceFiltered[key] ?? 0);
    }
  }
  if (workspaceFilteredSample) {
    for (const f of workspaceFilteredSample) {
      if (filteredSample.length < 50) filteredSample.push(f);
    }
  }

  for (const ext of perExtractor) {
    filesAttempted += ext.filesAttempted;
    filesParsed += ext.filesParsed;
    filesSkipped += ext.filesSkipped;
    for (const f of ext.failures) failures.push(f);
    for (const key of Object.keys(filtered) as (keyof FilterCounts)[]) {
      filtered[key] = (filtered[key] ?? 0) + (ext.filtered[key] ?? 0);
    }
  }
  return {
    filesAttempted,
    filesParsed,
    filesSkipped,
    failures,
    perExtractor,
    filtered,
    filteredSample,
  };
}

/** Step 3 — archetype + monorepo detection driven by the
 *  current session graph and a fresh `listDir` of the workspace
 *  root. Used by both the cache-miss path (full extraction) and
 *  the cache-hit path (cached graph + re-detect). Side-effects:
 *  writes `session.archetype` + `session.monorepo`, emits an
 *  `archetype.detected` event. Idempotent. */
async function runArchetypeDetection(
  session: import("../session/session.ts").Session,
  rootPath0: string | null,
  graph: MultiRepoGraph,
): Promise<void> {
  try {
    const allFilePaths: string[] = graph.repos
      .filter((r) => !r.uri.startsWith("bridge://"))
      .flatMap((r) =>
        r.nodes
          .map((n) => n.filePath)
          .filter((p): p is string => typeof p === "string"),
      );
    const allNodes = graph.repos
      .filter((r) => !r.uri.startsWith("bridge://"))
      .flatMap((r) => [...r.nodes]);

    const rootFiles: string[] = [];
    if (rootPath0) {
      try {
        const adapters = buildAdapterSet("real");
        const root = await adapters.fs.listDir(rootPath0);
        for (const p of root) {
          const base = p.split("/").pop();
          if (base) rootFiles.push(base);
        }
      } catch (err) {
        logger.warn(
          "workspace-open",
          `archetype: failed to list root files (${err instanceof Error ? err.message : String(err)})`,
        );
      }
    }

    const archetype = detectArchetype({ rootFiles, allFilePaths, nodes: allNodes });
    const monorepo = session.workspaceUris.length > 1 ||
      detectMonorepo(rootFiles, allFilePaths);

    session.archetype = archetype;
    session.monorepo = monorepo;
    session.eventBus.emit({
      kind: "archetype.detected",
      primary: archetype.primary,
      secondaries: archetype.secondaries,
      confidence: archetype.confidence,
      monorepo,
      at: Date.now(),
    });
  } catch (err) {
    logger.warn(
      "workspace-open",
      `archetype detection failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

export const workspaceOpen = {
  name: "workspace.open" as const,
  description: "Open a workspace session by extracting the code graph from one or more repository URIs.",
  sideEffect: "final" as const,
  inputSchema: {
    type: "object",
    properties: {
      uris: { type: "array", items: { type: "string" }, description: "Non-empty array of repository URIs (e.g. file:// paths) to open" },
      adapterMode: { type: "string", enum: ["real", "mock"], description: "Adapter mode for file system and git operations" },
      samplerPrefs: { type: "array", items: { type: "string" }, description: "Preferred sampler vendor IDs (e.g. anthropic, openai)" },
    },
    required: ["uris"],
  },

  async handle(args: Record<string, unknown>) {
    const uris = args["uris"] as string[] | undefined;
    if (!uris || !Array.isArray(uris) || uris.length === 0) {
      return { ok: false as const, code: "invalid-args", message: "uris is required and must be a non-empty string array" };
    }

    const adapterMode = (args["adapterMode"] as AdapterMode) ?? "real";
    const samplerPrefs = args["samplerPrefs"] as string[] | undefined;

    const init: import("../session/index.ts").SessionInit = { adapterMode };
    if (samplerPrefs) init.samplerPrefs = samplerPrefs;
    const session = openSession(uris, init);

    // Cache-load path: try to load from persisted snapshot.
    const rootUri = session.workspaceUris[0];
    const rootPath0 = rootUri ? (rootUri.startsWith("file://") ? rootUri.slice(7) : rootUri) : "";
    let fromCache = false;

    if (rootPath0 && adapterMode === "real") {
      try {
        const adapters0 = buildAdapterSet("real");
        const gitSha = await adapters0.git.headSha(rootPath0).catch(() => "");
        if (gitSha) {
          const extHash = computeExtractorVersionHash(
            EXTRACTORS.map((e) => ({ id: e.id, version: "0.0.0" })),
          );
          const bridgesHash = computeBridgesVersionHash([...BRIDGE_IDS]);
          const cacheKey: CacheKey = {
            workspacePath: rootPath0,
            gitSha,
            extractorVersionHash: extHash,
            bridgesVersionHash: bridgesHash,
          };

          let store;
          try {
            store = openStore(DB_PATH);
            const cached = store.loadSnapshot(cacheKey);
            if (cached) {
              session.graph = cached;
              session.incrementalEval.setEdb(populateEdb(cached));
              fromCache = true;
              logger.info("workspace-open", `cache hit for ${rootPath0}@${gitSha.slice(0, 7)}`);

              for (const repo of cached.repos) {
                session.eventBus.emit({
                  kind: "workspace.extraction_complete",
                  repoUri: repo.uri,
                  contributedNodes: repo.nodes.length,
                  fromCache: true,
                  at: Date.now(),
                });
              }

              // Step 4: re-audit the filter on cache hit too —
              // the .gitignore + always-ignored set may have
              // expanded since the cache was written, and the
              // filter table itself may have improved.
              const cachedFilter = rootPath0
                ? await computeWorkspaceFilterStats(rootPath0)
                : { counts: emptyFilterCounts(), sample: [] as FilteredFile[] };
              const cachedStats: ExtractionStats = {
                filesAttempted: 0,
                filesParsed: 0,
                filesSkipped: 0,
                failures: [],
                perExtractor: [],
                filtered: cachedFilter.counts,
                filteredSample: cachedFilter.sample,
              };
              session.latestExtractionStats = cachedStats;
              // Re-detect archetype even on cache hit: file
              // contents haven't changed, but the detector itself
              // may have improved since the cache was written.
              await runArchetypeDetection(session, rootPath0, cached);
              return {
                ok: true as const,
                data: {
                  sessionId: session.id,
                  workspace: describeWorkspace(session),
                  fromCache: true,
                  extraction: cachedStats,
                },
              };
            }
          } catch (err) {
            logger.warn("workspace-open", `cache load failed: ${err instanceof Error ? err.message : String(err)}`);
          } finally {
            store?.close();
          }
        }
      } catch {
        // git or cache not available — proceed with extraction
      }
    }

    const repos: RepoSubgraph[] = [];
    const allRoutes: RouteInfo[] = [];
    const perExtractorStats: ExtractorStats[] = [];

    for (const uri of session.workspaceUris) {
      const rootPath = uri.startsWith("file://") ? uri.slice(7) : uri;
      const adapters = buildAdapterSet(adapterMode);

      let changedFiles: Set<string> | undefined;
      let newHashes: Map<string, string> | undefined;

      if (session.fileHashes.size > 0) {
        try {
          const allFiles = await adapters.fs.listDir(rootPath, { recursive: true });
          const currentFiles = new Map<string, string>();
          for (const f of allFiles) {
            try { currentFiles.set(f, await adapters.fs.readFile(f)); } catch { /* skip unreadable */ }
          }
          const result = computeChangedFiles(session.fileHashes, currentFiles);
          changedFiles = result.changedFiles;
          newHashes = result.newHashes;
        } catch {
          logger.warn("workspace-open", "failed to compute changed files, running full extraction");
        }
      }

      const mergedNodes: GraphNode[] = [];
      const mergedEdges: GraphEdge[] = [];
      const seenNodeIds = new Set<string>();
      const seenEdgeIds = new Set<string>();

      if (changedFiles) {
        const existingRepo = session.graph.repos.find((r) => r.uri === uri);
        if (existingRepo) {
          const unchangedNodeIds = new Set<string>();
          for (const n of existingRepo.nodes) {
            if (n.filePath && !changedFiles.has(n.filePath)) {
              mergedNodes.push(n);
              seenNodeIds.add(n.id);
              unchangedNodeIds.add(n.id);
            }
          }
          for (const e of existingRepo.edges) {
            if (unchangedNodeIds.has(e.source) || unchangedNodeIds.has(e.target)) {
              if (!seenEdgeIds.has(e.id)) { mergedEdges.push(e); seenEdgeIds.add(e.id); }
            }
          }
        }
      }

      const emitProgress: ProgressCallback = (event) => session.eventBus.emit(event);

      for (const extractor of EXTRACTORS) {
        const sink = createStatsSink();
        const sub = await runExtractor(extractor, uri, adapterMode, sink, changedFiles, emitProgress);
        perExtractorStats.push(freezeStats(extractor.id, sink));
        if (sub) {
          for (const n of sub.nodes) {
            if (!seenNodeIds.has(n.id)) { mergedNodes.push(n); seenNodeIds.add(n.id); }
          }
          for (const e of sub.edges) {
            if (!seenEdgeIds.has(e.id)) { mergedEdges.push(e); seenEdgeIds.add(e.id); }
          }

          const meta = (sub as RepoSubgraph & { meta?: { routes?: { method: string; path: string; handlerName: string; filePath: string }[] } }).meta;
          if (meta?.routes) {
            for (const r of meta.routes) {
              const node = sub.nodes.find((n) => n.name === r.handlerName && n.filePath === r.filePath);
              if (node) {
                allRoutes.push({ method: r.method, path: r.path, nodeId: node.id, repoUri: uri });
              }
            }
          }
        }
      }

      if (newHashes) {
        for (const [path, hash] of newHashes) {
          session.fileHashes.set(path, hash);
        }
      } else {
        try {
          const allFiles = await adapters.fs.listDir(rootPath, { recursive: true });
          for (const f of allFiles) {
            try {
              const content = await adapters.fs.readFile(f);
              session.fileHashes.set(f, contentHash(content));
            } catch { /* skip unreadable */ }
          }
        } catch {
          logger.warn("workspace-open", "failed to hash files for incremental extraction baseline");
        }
      }

      const repoResult: RepoSubgraph = { uri, nodes: mergedNodes, edges: mergedEdges, clusters: [] };
      repos.push(repoResult);

      if (repoResult.nodes.length > 0) {
        session.eventBus.emit({
          kind: "graph.patched",
          patch: { addNodes: repoResult.nodes, addEdges: repoResult.edges },
          hash: graphHash({ version: CURRENT_WIRE_VERSION, repos: [repoResult], interRepoEdges: [] }),
          at: Date.now(),
        });
      }

      session.eventBus.emit({
        kind: "workspace.extraction_complete",
        repoUri: repoResult.uri,
        contributedNodes: repoResult.nodes.length,
        at: Date.now(),
      });
    }

    session.eventBus.emit({
      kind: "bridges.start",
      message: "Linking cross-language contracts (REST, gRPC, SQL)...",
      at: Date.now(),
    });

    const fetchCalls = detectFetchCalls(repos);
    const { contractNodes, bridgeEdges } = buildRestBridgeEdges(allRoutes, fetchCalls);

    if (contractNodes.length > 0) {
      const bridgeRepo: RepoSubgraph = {
        uri: "bridge://rest",
        nodes: contractNodes,
        edges: bridgeEdges,
        clusters: [],
      };
      repos.push(bridgeRepo);
    }

    const allContractNodes = repos.flatMap((r) => r.nodes.filter((n) => n.kind === NODE_KINDS.contract));

    const grpcImpls = detectGrpcImpls(repos);
    const grpcResult = buildGrpcBridgeEdges(allContractNodes, grpcImpls);
    if (grpcResult.bridgeEdges.length > 0) {
      const existingBridge = repos.find((r) => r.uri === "bridge://rest");
      if (existingBridge) {
        (existingBridge.edges as GraphEdge[]).push(...grpcResult.bridgeEdges);
      } else {
        repos.push({ uri: "bridge://grpc", nodes: [], edges: grpcResult.bridgeEdges, clusters: [] });
      }
    }

    const ormModels = detectOrmModels(repos);
    const sqlResult = buildSqlBridgeEdges(allContractNodes, ormModels);
    if (sqlResult.bridgeEdges.length > 0) {
      const existingBridge = repos.find((r) => r.uri === "bridge://rest");
      if (existingBridge) {
        (existingBridge.edges as GraphEdge[]).push(...sqlResult.bridgeEdges);
      } else {
        repos.push({ uri: "bridge://sql", nodes: [], edges: sqlResult.bridgeEdges, clusters: [] });
      }
    }

    const totalBridgeEdges =
      bridgeEdges.length + grpcResult.bridgeEdges.length + sqlResult.bridgeEdges.length;
    session.eventBus.emit({
      kind: "bridges.done",
      bridgeEdges: totalBridgeEdges,
      contractNodes: contractNodes.length,
      at: Date.now(),
    });

    session.eventBus.emit({
      kind: "clustering.start",
      message: "Detecting architectural clusters...",
      at: Date.now(),
    });

    // Architectural clustering: replace each non-bridge repo's empty
    // `clusters: []` with a Leiden community detection result enriched by
    // directory structure. Bridge repos get a single named "Contracts"
    // cluster so their nodes don't end up unassigned (which would funnel
    // them into "Other" at the client and erase the architecture story).
    const clusteredRepos: RepoSubgraph[] = repos.map((repo) => {
      if (repo.uri.startsWith("bridge://")) {
        if (repo.nodes.length === 0) return repo;
        const protocol = repo.uri.replace("bridge://", "").toUpperCase();
        return {
          ...repo,
          clusters: [{
            id: `cluster:contracts-${protocol.toLowerCase()}`,
            name: `${protocol} Contracts`,
            nodeIds: repo.nodes.map((n) => n.id),
            // Bridge clusters are synthesised, not built by
            // `buildClusters`. Mark the tier as
            // `folder-archetype` since the name is derived
            // from the protocol (an archetype-like signal),
            // so downstream consumers (Studio chip rendering,
            // labelTier audit scripts) treat it uniformly
            // with the rest of the Step 7a tiered labels.
            labelTier: "folder-archetype" as const,
          }],
        };
      }
      try {
        const workspaceRoot = repo.uri.startsWith("file://")
          ? repo.uri.slice("file://".length)
          : undefined;
        const clusters = buildClusters(repo.nodes, repo.edges, workspaceRoot);
        return { ...repo, clusters };
      } catch (err) {
        logger.warn(
          "workspace-open",
          `clustering failed for ${repo.uri}: ${err instanceof Error ? err.message : String(err)}`,
        );
        return repo;
      }
    });

    const totalClusters = clusteredRepos.reduce((s, r) => s + r.clusters.length, 0);
    session.eventBus.emit({
      kind: "clustering.done",
      clusters: totalClusters,
      at: Date.now(),
    });

    const graph: MultiRepoGraph = {
      version: CURRENT_WIRE_VERSION,
      repos: clusteredRepos,
      interRepoEdges: [],
    };
    session.graph = graph;
    session.incrementalEval.setEdb(populateEdb(graph));

    // Step 4 — workspace-level filter audit (gitignore +
    // always-ignored). Walks the unfiltered listDir once and
    // tallies the per-reason breakdown. Combined with the
    // per-extractor generated/codegen/binary counts to produce
    // the full `caching.stats.filtered` payload.
    const workspaceFilter = rootPath0
      ? await computeWorkspaceFilterStats(rootPath0)
      : { counts: emptyFilterCounts(), sample: [] as FilteredFile[] };

    const extractionStats = aggregateExtractionStats(
      perExtractorStats,
      workspaceFilter.counts,
      workspaceFilter.sample,
    );
    session.latestExtractionStats = extractionStats;
    session.eventBus.emit({
      kind: "extraction.stats",
      filesAttempted: extractionStats.filesAttempted,
      filesParsed: extractionStats.filesParsed,
      filesSkipped: extractionStats.filesSkipped,
      failureCount: extractionStats.failures.length,
      filteredCount: Object.values(extractionStats.filtered).reduce((a, b) => a + b, 0),
      at: Date.now(),
    });

    // Step 3 — archetype detection per [research:25.§8.2]. Runs
    // after extraction so all node kinds + file paths are known.
    await runArchetypeDetection(session, rootPath0, graph);
    if (extractionStats.failures.length > 0) {
      logger.warn(
        "workspace-open",
        `${extractionStats.failures.length} file(s) failed to parse out of ${extractionStats.filesAttempted}; banner will surface in Studio`,
      );
    }

    // Cache-save: persist the extracted graph for future cache hits.
    if (rootPath0 && adapterMode === "real") {
      try {
        const adaptersForSave = buildAdapterSet("real");
        const gitSha = await adaptersForSave.git.headSha(rootPath0).catch(() => "");
        if (gitSha) {
          const extHash = computeExtractorVersionHash(
            EXTRACTORS.map((e) => ({ id: e.id, version: "0.0.0" })),
          );
          const bridgesHash = computeBridgesVersionHash([...BRIDGE_IDS]);
          let store;
          try {
            store = openStore(DB_PATH);
            const saveResult = store.saveSnapshot(
              { workspacePath: rootPath0, gitSha, extractorVersionHash: extHash, bridgesVersionHash: bridgesHash },
              graph,
            );
            const nodeCount = graph.repos.reduce((s, r) => s + r.nodes.length, 0);
            // Step 6: per research/27 §7.5 surface the overlay /
            // base / early-cutoff decision in the log so dogfood
            // sessions show the storage win in real time.
            if (saveResult.kind === "overlay") {
              logger.info(
                "workspace-open",
                `cached ${rootPath0}@${gitSha.slice(0, 7)} (${nodeCount} nodes; overlay on parent #${saveResult.chainDepth - 1}, ${saveResult.overlayUnits.length} units, chain depth ${saveResult.chainDepth})`,
              );
            } else if (saveResult.kind === "none") {
              logger.info(
                "workspace-open",
                `cached ${rootPath0}@${gitSha.slice(0, 7)} (${nodeCount} nodes; L5 early-cutoff, reused snapshot #${saveResult.id})`,
              );
            } else {
              logger.info(
                "workspace-open",
                `cached ${rootPath0}@${gitSha.slice(0, 7)} (${nodeCount} nodes; base snapshot)`,
              );
            }
          } catch (err) {
            logger.warn("workspace-open", `cache save failed: ${err instanceof Error ? err.message : String(err)}`);
          } finally {
            store?.close();
          }
        }
      } catch {
        // cache save non-critical
      }
    }

    // Step 9a work item 5: AGENTS.md auto-trigger (default-on).
    // When the workspace already has an AGENTS.md (or CLAUDE.md)
    // file at the root, write the Schema-fenced facts section
    // into it after a successful open. Per Q14, we DO NOT
    // create the file behind the user's back — auto-trigger
    // is opt-in via file presence.
    if (rootPath0) {
      await maybeAutoWriteAgentsMd(session, rootPath0);
    }

    return {
      ok: true as const,
      data: {
        sessionId: session.id,
        workspace: describeWorkspace(session),
        fromCache: false,
        extraction: extractionStats,
      },
    };
  },
};

/** Step 9a work item 5: default-on AGENTS.md round-trip.
 *  Fires after a successful workspace.open IF an AGENTS.md or
 *  CLAUDE.md file already exists. Writes to whichever file
 *  exists (AGENTS.md takes precedence if both exist).
 *  Failures are logged but never block the open. Extracted
 *  as a helper per §0.6.4 (a) for direct unit-testability. */
async function maybeAutoWriteAgentsMd(
  session: import("../session/session.ts").Session,
  rootPath: string,
): Promise<void> {
  const { existsSync } = await import("node:fs");
  const { join } = await import("node:path");
  // Precedence: AGENTS.md first, then CLAUDE.md. Same order
  // as `readAgentsMd` in `wisdom/agents-md/index.ts`.
  // Precedence: AGENTS.md first, then CLAUDE.md. Same order
  // as `readAgentsMd` in `wisdom/agents-md/index.ts`.
  let target: string | null = null;
  if (existsSync(join(rootPath, "AGENTS.md"))) target = "AGENTS.md";
  else if (existsSync(join(rootPath, "CLAUDE.md"))) target = "CLAUDE.md";
  if (!target) {
    logger.info(
      "workspace-open",
      `no AGENTS.md / CLAUDE.md at ${rootPath}; skipping auto round-trip`,
    );
    return;
  }
  try {
    const { renderFacts, writeFacts } = await import("../wisdom/agents-md/index.ts");
    const violations: Violation[] = [];
    for (const rule of BUILTIN_RULES) {
      violations.push(...rule.evaluate(session.graph));
    }
    const facts = renderFacts(session.graph, violations);
    const result = writeFacts(rootPath, facts, target);
    session.eventBus.emit({
      kind: "agents_md.facts_written",
      writtenPath: result.writtenPath,
      charsAdded: result.charsAdded,
      charsRemoved: result.charsRemoved,
      at: Date.now(),
    });
    logger.info(
      "workspace-open",
      `auto-wrote ${target} facts (+${result.charsAdded}, -${result.charsRemoved} chars)`,
    );
  } catch (err) {
    logger.warn(
      "workspace-open",
      `AGENTS.md auto-write failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

function describeWorkspace(session: import("../session/session.ts").Session) {
  const graph = session.graph;
  const allNodes = graph.repos.flatMap((r) => r.nodes);
  const EXT_MAP: Record<string, string> = {
    ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
    py: "python", go: "go", java: "java", kt: "kotlin", rb: "ruby", rs: "rust",
    proto: "protobuf", sql: "sql",
  };
  const languages = [...new Set(allNodes.flatMap((n) => {
    const ext = n.filePath?.split(".").pop();
    if (ext && EXT_MAP[ext]) return [EXT_MAP[ext]!];
    return [];
  }))];

  const activeExtractors = EXTRACTORS.map((e) => ({
    id: e.id,
    version: "0.0.0",
    languages: [...e.declare().languages],
    "frameworks-detected": [] as string[],
  }));

  return {
    rootUris: [...session.workspaceUris],
    languages,
    frameworks: [] as string[],
    buildSystem: null as string | null,
    monorepo: session.monorepo || session.workspaceUris.length > 1,
    archetype: session.archetype,
    extractors: activeExtractors,
    samplers: session.samplerPrefs.map((s) => ({ id: s, vendor: s, available: false, reason: "not wired yet" })),
    wireFormatVersion: CURRENT_WIRE_VERSION,
    schemaVersion: "0.0.0",
    extractorBaseline: { extractedAt: Date.now(), hash: "" },
    testRunners: [] as { kind: string; command: string; cwd: string }[],
  };
}
