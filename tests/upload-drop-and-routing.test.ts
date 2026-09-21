import { describe, expect, it } from "vitest"

import { libraryAcceptsMediaType, resolveUploadRoute } from "@arciin/shared"
import { partitionDroppedFiles } from "@/lib/uploads/collect-drop-files"

/**
 * Two ways a dropped file quietly went missing.
 *
 * Dragging an installer in did nothing at all — no upload, no error — because
 * `.exe` is on the skip list that exists to keep node_modules out of a dragged
 * project, and it was being applied to single files too. And dropping a photo
 * while the Inbox page was open left it in Inbox, because Inbox counted as a
 * library that accepts everything, which turned auto-organise off for whoever
 * happened to be standing there.
 */

function droppedFile(name: string, relativePath?: string): File {
  const file = new File(["x"], name, { type: "application/octet-stream" })
  if (relativePath) {
    Object.defineProperty(file, "webkitRelativePath", { value: relativePath })
  }
  return file
}

describe("a file dropped on its own always uploads", () => {
  it.each([
    "Arciin-Desktop-0.1.0-PRIVATE-x64-Setup.exe",
    "library.dll",
    "compiled.pyc",
    ".gitignore",
    "photo.jpg",
  ])("%s", (name) => {
    const { upload, skipped } = partitionDroppedFiles([droppedFile(name)])
    expect(upload.map((f) => f.name)).toEqual([name])
    expect(skipped).toEqual([])
  })
})

describe("the skip list still applies inside a dragged folder", () => {
  it("drops build artefacts that came along with a project", () => {
    const { upload, skipped } = partitionDroppedFiles([
      droppedFile("index.ts", "project/src/index.ts"),
      droppedFile("cache.pyc", "project/__pycache__/cache.pyc"),
      droppedFile("tool.exe", "project/bin/tool.exe"),
    ])
    expect(upload.map((f) => f.name)).toEqual(["index.ts"])
    expect(skipped.map((f) => f.name)).toEqual(["cache.pyc", "tool.exe"])
  })

  it("reports what it skipped rather than discarding it silently", () => {
    // The caller can now say so; before, the files simply vanished.
    const { skipped } = partitionDroppedFiles([
      droppedFile("a.exe", "project/bin/a.exe"),
    ])
    expect(skipped).toHaveLength(1)
  })

  it("keeps a file sitting directly in the dragged folder", () => {
    const { upload } = partitionDroppedFiles([droppedFile("notes.txt", "project/notes.txt")])
    expect(upload.map((f) => f.name)).toEqual(["notes.txt"])
  })
})

describe("Inbox is the fallback, not a catch-all", () => {
  it.each([
    ["IMAGE", "IMAGE"],
    ["VIDEO", "VIDEO"],
    ["AUDIO", "AUDIO"],
    ["DOCUMENT", "DOCUMENT"],
  ])("a recognised %s dropped on Inbox is filed under %s", (mediaType, expected) => {
    const decision = resolveUploadRoute({ mediaType, requestedLibraryKind: "INBOX" })
    expect(decision.rerouted).toBe(true)
    expect(decision.libraryKind).toBe(expected)
  })

  it.each(["ARCHIVE", "APPLICATION", "CODE", "OTHER"])(
    "an unrecognised %s stays in Inbox",
    (mediaType) => {
      const decision = resolveUploadRoute({ mediaType, requestedLibraryKind: "INBOX" })
      expect(decision.rerouted).toBe(false)
      expect(decision.libraryKind).toBe("INBOX")
    },
  )

  it("Inbox only accepts what nothing else claims", () => {
    expect(libraryAcceptsMediaType("INBOX", "IMAGE")).toBe(false)
    expect(libraryAcceptsMediaType("INBOX", "ARCHIVE")).toBe(true)
  })

  it("a custom library still keeps whatever is filed into it", () => {
    // Choosing a custom library is deliberate in a way that standing on Inbox
    // is not.
    expect(libraryAcceptsMediaType("CUSTOM", "IMAGE")).toBe(true)
    expect(resolveUploadRoute({ mediaType: "IMAGE", requestedLibraryKind: "CUSTOM" }).rerouted).toBe(
      false,
    )
  })

  it("does not regress the mismatch it already caught", () => {
    // An image dropped on Videos was always rerouted; that must still hold.
    const decision = resolveUploadRoute({ mediaType: "IMAGE", requestedLibraryKind: "VIDEO" })
    expect(decision.rerouted).toBe(true)
    expect(decision.libraryKind).toBe("IMAGE")
  })
})
