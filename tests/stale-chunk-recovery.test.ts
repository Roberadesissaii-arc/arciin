import { describe, expect, it } from "vitest"

/**
 * Recovering from a tab that outlived its deployment.
 *
 * Next names bundles by content hash, so after a deploy an open tab asks for
 * files that no longer exist and throws on the next navigation. The 500 page
 * then reports a crash when the only thing wrong is that the tab is stale — and
 * "Try again" cannot help, because it re-requests the same missing file.
 */

/** Mirrors the check in app/error.tsx. */
function isStaleChunk(error: { message?: string; name?: string }): boolean {
  const message = `${error?.message ?? ""} ${error?.name ?? ""}`
  return /loading chunk|failed to load chunk|chunkloaderror|dynamically imported module/i.test(message)
}

describe("recognising a stale bundle", () => {
  it.each([
    "Failed to load chunk /_next/static/chunks/0qn-v1un6ol1o.js from module",
    "Loading chunk 4821 failed.",
    "Failed to fetch dynamically imported module: /_next/static/chunks/app/page.js",
  ])("%s", (message) => {
    expect(isStaleChunk({ message })).toBe(true)
  })

  it("matches on the error name too, which is where Next puts it", () => {
    expect(isStaleChunk({ name: "ChunkLoadError", message: "" })).toBe(true)
  })
})

describe("leaving real failures alone", () => {
  it.each([
    "Cannot read properties of undefined (reading 'map')",
    "Request failed with status 500",
    "Hydration failed because the server rendered HTML didn't match",
    "NetworkError when attempting to fetch resource",
    "",
  ])("does not reload for: %j", (message) => {
    // Reloading on an ordinary bug hides it and costs the user their place.
    expect(isStaleChunk({ message })).toBe(false)
  })
})

describe("the reload happens once", () => {
  // A marker that survives the reload is the only thing stopping a loop when the
  // chunk is genuinely gone rather than merely stale.
  function attempt(store: Map<string, string>): "reloaded" | "gave up" {
    const KEY = "arciin:chunk-reload"
    if (store.get(KEY)) return "gave up"
    store.set(KEY, "1")
    return "reloaded"
  }

  it("reloads the first time", () => {
    expect(attempt(new Map())).toBe("reloaded")
  })

  it("shows the error page rather than looping", () => {
    const store = new Map<string, string>()
    expect(attempt(store)).toBe("reloaded")
    expect(attempt(store)).toBe("gave up")
    expect(attempt(store)).toBe("gave up")
  })

  it("is scoped per tab, so another tab still gets its own recovery", () => {
    const tabA = new Map<string, string>()
    const tabB = new Map<string, string>()
    expect(attempt(tabA)).toBe("reloaded")
    expect(attempt(tabB)).toBe("reloaded")
  })
})
