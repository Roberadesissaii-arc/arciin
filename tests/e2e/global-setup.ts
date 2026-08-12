import { execFileSync } from "node:child_process"
import path from "node:path"

/**
 * Seed the dev owner account before the browser suite starts.
 *
 * Run as a subprocess rather than imported: Playwright transpiles this file to
 * CommonJS, and the seed script is ESM using `import.meta`, so a direct import
 * fails at load. A subprocess also keeps the seeder usable on its own
 * (`node scripts/e2e-seed.mjs`) when debugging a login failure.
 */
export default function globalSetup() {
  const script = path.resolve(__dirname, "../../scripts/e2e-seed.mjs")
  // Inherit stdio so a seeding failure is visible rather than swallowed.
  execFileSync(process.execPath, [script], { stdio: "inherit" })
}
