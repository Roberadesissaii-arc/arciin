import { expect, test } from "@playwright/test"

/**
 * The organisation workflow, asked for the way a person asks for it.
 *
 * The defect this covers was not in the move code — the API route had worked
 * for the web UI all along. It was that the assistant had no tool to reach it,
 * so it created ten folders and then told the user to drag 246 books by hand.
 * Every unit and integration test in the repo would have passed while that was
 * true, which is why this one drives the actual chat against an actual model
 * and then checks the database rather than the reply.
 *
 * The library is a metadata copy of the real one — real filenames, real
 * duplicates, a real non-book — because the hard part is classification, and
 * five invented files would prove nothing.
 */

/**
 * Opt-in. Spends real tokens against a real provider.
 */
const ORG_E2E = process.env.E2E_ORGANIZE === "1"

const REQUEST =
  "Organize all my books in Documents into appropriate categories. Use the category folders that already exist, create any you genuinely need, and move the books into them."

const RUN_TIMEOUT = 45 * 60 * 1000

type LibrarySnapshot = {
  total: number
  inFolders: number
  loose: number
  byFolder: Record<string, number>
}

test.describe("organising a real Documents library", () => {
  test.skip(!ORG_E2E, "set E2E_ORGANIZE=1 to run the real-model organisation suite")

  test.describe.configure({ mode: "serial", timeout: RUN_TIMEOUT })

  test("the assistant moves the books itself instead of telling the user to drag them", async ({
    page,
  }) => {
    const toolCalls: string[] = []
    page.on("console", (msg) => {
      const text = msg.text()
      if (/libraryAction|move_library_files|list_library_files/.test(text)) toolCalls.push(text)
    })

    /** Read the library straight from the API, not from the chat reply. */
    async function snapshot(): Promise<LibrarySnapshot> {
      const state = await page.evaluate(async () => {
        const res = await fetch("/api/chat/context", { credentials: "include" })
        const body = await res.json()
        return body.data as {
          folders: { id: string; name: string; librarySlug: string; assetCount: number }[]
          libraries: { slug: string; count: number }[]
        }
      })
      const docFolders = state.folders.filter((f) => f.librarySlug === "documents")
      const byFolder: Record<string, number> = {}
      for (const f of docFolders) byFolder[f.name] = f.assetCount
      const inFolders = docFolders.reduce((sum, f) => sum + f.assetCount, 0)
      const total = state.libraries.find((l) => l.slug === "documents")?.count ?? 0
      return { total, inFolders, loose: total - inFolders, byFolder }
    }

    await page.goto("/chat")
    const composer = page.locator("textarea").first()
    await expect(composer).toBeVisible({ timeout: 60_000 })

    const before = await snapshot()
    console.log(
      `[organize] before: ${before.total} documents, ${before.loose} loose, ${before.inFolders} already in folders`,
    )
    console.log(`[organize] existing folders: ${Object.keys(before.byFolder).join(", ")}`)
    expect(before.total, "the seeded library should hold the real document set").toBeGreaterThan(200)
    expect(before.loose, "they should start unorganised").toBeGreaterThan(200)

    await composer.click()
    await composer.fill(REQUEST)
    await page.keyboard.press("Escape")
    await composer.press("Enter")

    /**
     * Watch the library, not the transcript.
     *
     * A model that is doing the work moves rows; a model that is describing the
     * work does not. Polling the real counts is the only way to tell those two
     * apart, and it is exactly the distinction that was missed before.
     */
    let last = before
    let stableFor = 0
    const deadline = Date.now() + 35 * 60 * 1000
    for (;;) {
      await page.mouse.move(Math.round(Math.random() * 40) + 10, 12)
      await page.waitForTimeout(5000)
      const now = await snapshot()
      if (now.inFolders !== last.inFolders) {
        console.log(`[organize] filed ${now.inFolders} / ${now.total}`)
        stableFor = 0
      } else {
        stableFor += 1
      }
      last = now
      // Settled: nothing has moved for a while and the turn is over.
      const busy = await page
        .getByText(/Generating|Stop to interrupt/i)
        .first()
        .isVisible()
        .catch(() => false)
      if (!busy && stableFor >= 3 && now.inFolders > 0) break
      if (Date.now() > deadline) break
    }

    const after = last
    console.log(`[organize] after: ${after.inFolders} filed, ${after.loose} still loose`)
    for (const [name, count] of Object.entries(after.byFolder)) {
      if (count > 0) console.log(`[organize]   ${name}: ${count}`)
    }

    const reply = await page.locator("main").first().innerText()

    // The sentence that must never appear again.
    expect(reply, "the assistant must not claim it cannot move files").not.toMatch(
      /(don'?t|do not|cannot|can'?t)\s+(yet\s+)?have\s+(a\s+)?(move|file[- ]move)/i,
    )
    expect(reply, "and must not fall back to telling the user to drag files").not.toMatch(
      /drag (them|the files|these) (yourself|manually)/i,
    )

    // The actual claim: files really moved.
    expect(after.inFolders, "books should have been filed into folders").toBeGreaterThan(0)
    expect(after.inFolders).toBeGreaterThan(before.inFolders)

    // Verified independently of the chat: re-read each destination folder.
    const verified = await page.evaluate(async () => {
      const res = await fetch("/api/chat/context", { credentials: "include" })
      const body = await res.json()
      const folders = (body.data.folders as { id: string; name: string; librarySlug: string }[])
        .filter((f) => f.librarySlug === "documents")
      const out: Record<string, string[]> = {}
      for (const folder of folders) {
        const page1 = await fetch(`/api/assets?folderId=${folder.id}&limit=200`, {
          credentials: "include",
        })
        const listed = await page1.json()
        out[folder.name] = (listed.data as { originalFilename: string }[]).map(
          (a) => a.originalFilename,
        )
      }
      return out
    })

    const filedFilenames = Object.values(verified).flat()
    console.log(`[organize] verified by re-listing: ${filedFilenames.length} files in folders`)
    expect(filedFilenames.length, "post-move verification should find the files").toBe(
      after.inFolders,
    )

    // Nothing was lost: every document is either filed or still loose.
    expect(after.inFolders + after.loose).toBe(after.total)
    expect(after.total).toBe(before.total)

    // The activity trail exists and is grouped, so this is reversible.
    const events = await page.evaluate(async () => {
      const res = await fetch("/api/activity?limit=50", { credentials: "include" })
      const body = await res.json()
      return (body.data as { type: string }[]).filter((e) => e.type === "assets.moved").length
    })
    console.log(`[organize] grouped move events recorded: ${events}`)
    expect(events).toBeGreaterThan(0)

    console.log("[organize] REPLY_START\n" + reply.slice(-4000) + "\n[organize] REPLY_END")
  })
})
