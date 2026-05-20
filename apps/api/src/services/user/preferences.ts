import type { PrismaClient } from "@prisma/client"
import { parseUserPreferences, type UserPreferences } from "@arciin/shared"

export async function loadUserPreferences(
  prisma: PrismaClient,
  userId: string,
): Promise<UserPreferences> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { preferences: true },
  })
  return parseUserPreferences(user?.preferences ?? null)
}
