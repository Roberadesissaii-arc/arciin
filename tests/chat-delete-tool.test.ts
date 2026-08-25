import { readFileSync } from "node:fs"
import path from "node:path"

import { describe, expect, it, vi } from "vitest"

import {
  libraryAllowsDeletion,
  libraryAllowsFolderMutations,
  libraryAllowsOrganize,
} from "@arciin/config"

import {
  deleteLibraryAssets,
  MAX_DELETES_PER_BATCH,
} from "../apps/api/src/services/assets/delete-library-assets"

/**
 * The assistant can now finish a clean-up it proposed.
 *
 * It could already prove two PDFs were the same book — page counts, chapter
 * maps, opening prose — and then had to answer "I don't have a tool to delete
 * files". These cover the tool that closes that gap, and above all the guard
 * that makes it safe to hand to a model: an id and a filename that disagree
 * delete nothing.
 */

type AssetRow = {
  id: string
  originalFilename: string
  libraryId: string
  deletedAt: Date | null
}

/** Minimal Prisma stand-in — these tests are about the decision, not the driver. */
function fakePrisma(rows: AssetRow[]) {
  const updated: { id: string; data: Record<string, unknown> }[] = []
  return {
    updated,
    rows,
    client: {
      asset: {
        findFirst: async ({ where }: { where: { id: string } }) =>
          rows.find((r) => r.id === where.id) ?? null,
        update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          updated.push({ id: where.id, data })
          const row = rows.find((r) => r.id === where.id)
          if (row) row.deletedAt = data.deletedAt as Date
          return row
        },
        updateMany: async () => ({ count: 0 }),
      },
      assetPlexMirror: { deleteMany: async () => ({ count: 0 }) },
    } as never,
  }
}

const ATLANTIS: AssetRow[] = [
  {
    id: "cmssdj39j01l8totrs6nrl3qy",
    originalFilename: "The Atlantis World (A.G. Riddle) (z-lib.org).pdf",
    libraryId: "lib-docs",
    deletedAt: null,
  },
  {
    id: "cmssdj2s801l0totreu0e14n9",
    originalFilename: "The Atlantis World (A.G. Riddle) (z-lib.org) (1).pdf",
    libraryId: "lib-docs",
    deletedAt: null,
  },
  {
    id: "cmssdj3s201litotr1snzphtn",
    originalFilename: "The Atlantis World (The Origin Mystery, Book 3) (Riddle, A.G.) (z-lib.org).pdf",
    libraryId: "lib-docs",
    deletedAt: null,
  },
]

function freshLibrary(): AssetRow[] {
  return ATLANTIS.map((a) => ({ ...a }))
}

