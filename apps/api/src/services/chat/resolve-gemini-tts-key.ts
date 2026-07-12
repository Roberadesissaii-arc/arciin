import type { PrismaClient } from "@prisma/client"
import { DEFAULT_GEMINI_TTS_MODEL } from "@arciin/shared"

export type GeminiTtsConfig = {
  apiKey: string
  ttsModel: string
  profileId: string | null
}

export async function resolveGeminiTtsConfig(
  prisma: PrismaClient,
  profileId?: string,
): Promise<GeminiTtsConfig> {
  if (profileId) {
    const selected = await prisma.modelProfile.findFirst({
      where: { id: profileId, isEnabled: true, provider: "gemini" },
      select: { id: true, apiKey: true, ttsModel: true },
    })
    if (selected?.apiKey?.trim()) {
      return {
        profileId: selected.id,
        apiKey: selected.apiKey.trim(),
        ttsModel: selected.ttsModel?.trim() || DEFAULT_GEMINI_TTS_MODEL,
      }
    }
  }

  const profile = await prisma.modelProfile.findFirst({
    where: { isEnabled: true, provider: "gemini", apiKey: { not: null } },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    select: { id: true, apiKey: true, ttsModel: true },
  })
  if (profile?.apiKey?.trim()) {
    return {
      profileId: profile.id,
      apiKey: profile.apiKey.trim(),
      ttsModel: profile.ttsModel?.trim() || DEFAULT_GEMINI_TTS_MODEL,
    }
  }

  throw new Error("GEMINI_NOT_CONFIGURED")
}

/** @deprecated Use resolveGeminiTtsConfig */
export async function resolveGeminiTtsKeyForInstance(
  prisma: PrismaClient,
  profileId?: string,
): Promise<string> {
  const config = await resolveGeminiTtsConfig(prisma, profileId)
  return config.apiKey
}
