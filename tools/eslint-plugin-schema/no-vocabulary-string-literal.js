// Per architecture/schema-v3.md §1 Rule 6 + §4.1
// Forbids string-literal NodeKind or EdgeRelation values outside the canonical file
// + 3 named exceptions (vocabulary file itself, JSON Schema generator, vocabulary self-test).

const NODE_KIND_VALUES = [
  "route_handler", "service", "data_access", "middleware",
  "model", "utility", "external", "contract", "deployment",
];

const EDGE_RELATION_VALUES = [
  "imports", "calls", "registers_route", "applies_middleware",
  "implements_contract", "consumes_contract", "deploys_to",
];

const ALL_VOCAB = new Set([...NODE_KIND_VALUES, ...EDGE_RELATION_VALUES]);

const EXCEPTION_PATTERNS = [
  /domain\/vocabulary\.ts$/,
  /domain\/wire-schema\.ts$/,
  /domain\/multi-repo\.ts$/,
  /domain\/canonical-shape\.ts$/,
  /__tests__\/vocabulary\.test\.ts$/,
];

function isException(filename) {
  return EXCEPTION_PATTERNS.some((p) => p.test(filename));
}

export const noVocabularyStringLiteralRule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Forbid string-literal NodeKind/EdgeRelation values outside domain/vocabulary.ts",
    },
    schema: [],
  },
  create(context) {
    const filename = context.filename ?? context.getFilename();
    if (isException(filename)) return {};

    return {
      Literal(node) {
        if (typeof node.value !== "string") return;
        if (!ALL_VOCAB.has(node.value)) return;

        context.report({
          node,
          message: `Vocabulary string literal "${node.value}" must not appear outside domain/vocabulary.ts. Import from 'domain/vocabulary.js' instead. See architecture/schema-v3.md §1 Rule 6.`,
        });
      },
    };
  },
};
