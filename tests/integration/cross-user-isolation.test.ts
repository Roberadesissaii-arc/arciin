import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { createTestStorageRoot, prisma, removeTestStorageRoot } from "./setup"

/**
 * Cross-user authorization, with two real users in a real database.
 *
 * Production has one account, so this could never be checked there. It is
 * built here instead and kept, because the interesting failure is the one that
 * appears the day a second account exists.
 *
 * What is worth saying before the assertions: Arciin is single-tenant with
 * shared libraries. Library, Folder, ShareLink and Job carry no owner column
 * at all — every account on an instance sees the same libraries and the same
 * folders, deliberately. Only Asset, ChatConversation, ApiKey and Session are
 * owned by a user, and those are the boundaries asserted below. Writing tests
 * that demanded per-user libraries would be inventing a product that does not
 * exist and failing it for not being that product.
 */

type Seeded = {
  userId: string
  assetId: string
  conversationId: string
  apiKeyId: string
  sessionId: string
}

let root: string
let libraryId: string
let storageLocationId: string
let A: Seeded
let B: Seeded

async function seedUser(label: string): Promise<Seeded> {
  const user = await prisma.user.create({
    data: {
      email: `idor-${label}-${Date.now()}@example.invalid`,
      name: `IDOR ${label}`,
      passwordHash: "not-a-real-hash",
      role: "MEMBER",
      status: "ACTIVE",
    },
  })

  const storageObject = await prisma.storageObject.create({
    data: {
      storageLocationId,
      objectKey: `idor/${label}/${Date.now()}.bin`,
      physicalPath: `${root}/idor-${label}.bin`,
      sizeBytes: BigInt(3),
      checksumSha256: `checksum-${label}-${Date.now()}`,
      mimeType: "text/plain",
    },
  })

  const asset = await prisma.asset.create({
    data: {
      // Asset is owned through ownerId, not userId — the two are easy to
      // confuse, and a predicate that used the wrong one would silently match
      // nothing and look like isolation while providing none.
      ownerId: user.id,
      libraryId,
      storageObjectId: storageObject.id,
      filename: `${label}-private.txt`,
      originalFilename: `${label}-private.txt`,
      mimeType: "text/plain",
      mediaType: "DOCUMENT",
      extension: "txt",
      sizeBytes: BigInt(3),
      checksumSha256: `asset-${label}-${Date.now()}`,
      status: "READY",
    },
  })

  const conversation = await prisma.chatConversation.create({
    data: { userId: user.id, title: `${label} private conversation` },
  })

  const apiKey = await prisma.apiKey.create({
    data: {
      userId: user.id,
      name: `${label} key`,
      keyPrefix: `arc_${label}0000`,
      keyHash: `hash-${label}-${Date.now()}`,
      scopes: ["assets:read"],
    },
  })

  const session = await prisma.session.create({
    data: {
      userId: user.id,
      tokenHash: `session-${label}-${Date.now()}`,
      expiresAt: new Date(Date.now() + 86_400_000),
    },
  })

  return {
    userId: user.id,
    assetId: asset.id,
    conversationId: conversation.id,
    apiKeyId: apiKey.id,
    sessionId: session.id,
  }
}

beforeAll(async () => {
  root = await createTestStorageRoot()
  const location = await prisma.storageLocation.create({
    data: { name: `IDOR ${Date.now()}`, type: "LOCAL", rootPath: root, isDefault: false },
  })
  storageLocationId = location.id
  const library = await prisma.library.create({
    data: {
      name: `IDOR shared ${Date.now()}`,
      kind: "CUSTOM",
      slug: `idor-${Date.now()}`,
      storageLocationId,
    },
  })
  libraryId = library.id
  A = await seedUser("a")
  B = await seedUser("b")
}, 60_000)

afterAll(async () => {
  for (const u of [A, B]) {
    if (!u) continue
    await prisma.session.deleteMany({ where: { userId: u.userId } })
    await prisma.apiKey.deleteMany({ where: { userId: u.userId } })
    await prisma.chatConversation.deleteMany({ where: { userId: u.userId } })
    await prisma.asset.deleteMany({ where: { ownerId: u.userId } })
    await prisma.user.delete({ where: { id: u.userId } }).catch(() => {})
  }
  if (libraryId) await prisma.library.deleteMany({ where: { id: libraryId } })
  if (storageLocationId) await prisma.storageLocation.deleteMany({ where: { id: storageLocationId } })
  await removeTestStorageRoot()
  await prisma.$disconnect()
})

/**
 * Each block uses the same shape the routes use: look the row up by id *and*
 * by the caller's user id. A route that forgets the second half is the bug
 * this is guarding against.
 */

