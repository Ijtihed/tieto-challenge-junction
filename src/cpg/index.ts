// CPG (Code Property Graph) integration — Fraunhofer-AISEC cpg library.
// Provides deep code analysis (AST, DFG, CFG, CDG, PDG) as a sidecar.
export { detectJava, type JavaInfo } from "./detect-java.ts";
export { createCpgSidecar, type CpgSidecar, type CpgSidecarOptions } from "./sidecar.ts";
export { createCpgClient, type CpgClient, type CpgAnalysisResult, type CpgDataflowResult } from "./client.ts";
export { mergeCpgData, type CpgGraphData, type CpgNode, type CpgEdge } from "./merge.ts";
