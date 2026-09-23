import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

/**
 * The Files header disagreed with the sidebar in both directions — Videos 43
 * against 42, Images 127 against 129 — and it survived reload and re-login.
 *
 * The scopes were a red herring. The header was counting `assets.length` and
 * `assets.filter(...)` over whatever the browser had fetched, which is one
 * page of results. The sidebar was asking the database. The header was
 * reporting a sample and calling it a total, which is why the difference had
 * no consistent direction.
 *
 * The contract, now that both ask the same question:
 *
 *   ACTIVE  = not trashed, not archived, not inside a deleted or hidden
 *             folder, visible to this viewer.
 *   A number and the list beneath it describe the same set.
 *   Archived is reported separately, never folded into an active total.
 */

const introRaw = readFileSync("apps/web/components/libraries/files-page-intro.tsx", "utf8")
/**
 * Comments stripped before asserting absence: the file explains what it used
 * to do, and a test that cannot tell the explanation from the code would fail
 * on its own documentation.
 */
const intro = introRaw
  .split("\n")
  .filter((line) => !/^\s*(\*|\/\*|\/\/|\{\/\*)/.test(line))
  .join("\n")
const assetRoutes = readFileSync("apps/api/src/modules/assets/routes.ts", "utf8")

describe("the header asks the database, not the page it is on", () => {
  it("no longer counts the loaded array", () => {
    expect(intro).not.toContain("assets.length")
    expect(intro).not.toMatch(/assets\.filter\(/)
  })

  it("reads server-computed totals", () => {
    expect(introRaw).toContain("getAssetStats")
    expect(introRaw).toContain("stats?.active")
    expect(introRaw).toContain("stats?.images")
    expect(introRaw).toContain("stats?.videos")
  })

  it("says active rather than implying everything", () => {
    // Archived files still exist; a total that quietly excludes them should
    // say which total it is.
    expect(introRaw).toContain("Active files")
  })

  it("reports archived separately when there is any", () => {
    expect(introRaw).toContain("Archived")
  })
})

describe("the stats endpoint uses the same predicate as the listing", () => {
  const block = assetRoutes.slice(assetRoutes.indexOf('"/assets/stats"'))

  it("builds its counts through buildVisibleAssetWhere", () => {
    // A second hand-written predicate is how two surfaces start disagreeing.
    expect(block.slice(0, 2000)).toContain("buildVisibleAssetWhere")
  })

  it("excludes hidden folders and respects computer-library ownership", () => {
    expect(block.slice(0, 2000)).toContain("hiddenFolderIds")
    expect(block.slice(0, 2000)).toContain("restrictComputerOwnerId")
  })

  it("counts archived only as its own figure", () => {
    expect(block.slice(0, 2000)).toContain('archived: "only"')
  })

  it("requires a reader to be authorised", () => {
    expect(block.slice(0, 600)).toContain("requireSessionRolesOrApiKeyScopes")
  })
})

describe("counts refresh without a reload", () => {
  const keys = readFileSync("apps/web/lib/api/query-keys.ts", "utf8")
  const hooks = readFileSync("apps/web/hooks/use-assets.ts", "utf8")

  it("the stats key sits under the assets prefix", () => {
    // assetsRoot is ["assets"], so every asset mutation already invalidates
    // these totals — upload, archive, trash and restore all land.
    expect(keys).toContain('assetStats: ["assets", "stats"]')
    expect(keys).toContain('assetsRoot: ["assets"]')
  })

  it("mutations invalidate that prefix", () => {
    expect(hooks).toMatch(/invalidateQueries\(\{\s*queryKey: (\["assets"\]|queryKeys\.assetsRoot)/)
  })
})

describe("typed libraries and their listings share one scope", () => {
  const libraryView = readFileSync(
    "apps/api/src/services/libraries/library-view.ts",
    "utf8",
  )

  it("resolveSmartLibraryScope decides for both", () => {
    // The sidebar counter and the library listing both go through this, so a
    // typed library's number is the number of rows it will actually show —
    // including computer-library files of the same type, where it merges them.
    expect(libraryView).toContain("libraryView")
    expect(libraryView).toContain("computerLibraryIds")
    expect(assetRoutes).toContain("resolveSmartLibraryScope")
  })
})
