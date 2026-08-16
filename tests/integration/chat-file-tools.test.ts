import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"

import {
  ARCIIN_CHAT_TOOLS,
  executeArciinChatTool,
} from "../../apps/api/src/services/chat/arciin-chat-tools"
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
 * The tools the assistant actually receives, executed the way it calls them.
 *
 * The bug this suite exists for was not in the move code — that route had
 * worked for the web UI all along. It was that the chat agent was never given
 * a tool to reach it, so it created folders and then told people to drag the
 * files themselves. A test that calls the service directly would have passed
 * throughout. These go through `executeArciinChatTool` with the same argument
 * shapes a model produces, which is the layer that was missing.
 */

let fixtures: Fixtures

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
  await prisma.asset.deleteMany()
  await prisma.folder.deleteMany()
  await prisma.activityEvent.deleteMany()
})

function callTool(name: string, args: Record<string, unknown>, access?: "full" | "sandbox" | "vision_only") {
  return executeArciinChatTool(
    { function: { name, arguments: args } },
    {
      prisma,
      storageRoot: null,
      baseUrl: "http://127.0.0.1:1",
      model: "test",
      userId: fixtures.user.id,
      ...(access ? { libraryToolAccess: access } : {}),
    },
  )
}

describe("the tool registry", () => {
  it("offers the assistant a move tool at all", () => {
    // The whole defect in one assertion.
    const names = ARCIIN_CHAT_TOOLS.map((t) => t.function.name)
    expect(names).toContain("move_library_files")
    expect(names).toContain("list_library_files")
  })

  it("describes moving as something it does, not something the user must do", () => {
    const move = ARCIIN_CHAT_TOOLS.find((t) => t.function.name === "move_library_files")
    expect(move?.function.description).toMatch(/actually move/i)
    // Structured input, never a free-form path command.
    const props = move?.function.parameters.properties as Record<string, unknown>
    expect(props).toHaveProperty("moves")
    expect(JSON.stringify(move?.function.parameters)).toMatch(/asset_id/)
    expect(JSON.stringify(move?.function.parameters)).toMatch(/destination_folder_id/)
  })
})

