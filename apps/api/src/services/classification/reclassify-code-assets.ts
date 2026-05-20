import type { PrismaClient } from "@prisma/client"

import { inferMediaType } from "@arciin/shared"

/** Fix assets stored as OTHER before CODE classification shipped. */
export async function reclassifyCodeAssets(prisma: PrismaClient): Promise<number> {
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
    if (next !== "CODE" || asset.mediaType === "CODE") continue
    await prisma.asset.update({
      where: { id: asset.id },
      data: { mediaType: "CODE" },
    })
    updated += 1
  }

  return updated
}
