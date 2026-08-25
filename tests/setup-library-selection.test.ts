import { describe, expect, it } from "vitest"

import { DEFAULT_LIBRARY_DEFINITIONS, normalizeLibrarySelection } from "@arciin/config"

/**
 * Setup must not be able to produce an instance with no libraries.
 *
 * The claim schema took any strings and then filtered the definitions by
 * *name*. A payload of slugs — "videos" rather than "Videos" — matched
 * nothing, claimed successfully, and left an instance with zero libraries.
 * Uploads then failed with LIBRARY_NOT_CONFIGURED forever, because nothing
 * else creates them: the Docker seed only does so when an instance already
 * exists, and it runs at container boot, before anyone has claimed. The only
 * escape was restarting the API so the seed ran again.
 *
 * Found by the Docker acceptance run, which sent slugs and got an instance
 * that booted healthy and could not accept a single file.
 */
describe("library selection at claim", () => {
  it("accepts the names the setup form sends", () => {
    expect(normalizeLibrarySelection(["Videos", "Images", "Music", "Documents", "Inbox"])).toEqual([
      "Videos",
      "Images",
      "Music",
      "Documents",
      "Inbox",
    ])
  })

  it("accepts slugs, because they are the obvious guess", () => {
    expect(normalizeLibrarySelection(["videos", "images"])).toEqual(["Videos", "Images"])
  })

  it("is case-insensitive and ignores surrounding space", () => {
    expect(normalizeLibrarySelection([" VIDEOS ", "iMaGeS"])).toEqual(["Videos", "Images"])
  })

  it("rejects anything outside the known set rather than selecting nothing", () => {
    expect(normalizeLibrarySelection(["Videos", "Nonsense"])).toBeNull()
    expect(normalizeLibrarySelection(["screenshots"])).toBeNull()
  })

  it("rejects an empty selection", () => {
    expect(normalizeLibrarySelection([])).toBeNull()
  })

  it("never returns an empty list for a truthy result — the failure that started this", () => {
    for (const input of [["videos"], ["Inbox"], ["documents", "documents"]]) {
      const out = normalizeLibrarySelection(input)
      expect(out).not.toBeNull()
      expect(out!.length).toBeGreaterThan(0)
    }
  })

  it("de-duplicates so one library is not created twice", () => {
    expect(normalizeLibrarySelection(["Videos", "videos", "VIDEOS"])).toEqual(["Videos"])
  })

  it("resolves every shipped definition by both of its identifiers", () => {
    for (const library of DEFAULT_LIBRARY_DEFINITIONS) {
      expect(normalizeLibrarySelection([library.name])).toEqual([library.name])
      expect(normalizeLibrarySelection([library.slug])).toEqual([library.name])
    }
  })
})
