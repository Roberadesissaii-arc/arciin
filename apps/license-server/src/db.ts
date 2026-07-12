import { PrismaClient } from "../node_modules/.prisma/license-client/index.js"

import { licenseServerConfig } from "./config.js"

// Ensure SQLite file URL is absolute-friendly for Prisma.
process.env.LICENSE_DATABASE_URL = licenseServerConfig.LICENSE_DATABASE_URL

export const prisma = new PrismaClient({
  datasources: {
    db: { url: licenseServerConfig.LICENSE_DATABASE_URL },
  },
})
