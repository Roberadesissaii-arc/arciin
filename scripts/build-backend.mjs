#!/usr/bin/env node
/**
 * Production bundles for API and worker.
 *
 * Workspace packages (@arciin/*) ship as TypeScript in dev; production runs
 * compiled JS so we do not need tsx at runtime (ARC-004).
 */
import path from "node:path"
import { fileURLToPath } from "node:url"

import esbuild from "esbuild"

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))

/** Externalize every npm package; bundle app source + @arciin workspace only. */
const externalizeNpmPlugin = {
  name: "externalize-npm",
  setup(build) {
    const externalize = (args) => {
      if (args.path.startsWith("@arciin/")) return null
      if (args.path.startsWith("node:")) return null
      return { path: args.path, external: true }
    }
    build.onResolve({ filter: /^[^./@]/ }, externalize)
    build.onResolve({ filter: /^@[^/]+\/[^/]+/ }, externalize)
  },
}

const shared = {
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  sourcemap: true,
  logLevel: "info",
  plugins: [externalizeNpmPlugin],
}

async function buildOne(label, entry, outfile) {
  await esbuild.build({
    ...shared,
    entryPoints: [entry],
    outfile,
    tsconfig: path.join(root, label === "api" ? "apps/api/tsconfig.json" : "apps/worker/tsconfig.json"),
  })
}

await buildOne("api", path.join(root, "apps/api/src/index.ts"), path.join(root, "apps/api/dist/index.js"))
await buildOne("worker", path.join(root, "apps/worker/src/index.ts"), path.join(root, "apps/worker/dist/index.js"))

console.log("[build-backend] api and worker bundles written to apps/*/dist/index.js")
