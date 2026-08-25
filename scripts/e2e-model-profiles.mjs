/**
 * Point the suite's model profiles at nothing, and put them back.
 *
 * A subprocess for the same reason the seeder is one: Playwright transpiles the
 * global setup to CommonJS, and the database client here is ESM.
 *
 *   node scripts/e2e-model-profiles.mjs quiet     # redirect, record originals
 *   node scripts/e2e-model-profiles.mjs restore   # put the originals back
 *
 * The profiles stay *enabled*. Disabling them was the first attempt and it was
 * wrong: the chat composer is disabled when no model is configured, so three
 * specs that stub the chat stream — and never need a real model — failed on a
 * composer that never became typeable. Only the endpoint moves.
 */
import { readFileSync, writeFileSync, existsSync, rmSync, mkdirSync } from "node:fs"
import path from "node:path"

import { PrismaClient } from "@prisma/client"

const [, , command] = process.argv

/** Nothing listens on port 1, so a call fails at connect rather than waiting. */
const NOWHERE = "http://127.0.0.1:1"

/**
 * Originals live on disk, not in the runner's memory.
 *
 * Killing Playwright skips teardown — a first version of this left the
 * developer's model turned off after an interrupted run. Setup reads this file
 * before it does anything else, so the next run repairs the last one.
 */
const STATE_FILE = path.resolve(import.meta.dirname, "../test-results/.e2e-model-profiles.json")

function assertDevDatabase() {
  const url = process.env.DATABASE_URL ?? ""
  if (!/arciin_dev|arciin_test/.test(url)) {
    throw new Error(
      "e2e-model-profiles refuses to run outside arciin_dev/arciin_test. " +
        "DATABASE_URL does not look like a development database.",
    )
  }
}

async function restore(prisma) {
  if (!existsSync(STATE_FILE)) return 0
  const saved = JSON.parse(readFileSync(STATE_FILE, "utf8"))
  for (const { id, baseUrl } of saved) {
    await prisma.modelProfile.updateMany({ where: { id }, data: { baseUrl } })
  }
  rmSync(STATE_FILE, { force: true })
  return saved.length
}

async function main() {
  assertDevDatabase()
  const prisma = new PrismaClient()
  try {
    if (command === "restore") {
      const n = await restore(prisma)
      if (n > 0) console.log(`[e2e] Restored ${n} model profile endpoint(s)`)
      return
    }

    if (command === "quiet") {
      // Repair an interrupted previous run before recording a new baseline,
      // or the dead endpoint would be saved as if it were the original.
      await restore(prisma)

      const profiles = await prisma.modelProfile.findMany({
        where: { isEnabled: true },
        select: { id: true, baseUrl: true, provider: true },
      })
      const local = profiles.filter((p) => p.baseUrl)
      if (local.length === 0) {
        console.log("[e2e] No local model endpoint to quiet")
        return
      }
      mkdirSync(path.dirname(STATE_FILE), { recursive: true })
      writeFileSync(
        STATE_FILE,
        JSON.stringify(local.map(({ id, baseUrl }) => ({ id, baseUrl })), null, 2),
      )
      await prisma.modelProfile.updateMany({
        where: { id: { in: local.map((p) => p.id) } },
        data: { baseUrl: NOWHERE },
      })
      console.log(
        `[e2e] Model endpoint(s) pointed at nothing for this run: ${local
          .map((p) => p.provider)
          .join(", ")} — restored in teardown`,
      )
      return
    }

    throw new Error(`unknown command: ${command}`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error) => {
  console.error("[e2e-model-profiles]", error instanceof Error ? error.message : error)
  process.exit(1)
})