describe("list_library_files", () => {
  it("pages through a library larger than one page and returns every file exactly once", async () => {
    // The reported symptom: "you have 246 documents, but I only have titles for
    // about 80". The snapshot is capped; this tool must not be.
    const TOTAL = 246
    for (let i = 0; i < TOTAL; i += 1) {
      await createAsset(fixtures, {
        librarySlug: "documents",
        originalFilename: `Book ${String(i).padStart(3, "0")}.pdf`,
        mediaType: "DOCUMENT",
      })
    }

    const seen: string[] = []
    let cursor: string | undefined
    let pages = 0
    let reportedTotal = 0

    for (let guard = 0; guard < 50; guard += 1) {
      const page = (await callTool("list_library_files", {
        library_slug: "documents",
        limit: 100,
        ...(cursor ? { cursor } : {}),
      })) as {
        total: number
        has_more: boolean
        next_cursor: string | null
        items: { asset_id: string }[]
      }
      pages += 1
      reportedTotal = page.total
      seen.push(...page.items.map((i) => i.asset_id))
      if (!page.has_more) break
      cursor = page.next_cursor ?? undefined
    }

    expect(reportedTotal).toBe(TOTAL)
    expect(pages).toBeGreaterThan(1)
    expect(seen).toHaveLength(TOTAL)
    expect(new Set(seen).size).toBe(TOTAL)
  })

  it("says when there is more to fetch, and stops saying so at the end", async () => {
    for (let i = 0; i < 5; i += 1) {
      await createAsset(fixtures, {
        librarySlug: "documents",
        originalFilename: `Small ${i}.pdf`,
        mediaType: "DOCUMENT",
      })
    }
    const first = (await callTool("list_library_files", {
      library_slug: "documents",
      limit: 2,
    })) as { has_more: boolean; next_cursor: string | null }
    expect(first.has_more).toBe(true)
    expect(first.next_cursor).toBeTruthy()

    const all = (await callTool("list_library_files", {
      library_slug: "documents",
      limit: 100,
    })) as { has_more: boolean; next_cursor: string | null }
    expect(all.has_more).toBe(false)
    expect(all.next_cursor).toBeNull()
  })

  it("flags zero-byte files rather than passing them off as normal books", async () => {
    await createAsset(fixtures, {
      librarySlug: "documents",
      originalFilename: "The Love Hypothesis.pdf",
      mediaType: "DOCUMENT",
      sizeBytes: 0,
    })
    await createAsset(fixtures, {
      librarySlug: "documents",
      originalFilename: "Real Book.pdf",
      mediaType: "DOCUMENT",
      sizeBytes: 4096,
    })

    const page = (await callTool("list_library_files", { library_slug: "documents" })) as {
      items: { filename: string; is_empty: boolean; size_bytes: number }[]
    }
    const empty = page.items.find((i) => i.filename === "The Love Hypothesis.pdf")
    const real = page.items.find((i) => i.filename === "Real Book.pdf")
    expect(empty?.is_empty).toBe(true)
    expect(real?.is_empty).toBe(false)
  })

  it("lists only what is in a folder when one is named", async () => {
    const fiction = await createFolder(fixtures, { librarySlug: "documents", name: "Fiction" })
    await createAsset(fixtures, {
      librarySlug: "documents",
      folderId: fiction.id,
      originalFilename: "Inside.pdf",
      mediaType: "DOCUMENT",
    })
    await createAsset(fixtures, {
      librarySlug: "documents",
      originalFilename: "Outside.pdf",
      mediaType: "DOCUMENT",
    })

    const page = (await callTool("list_library_files", {
      library_slug: "documents",
      folder_id: fiction.id,
    })) as { items: { filename: string }[]; total: number }
    expect(page.items.map((i) => i.filename)).toEqual(["Inside.pdf"])
    expect(page.total).toBe(1)
  })

  it("does not expose the contents of a locked folder", async () => {
    const locked = await createFolder(fixtures, {
      librarySlug: "documents",
      name: "Private",
      lockedAt: new Date(),
    })
    await createAsset(fixtures, {
      librarySlug: "documents",
      folderId: locked.id,
      originalFilename: "Secret.pdf",
      mediaType: "DOCUMENT",
    })

    const direct = (await callTool("list_library_files", {
      library_slug: "documents",
      folder_id: locked.id,
    })) as { error?: string }
    expect(direct.error).toBe("folder_locked")

    // Nor by listing the whole library and hoping it slips through.
    const whole = (await callTool("list_library_files", { library_slug: "documents" })) as {
      items: { filename: string }[]
    }
    expect(whole.items.map((i) => i.filename)).not.toContain("Secret.pdf")
  })

  it("reports an unknown library instead of returning nothing", async () => {
    const res = (await callTool("list_library_files", { library_slug: "nope" })) as {
      error?: string
    }
    expect(res.error).toBe("library_not_found")
  })
})

