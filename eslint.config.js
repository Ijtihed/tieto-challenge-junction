import tsParser from "@typescript-eslint/parser";
import { dagRule } from "./tools/eslint-plugin-schema/dag.js";
import { noVocabularyStringLiteralRule } from "./tools/eslint-plugin-schema/no-vocabulary-string-literal.js";

export default [
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parser: tsParser,
    },
    plugins: {
      schema: {
        rules: {
          dag: dagRule,
          "no-vocabulary-string-literal": noVocabularyStringLiteralRule,
        },
      },
    },
    rules: {
      "schema/dag": "error",
      "schema/no-vocabulary-string-literal": "error",
    },
  },
  {
    ignores: ["node_modules/", "dist/", "clients/", "tests/", "src/__tests__/"],
  },
];
