import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  {
    ignores: [
      "dist",
      // Generated builds, proof environments and isolated installation fixtures.
      "build",
      "node_modules",
      "public/vision",
      // Byte-pinned Apache-2.0 upstream browser client, checked separately.
      "vendor/lsdp-native-browser",
      "test-results",
      // Local profiling captures contain generated/minified host bundles,
      // not Solar source files. Keep the full source lint intact.
      "evidence",
      // Agent worktrees / harness checkouts live untracked under .claude
      // and carry their own built dist — never Solar's lintable source.
      ".claude",
      // Local validation worktrees are likewise independent checkouts. Their
      // generated bundles must not be linted as Solar source.
      ".worktrees",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Node-side scripts run in a Node ESM context.
    files: ["scripts/**/*.mjs", "scripts/**/*.js", "tests/tooling/**/*.mjs"],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
    files: ["**/*.ts"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  prettier,
);
