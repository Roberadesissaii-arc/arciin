import type { PrismaClient } from "@prisma/client"

import { inferMediaType } from "@arciin/shared"

/** Fix assets stored as OTHER/DOCUMENT before APPLICATION classification shipped. */
export async function reclassifyApplicationAssets(prisma: PrismaClient): Promise<number> {
  const candidates = await prisma.asset.findMany({
    where: {
      deletedAt: null,
      mediaType: { in: ["OTHER", "DOCUMENT"] },
    },
    select: {
      id: true,
      originalFilename: true,
      mimeType: true,
      mediaType: true,
    },
  })

  let updated = 0
  for (const asset of candidates) {
    const next = inferMediaType(asset.mimeType, asset.originalFilename)
    if (next !== "APPLICATION" || asset.mediaType === "APPLICATION") continue
    await prisma.asset.update({
      where: { id: asset.id },
      data: { mediaType: "APPLICATION" },
    })
    updated += 1
  }

  return updated
}