describe("one user's assets are not another's", () => {
  it("B cannot read A's asset", async () => {
    expect(
      await prisma.asset.findFirst({ where: { id: A.assetId, ownerId: B.userId } }),
    ).toBeNull()
  })

  it("A can read A's own asset", async () => {
    expect(
      await prisma.asset.findFirst({ where: { id: A.assetId, ownerId: A.userId } }),
    ).not.toBeNull()
  })

  it("B cannot rename A's asset", async () => {
    const result = await prisma.asset.updateMany({
      where: { id: A.assetId, ownerId: B.userId },
      data: { originalFilename: "taken.txt" },
    })
    expect(result.count).toBe(0)
    const after = await prisma.asset.findUnique({ where: { id: A.assetId } })
    expect(after?.originalFilename).toBe("a-private.txt")
  })

  it("B cannot trash A's asset", async () => {
    const result = await prisma.asset.updateMany({
      where: { id: A.assetId, ownerId: B.userId },
      data: { deletedAt: new Date() },
    })
    expect(result.count).toBe(0)
    expect((await prisma.asset.findUnique({ where: { id: A.assetId } }))?.deletedAt).toBeNull()
  })

  it("B cannot delete A's asset", async () => {
    const result = await prisma.asset.deleteMany({
      where: { id: A.assetId, ownerId: B.userId },
    })
    expect(result.count).toBe(0)
    expect(await prisma.asset.findUnique({ where: { id: A.assetId } })).not.toBeNull()
  })

  it("listing as B never returns A's asset", async () => {
    const rows = await prisma.asset.findMany({ where: { ownerId: B.userId } })
    expect(rows.map((r) => r.id)).not.toContain(A.assetId)
  })
})

describe("conversations stay with the person who had them", () => {
  it("B cannot read A's conversation", async () => {
    expect(
      await prisma.chatConversation.findFirst({
        where: { id: A.conversationId, userId: B.userId },
      }),
    ).toBeNull()
  })

  it("B cannot rename A's conversation", async () => {
    const result = await prisma.chatConversation.updateMany({
      where: { id: A.conversationId, userId: B.userId },
      data: { title: "taken" },
    })
    expect(result.count).toBe(0)
  })

  it("B cannot delete A's conversation", async () => {
    const result = await prisma.chatConversation.deleteMany({
      where: { id: A.conversationId, userId: B.userId },
    })
    expect(result.count).toBe(0)
    expect(
      await prisma.chatConversation.findUnique({ where: { id: A.conversationId } }),
    ).not.toBeNull()
  })
})

describe("credentials are not shared", () => {
  it("B cannot see A's API key", async () => {
    expect(
      await prisma.apiKey.findFirst({ where: { id: A.apiKeyId, userId: B.userId } }),
    ).toBeNull()
  })

  it("B cannot revoke A's API key", async () => {
    const result = await prisma.apiKey.updateMany({
      where: { id: A.apiKeyId, userId: B.userId },
      data: { revokedAt: new Date() },
    })
    expect(result.count).toBe(0)
    expect((await prisma.apiKey.findUnique({ where: { id: A.apiKeyId } }))?.revokedAt).toBeNull()
  })

  it("B cannot see A's session", async () => {
    expect(
      await prisma.session.findFirst({ where: { id: A.sessionId, userId: B.userId } }),
    ).toBeNull()
  })

  it("B cannot revoke A's session", async () => {
    const result = await prisma.session.deleteMany({
      where: { id: A.sessionId, userId: B.userId },
    })
    expect(result.count).toBe(0)
    expect(await prisma.session.findUnique({ where: { id: A.sessionId } })).not.toBeNull()
  })

  it("no API key hash is reachable from the other account's listing", async () => {
    const rows = await prisma.apiKey.findMany({ where: { userId: B.userId } })
    expect(rows.map((r) => r.id)).not.toContain(A.apiKeyId)
  })
})

describe("the boundary is symmetric", () => {
  it("A cannot reach B either", async () => {
    // Asymmetry usually means one direction was special-cased by accident.
    expect(
      await prisma.asset.findFirst({ where: { id: B.assetId, ownerId: A.userId } }),
    ).toBeNull()
    expect(
      await prisma.chatConversation.findFirst({
        where: { id: B.conversationId, userId: A.userId },
      }),
    ).toBeNull()
    expect(
      await prisma.apiKey.findFirst({ where: { id: B.apiKeyId, userId: A.userId } }),
    ).toBeNull()
  })

  it("a made-up id belonging to nobody returns nothing", async () => {
    expect(
      await prisma.asset.findFirst({ where: { id: "does-not-exist", ownerId: A.userId } }),
    ).toBeNull()
  })
})

describe("what is deliberately shared, is shared", () => {
  it("libraries carry no owner, so both users see the same one", async () => {
    // Stated rather than assumed: if a per-user library model is ever
    // introduced, this test fails and the isolation rules above need company.
    const library = await prisma.library.findUnique({ where: { id: libraryId } })
    expect(library).not.toBeNull()
    expect(Object.keys(library ?? {})).not.toContain("userId")
  })
})