describe("deleting the duplicates the assistant identified", () => {
  it("sends the named files to Trash", async () => {
    const rows = freshLibrary()
    const db = fakePrisma(rows)

    const result = await deleteLibraryAssets({
      prisma: db.client,
      userId: "user-1",
      items: [
        { assetId: rows[0].id, filename: rows[0].originalFilename },
        { assetId: rows[1].id, filename: rows[1].originalFilename },
      ],
    })

    expect(result.deleted).toBe(2)
    expect(result.failed).toBe(0)
    expect(result.results.map((r) => r.filename)).toContain(
      "The Atlantis World (A.G. Riddle) (z-lib.org).pdf",
    )
  })

  it("keeps the copy that was not named", async () => {
    const rows = freshLibrary()
    const db = fakePrisma(rows)

    await deleteLibraryAssets({
      prisma: db.client,
      userId: "user-1",
      items: [{ assetId: rows[0].id, filename: rows[0].originalFilename }],
    })

    expect(rows[2].deletedAt).toBeNull()
    expect(db.updated.map((u) => u.id)).toEqual([rows[0].id])
  })

  it("soft-deletes rather than erasing — Trash keeps it for the retention window", async () => {
    const rows = freshLibrary()
    const db = fakePrisma(rows)

    await deleteLibraryAssets({
      prisma: db.client,
      userId: "user-1",
      items: [{ assetId: rows[0].id, filename: rows[0].originalFilename }],
    })

    expect(db.updated[0]!.data.status).toBe("DELETED")
    expect(db.updated[0]!.data.deletedAt).toBeInstanceOf(Date)
    expect(db.updated[0]!.data.libraryMirrorPath).toBeNull()
  })

  it("reports the restore window back to the model", async () => {
    const rows = freshLibrary()
    const result = await deleteLibraryAssets({
      prisma: fakePrisma(rows).client,
      userId: "user-1",
      items: [{ assetId: rows[0].id, filename: rows[0].originalFilename }],
    })
    expect(result.retentionDays).toBeGreaterThan(0)
  })

  it("records activity and broadcasts, so the UI updates like a manual delete", async () => {
    const rows = freshLibrary()
    const onDeleted = vi.fn(async () => undefined)
    const clearMirrors = vi.fn(async () => undefined)

    await deleteLibraryAssets({
      prisma: fakePrisma(rows).client,
      userId: "user-1",
      items: [{ assetId: rows[0].id, filename: rows[0].originalFilename }],
      onDeleted,
      clearMirrors,
    })

    expect(onDeleted).toHaveBeenCalledTimes(1)
    expect(clearMirrors).toHaveBeenCalledWith(rows[0].id)
    expect(onDeleted.mock.calls[0]![0]).toMatchObject({ filename: rows[0].originalFilename })
  })
})

describe("the guard that makes this safe to give a model", () => {
  it("deletes nothing when the id and the filename disagree", async () => {
    const rows = freshLibrary()
    const db = fakePrisma(rows)

    const result = await deleteLibraryAssets({
      prisma: db.client,
      userId: "user-1",
      // The id of the copy being KEPT, carrying the name of one being removed.
      items: [{ assetId: rows[2].id, filename: rows[0].originalFilename }],
    })

    expect(result.deleted).toBe(0)
    expect(result.failed).toBe(1)
    expect(result.results[0]!.code).toBe("name_mismatch")
    expect(result.results[0]!.actualFilename).toBe(rows[2].originalFilename)
    expect(db.updated).toHaveLength(0)
    expect(rows.every((r) => r.deletedAt === null)).toBe(true)
  })

  it("announces nothing for a file it refused to delete", async () => {
    const rows = freshLibrary()
    const onDeleted = vi.fn(async () => undefined)
    await deleteLibraryAssets({
      prisma: fakePrisma(rows).client,
      userId: "user-1",
      items: [{ assetId: rows[2].id, filename: rows[0].originalFilename }],
      onDeleted,
    })
    expect(onDeleted).not.toHaveBeenCalled()
  })

  it("does not stop the whole batch when one file mismatches", async () => {
    const rows = freshLibrary()
    const db = fakePrisma(rows)

    const result = await deleteLibraryAssets({
      prisma: db.client,
      userId: "user-1",
      items: [
        { assetId: rows[0].id, filename: rows[0].originalFilename },
        { assetId: rows[1].id, filename: "Something Else Entirely.pdf" },
      ],
    })

    expect(result.deleted).toBe(1)
    expect(result.failed).toBe(1)
    expect(rows[1].deletedAt).toBeNull()
  })

  it("tolerates case and stray whitespace in the filename", async () => {
    const rows = freshLibrary()
    const result = await deleteLibraryAssets({
      prisma: fakePrisma(rows).client,
      userId: "user-1",
      items: [{ assetId: rows[0].id, filename: `  ${rows[0].originalFilename.toUpperCase()} ` }],
    })
    expect(result.deleted).toBe(1)
  })

  it("reports a hallucinated id instead of deleting something else", async () => {
    const rows = freshLibrary()
    const db = fakePrisma(rows)
    const result = await deleteLibraryAssets({
      prisma: db.client,
      userId: "user-1",
      items: [{ assetId: "cmnotarealid0000000000000", filename: rows[0].originalFilename }],
    })

    expect(result.results[0]!.code).toBe("asset_not_found")
    expect(db.updated).toHaveLength(0)
  })

  it("refuses a file that is already in Trash rather than double-counting it", async () => {
    const rows = freshLibrary()
    rows[0].deletedAt = new Date()
    const result = await deleteLibraryAssets({
      prisma: fakePrisma(rows).client,
      userId: "user-1",
      items: [{ assetId: rows[0].id, filename: rows[0].originalFilename }],
    })
    expect(result.deleted).toBe(0)
    expect(result.results[0]!.code).toBe("already_deleted")
  })

  it("caps a batch well below the move cap", () => {
    expect(MAX_DELETES_PER_BATCH).toBe(50)
  })
})

