import fs from "node:fs"
import path from "node:path"

import { licenseServerConfig } from "./config.js"
import { prisma } from "./db.js"
import { buildLicenseServer } from "./server.js"

async function main() {
  // Ensure SQLite data directory exists for file: URLs
  const dbUrl = licenseServerConfig.LICENSE_DATABASE_URL
  if (dbUrl.startsWith("file:")) {
    const filePath = dbUrl.replace(/^file:/, "")
    const dir = path.dirname(filePath)
    fs.mkdirSync(dir, { recursive: true })
  }

  const app = await buildLicenseServer()

  const shutdown = async () => {
    await app.close()
    await prisma.$disconnect()
    process.exit(0)
  }
  process.on("SIGINT", () => void shutdown())
  process.on("SIGTERM", () => void shutdown())

  await app.listen({
    port: licenseServerConfig.LICENSE_SERVER_PORT,
    host: "0.0.0.0",
  })

  app.log.info(
    `Arciin license server listening on :${licenseServerConfig.LICENSE_SERVER_PORT} (prototype — no Stripe)`,
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
