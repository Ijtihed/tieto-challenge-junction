// Per architecture/schema-v3.md §4.3 + research/03 §2 — gRPC/protobuf bridge.
// Joins proto service/rpc contract nodes (from extractor-generic-config)
// to server-side gRPC implementations in Go, Java, TS.
// Emits implements_contract edges from handler → proto contract.

import type { GraphNode, GraphEdge, RepoSubgraph } from "./multi-repo.ts";
import { EDGE_RELATIONS } from "./vocabulary.ts";
import { createHash } from "node:crypto";

export interface GrpcImplInfo {
  readonly serviceName: string;
  readonly nodeId: string;
  readonly repoUri: string;
}

function edgeId(source: string, target: string, relation: string): string {
  return "e_" + createHash("sha256").update(`${source}\0${target}\0${relation}`).digest("hex").slice(0, 12);
}

export function detectGrpcImpls(repos: readonly RepoSubgraph[]): GrpcImplInfo[] {
  const impls: GrpcImplInfo[] = [];
  for (const repo of repos) {
    for (const node of repo.nodes) {
      if (!node.filePath) continue;

      // Go: UnimplementedXxxServer embedding or RegisterXxxServer calls
      if (node.filePath.endsWith(".go") && node.name.startsWith("Unimplemented")) {
        const serviceName = node.name.replace("Unimplemented", "").replace("Server", "");
        impls.push({ serviceName, nodeId: node.id, repoUri: repo.uri });
      }

      // Java/Kotlin: classes extending XxxGrpc.XxxImplBase or annotated @GrpcService
      if ((node.filePath.endsWith(".java") || node.filePath.endsWith(".kt")) &&
          (node.name.includes("ImplBase") || node.name.includes("Grpc"))) {
        const serviceName = node.name.replace("ImplBase", "").replace("Grpc", "");
        impls.push({ serviceName, nodeId: node.id, repoUri: repo.uri });
      }

      // TS: classes implementing XxxServiceServer or using @grpc/grpc-js
      if ((node.filePath.endsWith(".ts") || node.filePath.endsWith(".js")) &&
          node.name.includes("ServiceServer")) {
        const serviceName = node.name.replace("ServiceServer", "");
        impls.push({ serviceName, nodeId: node.id, repoUri: repo.uri });
      }
    }
  }
  return impls;
}

export function buildGrpcBridgeEdges(
  protoNodes: readonly GraphNode[],
  impls: GrpcImplInfo[],
): { bridgeEdges: GraphEdge[] } {
  const bridgeEdges: GraphEdge[] = [];

  const serviceContracts = protoNodes.filter((n) =>
    n.locator.startsWith("proto://proto:") && !n.locator.includes(":rpc:") && !n.locator.includes(":msg:"),
  );

  for (const impl of impls) {
    const matchingContract = serviceContracts.find((c) => {
      const contractName = c.name.replace("proto:", "");
      return contractName.toLowerCase() === impl.serviceName.toLowerCase();
    });

    if (matchingContract) {
      bridgeEdges.push({
        id: edgeId(impl.nodeId, matchingContract.id, EDGE_RELATIONS.implements_contract),
        source: impl.nodeId,
        target: matchingContract.id,
        relation: EDGE_RELATIONS.implements_contract,
      });
    }
  }

  return { bridgeEdges };
}
