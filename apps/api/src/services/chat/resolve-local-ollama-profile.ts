import type { PrismaClient, ModelProfile } from "@prisma/client"

const LOCAL_OLLAMA = new Set(["ollama", "ollama-local", "ollama-cloud"])

export async function resolveLocalOllamaProfile(prisma: PrismaClient): Promise<ModelProfile | null> {
  const enabled = await prisma.modelProfile.findMany({
    where: { isEnabled: true, provider: { in: [...LOCAL_OLLAMA] } },
    orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }],
  })

  const localFirst = enabled.find((p) => p.provider === "ollama" || p.provider === "ollama-local")
  return localFirst ?? enabled[0] ?? null
}

export function isCloudChatProvider(provider: string): boolean {
  return !LOCAL_OLLAMA.has(provider)
}
