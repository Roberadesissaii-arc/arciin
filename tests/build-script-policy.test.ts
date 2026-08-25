import { describe, expect, it } from "vitest"
import { readFileSync, existsSync } from "node:fs"
import path from "node:path"

/**
 * No dependency runs an install script here, and neither of the two that asked
 * to needs one.
 *
 * `@google/genai` declares `prepare: node scripts/prepare.js` — but the
 * published tarball contains only dist/, node/ and web/. There is no scripts/
 * directory to run, so approving it would turn a silent skip into a failing
 * install.
 *
 * `protobufjs` declares a postinstall that only compares how a dependent spells
 * its version range and writes a warning to stderr. It emits no artifact, and
 * under pnpm's layout it cannot even find the parent manifest it wants to read,
 * so it returns immediately.
 *
 * Both stay denied. The empty allowlist states that as a decision rather than
 * leaving it to whatever pnpm happens to default to.
 */

const root = path.resolve(__dirname, "..")

describe("install scripts are denied on purpose", () => {
  const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as {
    pnpm?: { onlyBuiltDependencies?: string[] }
  }

  it("declares an explicit, empty allowlist", () => {
    expect(pkg.pnpm?.onlyBuiltDependencies).toEqual([])
  })

  it("does not quietly re-enable scripts for the two that asked", () => {
    const allowed = pkg.pnpm?.onlyBuiltDependencies ?? []
    expect(allowed).not.toContain("@google/genai")
    expect(allowed).not.toContain("protobufjs")
  })
})

describe("the denied scripts have nothing to produce", () => {
  it("@google/genai ships no scripts directory to run", () => {
    const dir = path.join(root, "node_modules", "@google", "genai")
    expect(existsSync(dir), "@google/genai must be installed for this check").toBe(true)
    expect(existsSync(path.join(dir, "scripts"))).toBe(false)
    // The prebuilt output it actually loads from.
    expect(existsSync(path.join(dir, "dist"))).toBe(true)
  })

  it("@google/genai still loads and builds a client", async () => {
    const genai = await import("@google/genai")
    const client = new genai.GoogleGenAI({ apiKey: "not-a-real-key" })
    expect(typeof client.models.generateContent).toBe("function")
  })
})
