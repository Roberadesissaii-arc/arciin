import { Prisma } from "@prisma/client"

export function isPrismaMissingTableError(err: unknown): boolean {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2021" || err.code === "P2022") return true
  }
  if (err instanceof Error && /does not exist/i.test(err.message)) {
    return true
  }
  return false
}

export const DATABASE_MIGRATION_REQUIRED = {
  code: "DATABASE_MIGRATION_REQUIRED" as const,
  message:
    "Database schema is out of date. On the server run: pnpm exec prisma migrate deploy",
}
