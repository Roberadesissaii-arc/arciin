import { describe, expect, it } from "vitest"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"

/**
 * A deploy must never leave production serving HTML that points at chunks the
 * server cannot hand back.
 *
 * Next names bundles by content hash, so a build writing into the live
 * `apps/web/.next` deletes the running server's assets the moment it starts.
 * For the length of the build every page references files that are already
 * gone, and a build that dies partway leaves `.next` with no BUILD_ID, no
 * manifests and no `pages/500.html` — at which point even the error page fails
 * and static requests answer 500.
 *
 * The fix is procedural, so it is pinned here: build into a staging directory,
 * verify it, then swap it in.
 */

const root = path.resolve(__dirname, "..")
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as {
  scripts: Record<string, string>
}

/** Every script that builds or ships the web tier. */
const DEPLOY_SCRIPTS = ["build:clean", "deploy", "deploy:web", "deploy:safe"]

describe("no deploy script writes into the live build directory", () => {
  it.each(DEPLOY_SCRIPTS)("%s does not delete apps/web/.next", (name) => {
    const script = pkg.scripts[name]
    expect(script, `${name} must exist`).toBeTypeOf("string")
    // `.next-build`/`.next-prev` are fine; the bare live directory is not.
    expect(script).not.toMatch(/rm\s+-rf\s+apps\/web\/\.next(?![\w-])/)
  })

  it.each(DEPLOY_SCRIPTS)("%s builds into a staging directory", (name) => {
    const script = pkg.scripts[name]
    // Either it sets a staging distDir itself, or it delegates to the script
    // that does. What it must not do is run a bare production web build.
    const staged =
      script.includes("NEXT_DIST_DIR=.next-build") ||
      script.includes("scripts/deploy-web.sh") ||
      script.includes("deploy:web") ||
      // build:web now carries the staging distDir itself, so delegating to it
      // is staging.
      script.includes("build:web")
    expect(staged, `${name} must stage the build, got: ${script}`).toBe(true)
  })
})

describe("the deploy is gated on a complete build", () => {
  const deployScript = path.join(root, "scripts", "deploy-web.sh")

  it("ships an atomic deploy script", () => {
    expect(existsSync(deployScript)).toBe(true)
  })

  it("verifies the staged build before swapping it in", () => {
    const text = readFileSync(deployScript, "utf8")
    const verifyAt = text.indexOf("verify-web-assets.mjs")
    const swapAt = text.indexOf('mv "$STAGE" "$LIVE"')
    expect(verifyAt).toBeGreaterThan(-1)
    expect(swapAt).toBeGreaterThan(-1)
    expect(verifyAt, "the build must be verified before it goes live").toBeLessThan(swapAt)
  })

  it("can roll back to the previous build", () => {
    const text = readFileSync(deployScript, "utf8")
    expect(text).toContain('mv "$PREV" "$LIVE"')
  })

  it("exposes the verifier as its own script", () => {
    expect(pkg.scripts["verify:web-assets"]).toContain("verify-web-assets.mjs")
  })
})

describe("a bare build cannot reach the running build", () => {
  // `pnpm build` wrote straight into apps/web/.next. It filled the disk
  // partway through, left `.next` with no BUILD_ID and no manifests, and took
  // production down — the same partial-build state this file was written for,
  // arrived at through the one script that still pointed at the live
  // directory. Every build now lands in staging; only deploy-web.sh swaps.
  it.each(["build", "build:web", "build:clean"])("%s targets .next-build", (name) => {
    expect(pkg.scripts[name]).toBeTypeOf("string")
    const script = pkg.scripts[name]
    const staged = script.includes("NEXT_DIST_DIR=.next-build") || script.includes("build:web")
    expect(staged, `${name} must build into staging, got: ${script}`).toBe(true)
  })

  it("no build script names the live directory", () => {
    for (const name of ["build", "build:web", "build:clean", "deploy", "deploy:web", "deploy:safe"]) {
      // `.next-build` and `.next-prev` are fine; a bare `.next` is not.
      expect(pkg.scripts[name] ?? "").not.toMatch(/NEXT_DIST_DIR=\.next(?![\w-])/)
    }
  })
})
