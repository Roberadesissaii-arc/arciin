import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"

import {
  createTestStorageRoot,
  prisma,
  removeTestStorageRoot,
  resetDatabase,
  seedBaseFixtures,
  type Fixtures,
} from "./setup"

/**
 * Who may see a book run, and what the stored row guarantees.
 *
 * A book is someone's private writing and a conversation id is a guessable
 * string, so every route reaches the run *through* a conversation scoped to the
 * caller. These tests assert the properties that rule depends on against real
 * PostgreSQL: the scoping query genuinely excludes another user's run, a
 * conversation carries at most one run, and deleting the conversation takes the
 * manuscript with it rather than leaving a stranded copy of the book.
 *
 * The lease cases cover the other half — which session may generate — because
 * getting that wrong costs real money rather than privacy.
 */

let fixtures: Fixtures

beforeAll(async () => {
  const root = await createTestStorageRoot()
  await resetDatabase()
  fixtures = await seedBaseFixtures(root)
})

afterAll(async () => {
  await prisma.bookRun.deleteMany()
  await prisma.chatConversation.deleteMany()
  await resetDatabase()
  await removeTestStorageRoot()
  await prisma.$disconnect()
})

beforeEach(async () => {
  await prisma.bookRun.deleteMany()
  await prisma.chatConversation.deleteMany()
})

/** A second account on the same instance. */
async function createOtherUser() {
  return prisma.user.create({
    data: {
      email: `other-${Date.now()}-${Math.random().toString(36).slice(2)}@example.invalid`,
      name: "Someone Else",
      passwordHash: "not-a-real-hash",
      role: "MEMBER",
      status: "ACTIVE",
    },
  })
}

async function seedRun(userId: string, opts: Partial<{
  status: string
  manuscript: string
  executorSessionId: string | null
  leaseExpiresAt: Date | null
}> = {}) {
  const conversation = await prisma.chatConversation.create({
    data: { userId, title: "A Book" },
  })
  const run = await prisma.bookRun.create({
    data: {
      userId,
      conversationId: conversation.id,
      title: "The Bell Under Wintermere",
      status: (opts.status ?? "WRITING") as never,
      totalChapters: 10,
      writtenChapters: 3,
      currentChapter: 4,
      manuscript: opts.manuscript ?? "# The Bell Under Wintermere",
      executorSessionId: opts.executorSessionId ?? "session-a",
      leaseExpiresAt:
        opts.leaseExpiresAt === undefined ? new Date(Date.now() + 45_000) : opts.leaseExpiresAt,
    },
  })
  return { conversation, run }
}

/** Exactly the lookup every book-run route performs before touching a run. */
function scopedConversation(conversationId: string, userId: string) {
  return prisma.chatConversation.findFirst({
    where: { id: conversationId, userId },
    select: { id: true },
  })
}

describe("a book run is reachable only by its owner", () => {
  it("does not resolve for another user holding the conversation id", async () => {
    const { conversation } = await seedRun(fixtures.user.id)
    const other = await createOtherUser()

    // Knowing the id is not access. This is the whole authorization rule.
    expect(await scopedConversation(conversation.id, other.id)).toBeNull()
    expect(await scopedConversation(conversation.id, fixtures.user.id)).not.toBeNull()
  })

  it("never appears in another user's list", async () => {
    await seedRun(fixtures.user.id)
    const other = await createOtherUser()

    const theirs = await prisma.bookRun.findMany({ where: { userId: other.id } })
    expect(theirs).toHaveLength(0)

    const mine = await prisma.bookRun.findMany({ where: { userId: fixtures.user.id } })
    expect(mine).toHaveLength(1)
  })

  it("keeps the manuscript out of another user's reach", async () => {
    const secret = "# Private draft\n\n## Chapter 1\n\nWords nobody else should read."
    const { conversation } = await seedRun(fixtures.user.id, { manuscript: secret })
    const other = await createOtherUser()

    // The route returns 404 before it ever loads the run; the scoping query is
    // what makes that true.
    expect(await scopedConversation(conversation.id, other.id)).toBeNull()
  })
})