describe("move_library_files, called as the model calls it", () => {
  it("moves files and they are really in the folder afterwards", async () => {
    const fiction = await createFolder(fixtures, { librarySlug: "documents", name: "Fiction" })
    const a = await createAsset(fixtures, {
      librarySlug: "documents",
      originalFilename: "Novel A.pdf",
      mediaType: "DOCUMENT",
    })
    const b = await createAsset(fixtures, {
      librarySlug: "documents",
      originalFilename: "Novel B.pdf",
      mediaType: "DOCUMENT",
    })

    const res = (await callTool("move_library_files", {
      moves: [
        { asset_id: a.id, destination_folder_id: fiction.id },
        { asset_id: b.id, destination_folder_id: fiction.id },
      ],
    })) as { success: boolean; moved: number; failed: number; operation_id: string }

    expect(res.success).toBe(true)
    expect(res.moved).toBe(2)
    expect(res.failed).toBe(0)
    expect(res.operation_id).toMatch(/^mv_/)

    // Verified by re-listing, which is what the workflow asks the model to do.
    const listed = (await callTool("list_library_files", {
      library_slug: "documents",
      folder_id: fiction.id,
    })) as { items: { filename: string }[] }
    expect(listed.items.map((i) => i.filename).sort()).toEqual(["Novel A.pdf", "Novel B.pdf"])
  })

  it("accepts camelCase arguments too, because models produce both", async () => {
    const fiction = await createFolder(fixtures, { librarySlug: "documents", name: "Fiction" })
    const asset = await createAsset(fixtures, {
      librarySlug: "documents",
      originalFilename: "Either.pdf",
      mediaType: "DOCUMENT",
    })
    const res = (await callTool("move_library_files", {
      moves: [{ assetId: asset.id, destinationFolderId: fiction.id }],
    })) as { moved: number }
    expect(res.moved).toBe(1)
  })

  it("returns the failures with reasons instead of one blanket error", async () => {
    const fiction = await createFolder(fixtures, { librarySlug: "documents", name: "Fiction" })
    const good = await createAsset(fixtures, {
      librarySlug: "documents",
      originalFilename: "Good.pdf",
      mediaType: "DOCUMENT",
    })

    const res = (await callTool("move_library_files", {
      moves: [
        { asset_id: good.id, destination_folder_id: fiction.id },
        { asset_id: "ghost", destination_folder_id: fiction.id },
      ],
    })) as {
      success: boolean
      moved: number
      failed: number
      failures: { asset_id: string; code: string; message: string }[]
    }

    expect(res.moved).toBe(1)
    expect(res.failed).toBe(1)
    expect(res.success).toBe(false)
    expect(res.failures[0]).toMatchObject({ asset_id: "ghost", code: "asset_not_found" })
    expect(res.failures[0]?.message).toBeTruthy()
  })

  it("reports a second pass as already_there so an organisation is safe to re-run", async () => {
    const fiction = await createFolder(fixtures, { librarySlug: "documents", name: "Fiction" })
    const asset = await createAsset(fixtures, {
      librarySlug: "documents",
      originalFilename: "Repeat.pdf",
      mediaType: "DOCUMENT",
    })
    const move = { moves: [{ asset_id: asset.id, destination_folder_id: fiction.id }] }

    const first = (await callTool("move_library_files", move)) as { moved: number }
    const second = (await callTool("move_library_files", move)) as {
      moved: number
      already_there: number
    }
    expect(first.moved).toBe(1)
    expect(second.moved).toBe(0)
    expect(second.already_there).toBe(1)
  })

  it("surfaces a name collision without losing either file", async () => {
    const fiction = await createFolder(fixtures, { librarySlug: "documents", name: "Fiction" })
    await createAsset(fixtures, {
      librarySlug: "documents",
      folderId: fiction.id,
      originalFilename: "The Atlantis World.pdf",
      mediaType: "DOCUMENT",
    })
    const twin = await createAsset(fixtures, {
      librarySlug: "documents",
      originalFilename: "The Atlantis World.pdf",
      mediaType: "DOCUMENT",
    })

    const res = (await callTool("move_library_files", {
      moves: [{ asset_id: twin.id, destination_folder_id: fiction.id }],
    })) as { moved: number; name_collisions: { filename: string }[] }

    expect(res.moved).toBe(1)
    expect(res.name_collisions).toHaveLength(1)
    const listed = (await callTool("list_library_files", {
      library_slug: "documents",
      folder_id: fiction.id,
    })) as { total: number }
    expect(listed.total).toBe(2)
  })

  it("refuses a batch over the cap and says how to proceed", async () => {
    const fiction = await createFolder(fixtures, { librarySlug: "documents", name: "Fiction" })
    const res = (await callTool("move_library_files", {
      moves: Array.from({ length: 251 }, (_, i) => ({
        asset_id: `x${i}`,
        destination_folder_id: fiction.id,
      })),
    })) as { error: string; max_per_call: number }
    expect(res.error).toBe("too_many")
    expect(res.max_per_call).toBe(250)
  })

  it("validates rather than guessing when a move has no file id", async () => {
    const fiction = await createFolder(fixtures, { librarySlug: "documents", name: "Fiction" })
    const res = (await callTool("move_library_files", {
      moves: [{ destination_folder_id: fiction.id }],
    })) as { error: string }
    expect(res.error).toBe("validation")
  })
})

describe("permission enforcement at the tool boundary", () => {
  it("refuses to move anything when library tools are sandboxed", async () => {
    const fiction = await createFolder(fixtures, { librarySlug: "documents", name: "Fiction" })
    const asset = await createAsset(fixtures, {
      librarySlug: "documents",
      originalFilename: "Sandboxed.pdf",
      mediaType: "DOCUMENT",
    })

    const res = (await callTool(
      "move_library_files",
      { moves: [{ asset_id: asset.id, destination_folder_id: fiction.id }] },
      "sandbox",
    )) as { error: string; message: string }

    expect(res.error).toBe("forbidden")
    expect(res.message).toMatch(/AI Security/i)

    // And the file genuinely did not move.
    const row = await prisma.asset.findUnique({ where: { id: asset.id } })
    expect(row?.folderId).toBeNull()
  })

  it("refuses in vision-only mode too", async () => {
    const fiction = await createFolder(fixtures, { librarySlug: "documents", name: "Fiction" })
    const asset = await createAsset(fixtures, {
      librarySlug: "documents",
      originalFilename: "ReadOnly.pdf",
      mediaType: "DOCUMENT",
    })
    const res = (await callTool(
      "move_library_files",
      { moves: [{ asset_id: asset.id, destination_folder_id: fiction.id }] },
      "vision_only",
    )) as { error: string }
    expect(res.error).toBe("forbidden")
    const row = await prisma.asset.findUnique({ where: { id: asset.id } })
    expect(row?.folderId).toBeNull()
  })
})

