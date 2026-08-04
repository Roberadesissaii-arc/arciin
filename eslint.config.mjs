import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    "apps/web/.next/**",
    // Development build output — generated bundles, not source.
    "apps/web/.next-dev/**",
    "out/**",
    "build/**",
    "apps/web/next-env.d.ts",
    // Reference-only snapshot; not part of the Arciin app package graph.
    "Arceclaw/**",
    // PM2 production config (CommonJS require).
    "ecosystem.config.cjs",
    "apps/web/public/pdfjs-wasm/**",
  ]),
  {
    files: ["apps/web/**/*.{js,jsx,ts,tsx,mjs}"],
  },
]);

export default eslintConfig;
