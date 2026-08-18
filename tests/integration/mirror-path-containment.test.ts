import path from "node:path"

import { describe, expect, it } from "vitest"

import { resolveMirrorPathWithinRoot } from "../../apps/api/src/services/integrations/library-media-connector"

/**
 * Containment for the Plex/Jellyfin mirror path.
 *
 * `Asset.libraryMirrorPath` is written from a sanitized filename, so in normal
 * operation it is always inside the storage root. It is still a database value
 * handed to `unlink()`, and the cost of that assumption failing once — a future
 * writer that forgets to sanitize, a hand-edited row, a restored backup from an
 * older schema — is deleting an arbitrary file as the service user.
 *
 * These assert the guard rather than the current writer, because the guard is
 * what has to hold when the writer changes.
 */

const ROOT = "/srv/arciin-storage/arciin"

describe("resolveMirrorPathWithinRoot", () => {
  it("resolves an ordinary mirror path", () => {
    expect(resolveMirrorPathWithinRoot(ROOT, "libraries/videos/plex/movie.mp4")).toBe(
      path.join(ROOT, "libraries/videos/plex/movie.mp4"),
    )
  })

  it("normalises a path that stays inside the root", () => {
    expect(resolveMirrorPathWithinRoot(ROOT, "libraries/videos/../videos/movie.mp4")).toBe(
      path.join(ROOT, "libraries/videos/movie.mp4"),
    )
  })

  it.each([
    ["../../../etc/passwd", "climbing out with .."],
    ["libraries/../../../../etc/shadow", "climbing out from a plausible prefix"],
    ["/etc/passwd", "an absolute path"],
    ["/srv/arciin-storage/arciin-other/file.mp4", "a sibling directory sharing the prefix"],
  ])("refuses %s (%s)", (mirrorPath) => {
    expect(resolveMirrorPathWithinRoot(ROOT, mirrorPath)).toBeNull()
  })

  it("refuses a path that resolves exactly to the root's parent", () => {
    expect(resolveMirrorPathWithinRoot(ROOT, "..")).toBeNull()
  })

  it("treats a trailing-separator root the same way", () => {
    expect(resolveMirrorPathWithinRoot(`${ROOT}/`, "libraries/videos/a.mp4")).toBe(
      path.join(ROOT, "libraries/videos/a.mp4"),
    )
    expect(resolveMirrorPathWithinRoot(`${ROOT}/`, "../../etc/passwd")).toBeNull()
  })
})