describe("a whole organisation run, through the tools only", () => {
  it("lists everything, reuses folders, moves, and verifies", async () => {
    // Ten categories already exist, as they do in the user's library.
    const categories = [
      "Fiction",
      "Sci-Fi & Fantasy",
      "Programming & Web Dev",
      "AI & Data Science",
      "Robotics & Electronics",
    ]
    const folders = new Map<string, string>()
    for (const name of categories) {
      const folder = await createFolder(fixtures, { librarySlug: "documents", name })
      folders.set(name, folder.id)
    }

    // A mixed library: books, one non-book, one empty file, one duplicate pair.
    const books: Record<string, string> = {
      "Python Crash Course.pdf": "Programming & Web Dev",
      "TensorFlow in 1 Day.pdf": "AI & Data Science",
      "ROS Robotics By Example.pdf": "Robotics & Electronics",
      "The Atlantis Gene.pdf": "Sci-Fi & Fantasy",
      "The Love Hypothesis.pdf": "Fiction",
    }
    const ids: Record<string, string> = {}
    for (const filename of Object.keys(books)) {
      const a = await createAsset(fixtures, {
        librarySlug: "documents",
        originalFilename: filename,
        mediaType: "DOCUMENT",
      })
      ids[filename] = a.id
    }
    const invoice = await createAsset(fixtures, {
      librarySlug: "documents",
      originalFilename: "Invoice 2026-04.pdf",
      mediaType: "DOCUMENT",
    })

    // 1. Enumerate everything.
    const listed = (await callTool("list_library_files", {
      library_slug: "documents",
      limit: 200,
    })) as { total: number; has_more: boolean; items: { asset_id: string; filename: string }[] }
    expect(listed.has_more).toBe(false)
    expect(listed.total).toBe(6)

    // 2. Move only the books, into the folders that already existed.
    const res = (await callTool("move_library_files", {
      moves: Object.entries(books).map(([filename, category]) => ({
        asset_id: ids[filename],
        destination_folder_id: folders.get(category),
      })),
    })) as { moved: number; failed: number }
    expect(res.moved).toBe(5)
    expect(res.failed).toBe(0)

    // 3. Verify by re-listing each destination, not by trusting the response.
    for (const [filename, category] of Object.entries(books)) {
      const contents = (await callTool("list_library_files", {
        library_slug: "documents",
        folder_id: folders.get(category),
      })) as { items: { filename: string }[] }
      expect(contents.items.map((i) => i.filename)).toContain(filename)
    }

    // 4. The non-book was left exactly where it was.
    const stillLoose = await prisma.asset.findUnique({ where: { id: invoice.id } })
    expect(stillLoose?.folderId).toBeNull()

    // 5. No duplicate folders were created along the way.
    const folderRows = await prisma.folder.findMany({ where: { deletedAt: null } })
    expect(folderRows).toHaveLength(categories.length)
  })
})

describe("find_library_file — recovering a canonical id", () => {
  it("returns the id for a unique exact name", async () => {
    const asset = await createAsset(fixtures, {
      librarySlug: "documents",
      originalFilename: "Chess For Dummies (James Eade).pdf",
      mediaType: "DOCUMENT",
      sizeBytes: 12_671_000,
    })
    const res = (await callTool("find_library_file", {
      name: "Chess For Dummies (James Eade).pdf",
    })) as {
      matching_count: number
      unique: boolean
      items: { asset_id: string; size_bytes: number; folder: string | null }[]
    }
    expect(res.matching_count).toBe(1)
    expect(res.unique).toBe(true)
    expect(res.items[0]?.asset_id).toBe(asset.id)
    expect(res.items[0]?.size_bytes).toBe(12_671_000)
  })

  it("reports ambiguity rather than picking one", async () => {
    for (let i = 0; i < 2; i += 1) {
      await createAsset(fixtures, {
        librarySlug: "documents",
        originalFilename: "The Atlantis World.pdf",
        mediaType: "DOCUMENT",
      })
    }
    const res = (await callTool("find_library_file", { name: "The Atlantis World.pdf" })) as {
      matching_count: number
      unique: boolean
    }
    expect(res.matching_count).toBe(2)
    expect(res.unique).toBe(false)
  })

  it("gives the current folder, so a caller can disambiguate on metadata", async () => {
    const fiction = await createFolder(fixtures, { librarySlug: "documents", name: "Fiction" })
    await createAsset(fixtures, {
      librarySlug: "documents",
      folderId: fiction.id,
      originalFilename: "Placed.pdf",
      mediaType: "DOCUMENT",
    })
    const res = (await callTool("find_library_file", { name: "Placed.pdf" })) as {
      items: { folder: string | null; folder_id: string | null }[]
    }
    expect(res.items[0]?.folder).toBe("Fiction")
    expect(res.items[0]?.folder_id).toBe(fiction.id)
  })

  it("finds nothing for a name that does not exist", async () => {
    const res = (await callTool("find_library_file", { name: "Nothing At All.pdf" })) as {
      matching_count: number
      items: unknown[]
    }
    expect(res.matching_count).toBe(0)
    expect(res.items).toEqual([])
  })

  it("requires a name", async () => {
    const res = (await callTool("find_library_file", {})) as { error: string }
    expect(res.error).toBe("validation")
  })
})

