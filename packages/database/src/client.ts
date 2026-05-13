import { PrismaClient } from "@prisma/client"

declare global {
  var __arciinPrisma: PrismaClient | undefined
}

export const prisma =
  globalThis.__arciinPrisma ||
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  })

if (process.env.NODE_ENV !== "production") {
  globalThis.__arciinPrisma = prisma
}
