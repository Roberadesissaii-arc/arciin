import { describe, expect, it } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import path from "node:path"

/**
 * What third-party artwork this repository is allowed to carry.
 *
 * apps/web/public/assets/icons/apps held 185 SVGs weighing 39.2MB. Fifty-four
 * of them, totalling 0.10MB, were referenced. The other 131 — 39.1MB, 99.7% of
 * the directory — were rendered by nothing at all, and were overwhelmingly
 * traced reproductions of Apple's macOS application artwork: GarageBand, Siri,
 * Final Cut Pro, Font Book, Disk Utility, Chess, FaceTime, Preview, and the
 * rest of the dock. Roughly a megabyte each, which is what a traced raster
 * costs.
 *
 * Shipping another company's application artwork in a commercial product needs
 * documented permission, and there is none on file for these. Nothing rendered
 * them, so they are gone.
 *
 * What remains are small brand marks used to identify a service — the logo next
 * to a password-vault entry for GitHub or Spotify. That is a narrower use than
 * redistributing application artwork, and this test keeps it narrow: an icon
 * may live here only if the code actually asks for it.
 */

const root = path.resolve(__dirname, "..")
const ICON_DIR = path.join(root, "apps/web/public/assets/icons/apps")

/** Every apps/ icon filename the code can ask for. */
function referencedIcons(): Set<string> {
  const referenced = new Set<string>()

  const vaultBrand = readFileSync(path.join(root, "apps/web/lib/passwords/vault-brand.ts"), "utf8")
  const sourceBrand = readFileSync(
    path.join(root, "apps/web/lib/utils/source-brand-icon.ts"),
    "utf8",
  )

  // Literal paths anywhere in the two resolvers plus any component.
  for (const src of [vaultBrand, sourceBrand]) {
    for (const m of src.matchAll(/\/assets\/icons\/apps\/([^"'`]+\.svg)/g)) {
      referenced.add(m[1]!)
    }
  }

  // LOCAL_ICON_FILES.app — resolved against the apps/ folder at runtime.
  const appBlock = /app:\s*\{([\s\S]*?)\n {2}\},/.exec(vaultBrand)
  expect(appBlock, "vault-brand app icon table must be parseable").not.toBeNull()
  for (const m of appBlock![1]!.matchAll(/:\s*"([^"]+\.svg)"/g)) {
    referenced.add(m[1]!)
  }

  // SOURCE_ICON_FILES entries that point at apps/ rather than sources/.
  for (const m of sourceBrand.matchAll(/file:\s*"([^"]+)",\s*dir:\s*"(\w+)"/g)) {
    if (m[2] === "apps") referenced.add(m[1]!)
  }

  return referenced
}

const present = readdirSync(ICON_DIR).filter((f) => f.endsWith(".svg"))
const referenced = referencedIcons()
const bytes = (f: string) => statSync(path.join(ICON_DIR, f)).size

describe("brand icons", () => {
  it("found icons and references to compare", () => {
    expect(present.length).toBeGreaterThan(10)
    expect(referenced.size).toBeGreaterThan(10)
  })

  it("carries nothing the code never asks for", () => {
    const unused = present.filter((f) => !referenced.has(f))
    expect(unused, `unreferenced third-party artwork: ${unused.join(", ")}`).toEqual([])
  })

  it("still has every icon the code does ask for", () => {
    const missing = [...referenced].filter((f) => !present.includes(f))
    expect(missing, `referenced but absent: ${missing.join(", ")}`).toEqual([])
  })

  it("keeps them small enough to be marks rather than artwork", () => {
    // The removed Apple app icons were ~1MB each. A brand mark is a few KB.
    const heavy = present.filter((f) => bytes(f) > 64 * 1024)
    expect(heavy, `oversized for a brand mark: ${heavy.join(", ")}`).toEqual([])
  })

  it("keeps the whole directory to a payload a page can afford", () => {
    const total = present.reduce((sum, f) => sum + bytes(f), 0)
    expect(total).toBeLessThan(1024 * 1024)
  })
})