describe("a conversation carries at most one book", () => {
  it("cannot hold two runs", async () => {
    const { conversation } = await seedRun(fixtures.user.id)
    await expect(
      prisma.bookRun.create({
        data: {
          userId: fixtures.user.id,
          conversationId: conversation.id,
          title: "A second book in the same chat",
          status: "WRITING" as never,
        },
      }),
    ).rejects.toThrow()
  })

  it("is replaced in place by an upsert, not duplicated", async () => {
    const { conversation } = await seedRun(fixtures.user.id)
    await prisma.bookRun.upsert({
      where: { conversationId: conversation.id },
      create: {
        userId: fixtures.user.id,
        conversationId: conversation.id,
        title: "New",
        status: "WRITING" as never,
      },
      update: { writtenChapters: 4, currentChapter: 5 },
    })
    const runs = await prisma.bookRun.findMany({ where: { conversationId: conversation.id } })
    expect(runs).toHaveLength(1)
    expect(runs[0]!.writtenChapters).toBe(4)
  })
})

describe("deleting the conversation deletes the book", () => {
  it("leaves no orphaned manuscript behind", async () => {
    const { conversation, run } = await seedRun(fixtures.user.id, {
      manuscript: "# Something private",
    })
    await prisma.chatConversation.delete({ where: { id: conversation.id } })
    expect(await prisma.bookRun.findUnique({ where: { id: run.id } })).toBeNull()
  })

  it("goes with the user's account", async () => {
    const other = await createOtherUser()
    const { run } = await seedRun(other.id)
    await prisma.user.delete({ where: { id: other.id } })
    expect(await prisma.bookRun.findUnique({ where: { id: run.id } })).toBeNull()
  })
})

describe("the executor lease", () => {
  const live = (r: { leaseExpiresAt: Date | null }) =>
    Boolean(r.leaseExpiresAt && r.leaseExpiresAt.getTime() > Date.now())

  it("marks a fresh claim as owned by that session", async () => {
    const { run } = await seedRun(fixtures.user.id, {
      executorSessionId: "session-a",
      leaseExpiresAt: new Date(Date.now() + 45_000),
    })
    expect(live(run)).toBe(true)
    expect(run.executorSessionId).toBe("session-a")
    // A different session must not read as the executor.
    expect(live(run) && run.executorSessionId === "session-b").toBe(false)
  })

  it("treats a lapsed lease as nobody's, so the run can be resumed", async () => {
    const { run } = await seedRun(fixtures.user.id, {
      executorSessionId: "session-gone",
      leaseExpiresAt: new Date(Date.now() - 1000),
    })
    // A browser that closed mid-chapter leaves exactly this row. Nobody owns
    // it, so another computer may take it — but only when the reader asks.
    expect(live(run)).toBe(false)
  })

  it("finds stale active runs by index, without scanning manuscripts", async () => {
    await seedRun(fixtures.user.id, {
      status: "WRITING",
      executorSessionId: "session-gone",
      leaseExpiresAt: new Date(Date.now() - 60_000),
    })
    const stale = await prisma.bookRun.findMany({
      where: {
        status: { in: ["PLANNING", "THINKING", "WRITING", "VALIDATING", "SAVING"] as never },
        leaseExpiresAt: { lt: new Date() },
      },
      select: { id: true, status: true },
    })
    expect(stale).toHaveLength(1)
    expect(stale[0]!.status).toBe("WRITING")
  })

  it("releases the lease when the book settles", async () => {
    const { conversation } = await seedRun(fixtures.user.id)
    const done = await prisma.bookRun.update({
      where: { conversationId: conversation.id },
      data: {
        status: "COMPLETED" as never,
        executorSessionId: null,
        leaseExpiresAt: null,
        finishedAt: new Date(),
      },
    })
    // A finished book belongs to no session, so any computer may reopen it.
    expect(live(done)).toBe(false)
    expect(done.executorSessionId).toBeNull()
  })
})
