import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Build output anywhere (e.g. agent worktrees under .claude keep their own .next), and
    // the local-only .claude scratch directory itself. Untracked; never lint it.
    "**/.next/**",
    ".claude/**",
  ]),
]);

export default eslintConfig;
