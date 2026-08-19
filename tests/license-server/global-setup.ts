import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

import { LICENSE_TEST_DB_PATH, LICENSE_TEST_DB_URL } from "./test-env"

/**
 * Build a throwaway licensing database for the suite.
 *
 * `prisma db push` against a file that does not exist yet creates the schema
 * from scratch, so each run starts from a known-empty authority rather than
 * whatever the developer's local prototype happens to contain. The path is
 * under /tmp and is deleted first — these tests must never be able to reach
 * `apps/license-server/data/licenses.db`.
 */
export async function setup() {
  const dbUrl = LICENSE_TEST_DB_URL
  const dbPath = LICENSE_TEST_DB_PATH
  if (!dbPath.startsWith("/tmp/")) {
    throw new Error(
      `Refusing to run the licensing suite against ${dbPath} — it must be a throwaway file under /tmp.`,
    )
  }

  fs.rmSync(path.dirname(dbPath), { recursive: true, force: true })
  fs.mkdirSync(path.dirname(dbPath), { recursive: true })

  const repoRoot = path.resolve(__dirname, "..", "..")
  execFileSync(
    "npx",
    ["prisma", "db", "push", "--schema", "apps/license-server/prisma/schema.prisma", "--skip-generate"],
    {
      cwd: repoRoot,
      env: { ...process.env, LICENSE_DATABASE_URL: dbUrl },
      stdio: "pipe",
    },
  )
}
