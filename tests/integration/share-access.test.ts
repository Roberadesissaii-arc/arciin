import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"

import {
  assertAssetInShareScope,
  generateShareToken,
  resolveShareByToken,
} from "../../apps/api/src/services/shares/share-access"
import { hashToken } from "../../apps/api/src/services/security/auth"
import {
  createAsset,
  createFolder,
  createTestStorageRoot,
  prisma,
  removeTestStorageRoot,
  resetDatabase,
  seedBaseFixtures,
  type Fixtures,
} from "./setup"

/**
 * Share links, against real PostgreSQL.
 *
 * A share link is the one credential in Arciin that is handed to someone who
 * has no account, so "revoked" and "expired" have to be facts about the row
 * rather than about what the UI chooses to render. Every case here goes through
 * `resolveShareByToken` — the same call the public route makes — because the
 * question is whether the *server* refuses, not whether a page hides a button.
 */

let fixtures: Fixtures

/** The service only touches `fastify.prisma`; a real client behind that shape is enough. */
const fastify = { prisma } as unknown as Parameters<typeof resolveShareByToken>[0]

beforeAll(async () => {
  const root = await createTestStorageRoot()
  await resetDatabase()
  fixtures = await seedBaseFixtures(root)
})

afterAll(async () => {
  await resetDatabase()
  await removeTestStorageRoot()
  await prisma.$disconnect()
})

beforeEach(async () => {
  await prisma.shareLink.deleteMany()
  await prisma.asset.deleteMany()
  await prisma.folder.deleteMany()
})

async function createAssetShare(overrides: Partial<{
  expiresAt: Date | null
  revokedAt: Date | null
  maxViews: number | null
  viewCount: number
}> = {}) {
  const asset = await createAsset(fixtures, { librarySlug: "videos", mediaType: "VIDEO" })
  const { rawToken, tokenHash, tokenPrefix } = generateShareToken()

  const share = await prisma.shareLink.create({
    data: {
      createdById: fixtures.user.id,
      resourceType: "ASSET",
      assetId: asset.id,
      tokenHash,
      tokenPrefix,
      expiresAt: overrides.expiresAt ?? null,
      revokedAt: overrides.revokedAt ?? null,
      maxViews: overrides.maxViews ?? null,
      viewCount: overrides.viewCount ?? 0,
    },
  })

  return { asset, share, rawToken }
}

describe("share token", () => {
  it("carries real entropy and is never stored in the clear", async () => {
    const { rawToken, share } = await createAssetShare()

    expect(rawToken.startsWith("shr_")).toBe(true)
    // 24 random bytes, base64url — 192 bits. Not a guessable id.
    expect(rawToken.length).toBeGreaterThanOrEqual(36)

    const stored = await prisma.shareLink.findUnique({ where: { id: share.id } })
    expect(stored?.tokenHash).toBe(hashToken(rawToken))
    expect(stored?.tokenHash).not.toBe(rawToken)
    // The prefix is for display; it must not be enough to reconstruct the token.
    expect(rawToken.startsWith(stored!.tokenPrefix)).toBe(true)
    expect(stored!.tokenPrefix.length).toBeLessThan(rawToken.length)
  })

  it("two shares never collide", async () => {
    const a = generateShareToken()
    const b = generateShareToken()
    expect(a.rawToken).not.toBe(b.rawToken)
    expect(a.tokenHash).not.toBe(b.tokenHash)
  })
})

describe("resolveShareByToken", () => {
  it("resolves a live share", async () => {
    const { rawToken, asset } = await createAssetShare()

    const result = await resolveShareByToken(fastify, rawToken)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.share.assetId).toBe(asset.id)
  })

  it("refuses a token that does not exist", async () => {
    const result = await resolveShareByToken(fastify, "shr_completely-made-up-token")
    expect(result).toEqual({ ok: false, code: "NOT_FOUND" })
  })

  it("refuses a revoked share", async () => {
    const { rawToken } = await createAssetShare({ revokedAt: new Date() })

    const result = await resolveShareByToken(fastify, rawToken)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe("REVOKED")
  })

  it("stops serving the moment revocation is written, using the same token", async () => {
    const { rawToken, share } = await createAssetShare()

    // Works before.
    expect((await resolveShareByToken(fastify, rawToken)).ok).toBe(true)

    await prisma.shareLink.update({
      where: { id: share.id },
      data: { revokedAt: new Date() },
    })

    // And not after — no cache, no grace period.
    const after = await resolveShareByToken(fastify, rawToken)
    expect(after.ok).toBe(false)
    if (!after.ok) expect(after.code).toBe("REVOKED")
  })

  it("refuses an expired share", async () => {
    const { rawToken } = await createAssetShare({
      expiresAt: new Date(Date.now() - 60_000),
    })

    const result = await resolveShareByToken(fastify, rawToken)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe("EXPIRED")
  })

  it("still serves a share whose expiry is in the future", async () => {
    const { rawToken } = await createAssetShare({
      expiresAt: new Date(Date.now() + 3_600_000),
    })
    expect((await resolveShareByToken(fastify, rawToken)).ok).toBe(true)
  })

  it("refuses once the view limit is reached", async () => {
    const { rawToken } = await createAssetShare({ maxViews: 3, viewCount: 3 })

    const result = await resolveShareByToken(fastify, rawToken)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe("VIEW_LIMIT")
  })

  it("still serves while under the view limit", async () => {
    const { rawToken } = await createAssetShare({ maxViews: 3, viewCount: 2 })
    expect((await resolveShareByToken(fastify, rawToken)).ok).toBe(true)
  })

  /**
   * Deleting the thing shared is how a person revokes access to it. A link that
   * outlives the delete is a data-exposure bug, not a dangling reference.
   */
  it("stops serving when the shared asset is soft-deleted", async () => {
    const { rawToken, asset } = await createAssetShare()

    await prisma.asset.update({
      where: { id: asset.id },
      data: { deletedAt: new Date() },
    })

    expect((await resolveShareByToken(fastify, rawToken)).ok).toBe(false)
  })
})

describe("share scope", () => {
  it("refuses an asset that is not inside the shared folder", async () => {
    const shared = await createFolder(fixtures, { librarySlug: "videos", name: "Shared" })
    const other = await createFolder(fixtures, { librarySlug: "videos", name: "Private" })

    const outsider = await createAsset(fixtures, {
      librarySlug: "videos",
      folderId: other.id,
      mediaType: "VIDEO",
    })

    const { rawToken } = (await (async () => {
      const { rawToken, tokenHash, tokenPrefix } = generateShareToken()
      await prisma.shareLink.create({
        data: {
          createdById: fixtures.user.id,
          resourceType: "FOLDER",
          folderId: shared.id,
          tokenHash,
          tokenPrefix,
        },
      })
      return { rawToken }
    })())

    const resolved = await resolveShareByToken(fastify, rawToken)
    expect(resolved.ok).toBe(true)
    if (!resolved.ok) return

    // Guessing a valid asset id from a valid share token must not be enough.
    const inScope = await assertAssetInShareScope(fastify, resolved.share, outsider.id)
    expect(inScope).toBeNull()
  })
})
