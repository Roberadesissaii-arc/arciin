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
    // Browser-suite build output — generated bundles, not source.
    "apps/web/.next-e2e/**",
    // Staging build output. Every build lands here, so on any machine that has
    // built, these generated bundles outnumbered the source files and buried
    // the real findings.
    "apps/web/.next-build/**",
    // The previous build, kept by deploy-web.sh so a bad deploy can roll back.
    "apps/web/.next-prev/**",
    // Compiled backend bundles — esbuild output, not source.
    "apps/api/dist/**",
    "apps/worker/dist/**",
    // Account portal build output — same generated bundles as apps/web/.next.
    // Missing here, `pnpm lint` failed for anyone who had built the portal.
    "apps/account/.next/**",
    // Playwright artifacts: traces, videos and bundled page sources.
    "test-results/**",
    "reports/**",
    "out/**",
    "build/**",
    "apps/web/next-env.d.ts",
    // Reference-only snapshot; not part of the Arciin app package graph.
    "Arceclaw/**",
    // PM2 configs (CommonJS require).
    "ecosystem.config.cjs",
    "ecosystem.vendor.config.cjs",
    "apps/web/public/pdfjs-wasm/**",
  ]),
  {
    files: ["apps/web/**/*.{js,jsx,ts,tsx,mjs}"],
  },
]);

export default eslintConfig;