describe("who is allowed to delete", () => {
  it("only full access", () => {
    expect(libraryAllowsDeletion("full")).toBe(true)
    expect(libraryAllowsDeletion("sandbox")).toBe(false)
    expect(libraryAllowsDeletion("vision_only")).toBe(false)
  })

  it("is stricter than folder mutations, which sandbox does allow", () => {
    expect(libraryAllowsFolderMutations("sandbox")).toBe(true)
    expect(libraryAllowsDeletion("sandbox")).toBe(false)
  })

  it("matches the organize gate — both are power over the user's files", () => {
    for (const level of ["full", "sandbox", "vision_only"] as const) {
      expect(libraryAllowsDeletion(level)).toBe(libraryAllowsOrganize(level))
    }
  })
})

/**
 * A tool the model is never offered may as well not exist, and one offered on
 * the wrong turn is worse than missing. These read the wiring itself.
 */
const ROOT = path.resolve(__dirname, "..")
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8")

describe("the tool is actually reachable", () => {
  const tools = read("apps/api/src/services/chat/arciin-chat-tools.ts")

  it("is registered in the chat tool set", () => {
    expect(tools).toContain('name: "delete_library_files"')
  })

  it("demands the filename alongside the id, so the pair can be checked", () => {
    const definition = tools.slice(tools.indexOf('name: "delete_library_files"'))
    expect(definition).toContain('required: ["asset_id", "filename"]')
  })

  it("tells the model plainly that it can delete", () => {
    const definition = tools.slice(
      tools.indexOf('name: "delete_library_files"'),
      tools.indexOf('name: "delete_library_files"') + 1600,
    )
    expect(definition).toMatch(/performs the deletion/i)
    expect(definition).toMatch(/confirm with the user first/i)
  })
})

describe("the turns where it must not be offered", () => {
  it("is withheld in sandbox mode", () => {
    expect(read("apps/api/src/services/chat/ollama-chat-with-tools.ts")).toContain(
      't.function.name !== "delete_library_files"',
    )
  })

  it("is withheld while a canvas document is being written", () => {
    const routes = read("apps/api/src/modules/chat/routes.ts")
    const withheld = routes.slice(
      routes.indexOf("CANVAS_WITHHELD_TOOLS = new Set(["),
      routes.indexOf("CANVAS_WITHHELD_TOOLS = new Set([") + 600,
    )
    expect(withheld).toContain('"delete_library_files"')
  })
})

describe("what the assistant is told about deleting", () => {
  const instruction = read("apps/web/components/chat/chat-system-instruction.ts")

  it("names the tool", () => {
    expect(instruction).toContain("delete_library_files")
  })

  it("forbids the answer that started this", () => {
    expect(instruction).toMatch(/Never say you have no way to delete files/i)
  })

  it("requires confirming first and acting on yes", () => {
    expect(instruction).toMatch(/Propose and wait/i)
    expect(instruction).toMatch(/Act on "yes"/i)
  })

  it("promises Trash, not erasure", () => {
    expect(instruction).toMatch(/restorable for 30 days/i)
  })
})
