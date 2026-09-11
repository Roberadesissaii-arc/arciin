/**
 * A temporary Gemini profile for the real-provider transcript leg.
 *
 * The suite used to need someone to add a Gemini credential to the dev instance
 * by hand before the acceptance test could run, which is exactly the sort of
 * unwritten step that makes a suite unreproducible.
 *
 * Two rules shape this file:
 *
 * 1. The key comes from the environment and goes straight into the encrypted
 *    column. It is never logged, never written to a file, never echoed back —
 *    not even in an error message, which is where secrets usually escape.
 * 2. Only the row this harness created is ever deleted. It carries a marker id
 *    of its own, so cleanup cannot reach a real Gemini profile that happens to
 *    share the provider name.
 */

import { execFileSync } from "node:child_process"
import path from "node:path"

/** The single row this harness owns. Deleted by id, never by provider. */
export const E2E_GEMINI_PROFILE_ID = "e2e-temp-gemini-transcript"
export const E2E_GEMINI_DISPLAY_NAME = "E2E Temporary Gemini Transcript"

/** Present only when someone deliberately supplied a key for this run. */
export function geminiKeyConfigured(): boolean {
  return Boolean(process.env.E2E_GEMINI_API_KEY?.trim())
}

/**
 * Run a snippet against the dev database in a child process.
 *
 * The seeding path is ESM using `import.meta` and Playwright transpiles its
 * setup files to CommonJS, so this cannot simply be imported — the same reason
 * `globalSetup` shells out to the seeder.
 *
 * The key is passed through the child's environment rather than interpolated
 * into the script text, so it never appears in an argv a `ps` could read.
 */
function runAgainstDevDb(script: string, extraEnv: Record<string, string> = {}) {
  const repoRoot = path.resolve(__dirname, "../..")
  execFileSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: repoRoot,
    env: { ...process.env, ...extraEnv },
    // Inherit stderr so a failure is visible; the script prints no secrets.
    stdio: ["ignore", "inherit", "inherit"],
  })
}

const PRELUDE = `
import path from "node:path"
import { config as loadEnv } from "dotenv"
import { PrismaClient } from "@prisma/client"
const repoRoot = process.cwd()
loadEnv({ path: path.join(repoRoot, ".env"), quiet: true })
loadEnv({ path: path.join(repoRoot, ".env.development"), override: process.env.CI !== "true", quiet: true })
const name = new URL(process.env.DATABASE_URL).pathname.replace(/^\\//, "")
if (name !== "arciin_dev") {
  throw new Error('refusing to touch model profiles in "' + name + '"; expected arciin_dev')
}
const prisma = new PrismaClient()
`

/**
 * Create the temporary profile, if a key was supplied.
 *
 * Returns whether the real-provider leg can run, so the spec can skip with a
 * clear reason rather than failing on a missing credential.
 */
export function createTemporaryGeminiProfile(): boolean {
  const key = process.env.E2E_GEMINI_API_KEY?.trim()
  if (!key) return false

  runAgainstDevDb(`${PRELUDE}
try {
  await prisma.modelProfile.upsert({
    where: { id: ${JSON.stringify(E2E_GEMINI_PROFILE_ID)} },
    create: {
      id: ${JSON.stringify(E2E_GEMINI_PROFILE_ID)},
      provider: "gemini",
      displayName: ${JSON.stringify(E2E_GEMINI_DISPLAY_NAME)},
      apiKey: process.env.E2E_GEMINI_API_KEY,
      defaultModel: "gemini-2.5-flash",
      isDefault: false,
      isEnabled: true,
    },
    update: { apiKey: process.env.E2E_GEMINI_API_KEY, isEnabled: true },
  })
} finally {
  await prisma.$disconnect()
}
`)
  // Says that it happened, never what it contains.
  console.log("[e2e] Temporary E2E Gemini profile created")
  return true
}

/**
 * Remove the temporary profile.
 *
 * Deletes by the harness's own id. Deleting by `provider: "gemini"` would take
 * a real profile with it on any instance that has one, which is the kind of
 * cleanup that is worse than no cleanup at all.
 *
 * Never throws: it runs from teardown, and a cleanup failure must not replace
 * the real reason a suite failed.
 */
export function removeTemporaryGeminiProfile(): void {
  try {
    runAgainstDevDb(`${PRELUDE}
try {
  const { count } = await prisma.modelProfile.deleteMany({
    where: { id: ${JSON.stringify(E2E_GEMINI_PROFILE_ID)} },
  })
  if (count > 0) console.log("[e2e] Temporary E2E Gemini profile removed")
} finally {
  await prisma.$disconnect()
}
`)
  } catch (error) {
    console.warn(
      `[e2e] could not remove the temporary Gemini profile: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
  }
}