describe("move recovery through the tool", () => {
  it("completes the move when the model mistyped the id but gave the filename", async () => {
    const games = await createFolder(fixtures, { librarySlug: "documents", name: "Games & Hobbies" })
    const asset = await createAsset(fixtures, {
      librarySlug: "documents",
      originalFilename: "Chess For Dummies.pdf",
      mediaType: "DOCUMENT",
    })
    const typo = `${asset.id.slice(0, 10)}9${asset.id.slice(10)}`

    const res = (await callTool("move_library_files", {
      moves: [
        {
          asset_id: typo,
          destination_folder_id: games.id,
          filename: "Chess For Dummies.pdf",
        },
      ],
    })) as { moved: number; failed: number; recovered_by_name: number }

    expect(res.moved).toBe(1)
    expect(res.failed).toBe(0)
    expect(res.recovered_by_name).toBe(1)

    const listed = (await callTool("list_library_files", {
      library_slug: "documents",
      folder_id: games.id,
    })) as { items: { filename: string }[] }
    expect(listed.items.map((i) => i.filename)).toEqual(["Chess For Dummies.pdf"])
  })

  it("leaves an ambiguous name for review instead of moving a coin-flip", async () => {
    const fiction = await createFolder(fixtures, { librarySlug: "documents", name: "Fiction" })
    for (let i = 0; i < 2; i += 1) {
      await createAsset(fixtures, {
        librarySlug: "documents",
        originalFilename: "Twin.pdf",
        mediaType: "DOCUMENT",
      })
    }
    const res = (await callTool("move_library_files", {
      moves: [{ asset_id: "not-real", destination_folder_id: fiction.id, filename: "Twin.pdf" }],
    })) as { moved: number; failed: number; failures: { code: string }[] }

    expect(res.moved).toBe(0)
    expect(res.failures[0]?.code).toBe("ambiguous_name")
    const listed = (await callTool("list_library_files", {
      library_slug: "documents",
      folder_id: fiction.id,
    })) as { total: number }
    expect(listed.total).toBe(0)
  })
})

describe("argument-name variants a model actually produces", () => {
  it("accepts target_folder_id as the destination", async () => {
    // A real turn sent this. Read as "no destination" it would have moved the
    // file to the library root — the exact opposite of the request.
    const games = await createFolder(fixtures, { librarySlug: "documents", name: "Games & Hobbies" })
    const asset = await createAsset(fixtures, {
      librarySlug: "documents",
      originalFilename: "Chess For Dummies.pdf",
      mediaType: "DOCUMENT",
    })
    const res = (await callTool("move_library_files", {
      moves: [{ asset_id: asset.id, target_folder_id: games.id, filename: "Chess For Dummies.pdf" }],
    })) as { moved: number }
    expect(res.moved).toBe(1)
    const row = await prisma.asset.findUnique({ where: { id: asset.id } })
    expect(row?.folderId).toBe(games.id)
  })

  it("still treats an explicitly absent destination as the library root", async () => {
    const fiction = await createFolder(fixtures, { librarySlug: "documents", name: "Fiction" })
    const asset = await createAsset(fixtures, {
      librarySlug: "documents",
      folderId: fiction.id,
      originalFilename: "Homeward.pdf",
      mediaType: "DOCUMENT",
    })
    const res = (await callTool("move_library_files", {
      moves: [{ asset_id: asset.id, destination_folder_id: null }],
    })) as { moved: number }
    expect(res.moved).toBe(1)
    const row = await prisma.asset.findUnique({ where: { id: asset.id } })
    expect(row?.folderId).toBeNull()
  })
})
