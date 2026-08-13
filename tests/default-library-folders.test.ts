import { describe, expect, it } from "vitest"

import { DEFAULT_LIBRARY_DEFINITIONS, DEFAULT_LIBRARY_FOLDERS } from "@arciin/config"

/**
 * The folders a fresh instance opens with.
 *
 * Five empty libraries is a worse first impression than it sounds: nothing shows
 * that folders exist, so the first upload lands loose at the root and the
 * feature is discovered late. A couple of obvious folders show the shape without
 * deciding how anyone files their library.
 */

describe("every library is accounted for", () => {
  it.each(DEFAULT_LIBRARY_DEFINITIONS.map((l) => l.slug))(
    "%s has an entry, even if empty",
    (slug) => {
      expect(DEFAULT_LIBRARY_FOLDERS[slug]).toBeDefined()
    },
  )

  it("names no library that does not exist", () => {
    const known = new Set(DEFAULT_LIBRARY_DEFINITIONS.map((l) => l.slug))
    for (const slug of Object.keys(DEFAULT_LIBRARY_FOLDERS)) {
      expect(known.has(slug)).toBe(true)
    }
  })
})

describe("restraint", () => {
  it("gives no library more than two", () => {
    // A starter folder someone has to delete is worse than one never created.
    for (const [slug, folders] of Object.entries(DEFAULT_LIBRARY_FOLDERS)) {
      expect(folders.length, slug).toBeLessThanOrEqual(2)
    }
  })

  it("leaves Inbox empty, because that is what Inbox is for", () => {
    expect(DEFAULT_LIBRARY_FOLDERS.inbox).toEqual([])
  })

  it("creates a manageable number in total", () => {
    const total = Object.values(DEFAULT_LIBRARY_FOLDERS).reduce((n, f) => n + f.length, 0)
    expect(total).toBeGreaterThan(0)
    expect(total).toBeLessThanOrEqual(8)
  })
})

describe("the names are usable as folders", () => {
  const slugify = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-")

  it.each(Object.values(DEFAULT_LIBRARY_FOLDERS).flat())("%s slugifies cleanly", (name) => {
    const slug = slugify(name)
    expect(slug).toMatch(/^[a-z0-9-]+$/)
    expect(slug).not.toBe("")
    expect(slug.startsWith("-")).toBe(false)
    expect(slug.endsWith("-")).toBe(false)
  })

  it("has no duplicate names within one library", () => {
    for (const [slug, folders] of Object.entries(DEFAULT_LIBRARY_FOLDERS)) {
      expect(new Set(folders).size, slug).toBe(folders.length)
    }
  })

  it("has no duplicate slugs within one library", () => {
    for (const [slug, folders] of Object.entries(DEFAULT_LIBRARY_FOLDERS)) {
      const slugs = folders.map(slugify)
      expect(new Set(slugs).size, slug).toBe(slugs.length)
    }
  })
})
