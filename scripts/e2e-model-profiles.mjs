/**
 * Disable and restore model profiles on the isolated dev instance.
 *
 * A subprocess for the same reason the seeder is one: Playwright transpiles the
 * global setup to CommonJS, and the database client here is ESM.
 *
 *   node scripts/e2e-model-profiles.mjs disable          # prints disabled ids
 *   node scripts/e2e-model-profiles.mjs restore <id...>
 */
import { PrismaClient } from "@prisma/client"

const [, , command, ...ids] = process.argv

/**
 * Refuse to touch anything but the development database.
 *
 * This edits a real instance's configuration. Pointing it at production would
 * silently turn off a customer's AI.
 */
function assertDevDatabase() {
  const url = process.env.DATABASE_URL ?? ""
  if (!/arciin_dev|arciin_test/.test(url)) {
    throw new Error(
      "e2e-model-profiles refuses to run outside arciin_dev/arciin_test. " +
        "DATABASE_URL does not look like a development database.",
    )
  }
}

async function main() {
  assertDevDatabase()
  const prisma = new PrismaClient()
  try {
    if (command === "disable") {
      const enabled = await prisma.modelProfile.findMany({
        where: { isEnabled: true },
        select: { id: true },
      })
      if (enabled.length > 0) {
        await prisma.modelProfile.updateMany({
          where: { id: { in: enabled.map((p) => p.id) } },
          data: { isEnabled: false },
        })
      }
      process.stdout.write(enabled.map((p) => p.id).join("\n"))
      return
    }

    if (command === "restore") {
      if (ids.length > 0) {
        await prisma.modelProfile.updateMany({
          where: { id: { in: ids } },
          data: { isEnabled: true },
        })
      }
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
