import type { LibraryKind, PrismaClient } from "@prisma/client"

import { inferMediaType } from "@arciin/shared"

/** Libraries that must not keep source files — those belong in Inbox. */
const TYPED_LIBRARY_KINDS: LibraryKind[] = ["DOCUMENT", "VIDEO", "IMAGE", "AUDIO"]

/**
 * Fix assets stored as OTHER/DOCUMENT before CODE classification shipped,
 * and move leftover scripts out of Documents (and other typed libraries)
 * into Inbox. Computer-backup trees stay put.
 */
export async function reclassifyCodeAssets(prisma: PrismaClient): Promise<number> {
  const inbox =
    (await prisma.library.findFirst({ where: { slug: "inbox" } })) ??
    (await prisma.library.findFirst({ where: { kind: "INBOX" } }))

  const typedLibraries = await prisma.library.findMany({
    where: { kind: { in: TYPED_LIBRARY_KINDS } },
    select: { id: true },
  })
  const typedIds = typedLibraries.map((row) => row.id)

  const candidates = await prisma.asset.findMany({
    where: {
      deletedAt: null,
      OR: [
        { mediaType: { in: ["OTHER", "DOCUMENT"] } },
        typedIds.length > 0
          ? { mediaType: "CODE", libraryId: { in: typedIds } }
          : { id: { in: [] } },
      ],
    },
    select: {
      id: true,
      originalFilename: true,
      mimeType: true,
      mediaType: true,
      libraryId: true,
      library: { select: { kind: true } },
    },
  })

  let updated = 0
  for (const asset of candidates) {
    const inferred = inferMediaType(asset.mimeType, asset.originalFilename)
    const isCode = inferred === "CODE" || asset.mediaType === "CODE"
    if (!isCode) continue

    const data: { mediaType?: "CODE"; libraryId?: string; folderId?: null } = {}
    if (inferred === "CODE" && asset.mediaType !== "CODE") {
      data.mediaType = "CODE"
    }
    const misplaced =
      Boolean(inbox) &&
      TYPED_LIBRARY_KINDS.includes(asset.library.kind) &&
      asset.libraryId !== inbox!.id
    if (misplaced) {
      data.libraryId = inbox!.id
      data.folderId = null
    }
    if (Object.keys(data).length === 0) continue
    await prisma.asset.update({
      where: { id: asset.id },
      data,
    })
    updated += 1
  }

  return updated
}
