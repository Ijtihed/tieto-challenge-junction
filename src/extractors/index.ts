// Per architecture/schema-v3.md §3.6
// Phase 2: TS. Phase 7: Python, Go. Phase 8: Java/Kotlin, Ruby, Rust, generic-config.
export { extractorTypescript } from "./extractor-typescript/index.ts";
export { extractorPython } from "./extractor-python/index.ts";
export { extractorGo } from "./extractor-go/index.ts";
export { extractorJavaKotlin } from "./extractor-java-kotlin/index.ts";
export { extractorRuby } from "./extractor-ruby/index.ts";
export { extractorRust } from "./extractor-rust/index.ts";
export { extractorGenericConfig } from "./extractor-generic-config/index.ts";
export { isGeneratedFile, type GeneratedFileInfo } from "./generated-detect.ts";
