import type { PrismaClient } from "@prisma/client"
import type { AssetSourceContext } from "@arciin/types"

export async function loadAssetSourceContexts(
  prisma: PrismaClient,
  assetIds: string[],
): Promise<Map<string, AssetSourceContext>> {
  const map = new Map<string, AssetSourceContext>()
  if (assetIds.length === 0) return map

  const entries = await prisma.syncEntry.findMany({
    where: { assetId: { in: assetIds }, syncState: "ACTIVE" },
    include: {
      syncRoot: {
        include: {
          device: { select: { id: true, name: true } },
        },
      },
    },
  })

  for (const entry of entries) {
    if (!entry.assetId) continue
    const breadcrumbs = [entry.syncRoot.device.name, entry.syncRoot.displayName]
    if (entry.relativePath) {
      breadcrumbs.push(...entry.relativePath.split("/"))
    }
    map.set(entry.assetId, {
      deviceId: entry.syncRoot.device.id,
      deviceName: entry.syncRoot.device.name,
      rootDisplayName: entry.syncRoot.displayName,
      relativePath: entry.relativePath,
      breadcrumbs,
    })
  }
  return map
}

export async function attachAssetSourceContext<T extends { id: string }>(
  prisma: PrismaClient,
  assets: T[],
): Promise<Array<T & { sourceContext?: AssetSourceContext | null }>> {
  const contexts = await loadAssetSourceContexts(
    prisma,
    assets.map((asset) => asset.id),
  )
  return assets.map((asset) => ({
    ...asset,
    sourceContext: contexts.get(asset.id) ?? null,
  }))
}
