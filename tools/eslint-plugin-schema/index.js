// Per architecture/schema-v3.md §1 Rule 5 + Rule 6
// ESLint plugin: schema/dag + schema/no-vocabulary-string-literal

import { dagRule } from "./dag.js";
import { noVocabularyStringLiteralRule } from "./no-vocabulary-string-literal.js";

export const rules = {
  dag: dagRule,
  "no-vocabulary-string-literal": noVocabularyStringLiteralRule,
};
