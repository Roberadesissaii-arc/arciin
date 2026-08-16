import { createHash } from "node:crypto"
import { existsSync, readFileSync, statSync } from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

import { buildObjectKey } from "../packages/storage/src/object-key"
import {
  E2E_GEMINI_DISPLAY_NAME,
  E2E_GEMINI_PROFILE_ID,
} from "./e2e/gemini-fixture"

/**
 * The transcript suite's fixture, and the promises the seeder makes about it.
 *
 * The suite used to depend on a video row somebody had created by hand and
 * bytes that existed on exactly one machine, so a clean checkout could not run
 * it at all. These pin the parts that would let that quietly return.
 */

const repoRoot = path.resolve(__dirname, "..")
const FIXTURE = path.join(repoRoot, "tests/fixtures/e2e-video-transcript-fixture.mp4")

/** Mirrors the seeder. Kept here so a drift in either is a failing test. */
function seederObjectKey(checksum: string, extension: string) {
  const ext = extension.startsWith(".") ? extension.toLowerCase() : `.${extension.toLowerCase()}`
  return path.join("objects", checksum.slice(0, 2), checksum.slice(2, 4), `${checksum}${ext}`)
}

describe("the committed video fixture", () => {
  it("is in the repository, so a clean checkout can run the suite", () => {
    expect(existsSync(FIXTURE), `${FIXTURE} should be committed`).toBe(true)
  })

  it("stays small enough to belong in git", () => {
    // The original promo was 2.4 MB. Re-encoded, it carries the same speech at
    // a tenth of the size; a fixture that grows back into megabytes should
    // fail here rather than bloat every clone.
    const kb = statSync(FIXTURE).size / 1024
    expect(kb).toBeLessThan(600)
    expect(kb).toBeGreaterThan(20)
  })

  it("is a real mp4 rather than a placeholder", () => {
    // ftyp box in the first 12 bytes: enough to catch an empty or text stand-in
    // committed by accident.
    const head = readFileSync(FIXTURE).subarray(0, 12).toString("latin1")
    expect(head).toContain("ftyp")
  })
})

describe("where the seeder puts the bytes", () => {
  it("matches the layout uploads actually produce", () => {
    // The seeder cannot import even the shared builder — it runs under plain
    // node and this is TypeScript — so it keeps a copy, and this is what keeps
    // that copy honest. A change to the layout that is not mirrored in the
    // seeder leaves fixture bytes somewhere the app never looks.
    const checksum = createHash("sha256").update(readFileSync(FIXTURE)).digest("hex")

    // `createObjectStoragePath` in the API now delegates to this same builder,
    // so agreeing with it is agreeing with what uploads produce.
    expect(seederObjectKey(checksum, ".mp4")).toBe(buildObjectKey(checksum, ".mp4"))
    expect(seederObjectKey(checksum, "mp4")).toBe(buildObjectKey(checksum, "mp4"))
    expect(seederObjectKey(checksum, ".MP4")).toBe(buildObjectKey(checksum, ".MP4"))
  })

  it("is content-addressed, so re-seeding the same file cannot duplicate it", () => {
    const checksum = createHash("sha256").update(readFileSync(FIXTURE)).digest("hex")
    expect(seederObjectKey(checksum, ".mp4")).toBe(seederObjectKey(checksum, ".mp4"))
    // A different file lands elsewhere rather than overwriting.
    const other = createHash("sha256").update("something else").digest("hex")
    expect(seederObjectKey(other, ".mp4")).not.toBe(seederObjectKey(checksum, ".mp4"))
  })
})

describe("the temporary Gemini profile", () => {
  it("is identified by its own id, not by provider", () => {
    // Deleting by `provider: "gemini"` would take a real profile with it on any
    // instance that has one. The marker id is what makes cleanup safe.
    expect(E2E_GEMINI_PROFILE_ID).toMatch(/^e2e-/)
    expect(E2E_GEMINI_DISPLAY_NAME.toLowerCase()).toContain("e2e")
  })

  it("does not collide with a real profile's identifier", () => {
    expect(E2E_GEMINI_PROFILE_ID).not.toBe("gemini")
    expect(E2E_GEMINI_PROFILE_ID.length).toBeGreaterThan(8)
  })
})

describe("the harness never hard-codes a credential", () => {
  it("keeps the key out of committed source", () => {
    // The key arrives through the environment. Anything that looks like a real
    // Google key sitting in these files is a leak.
    for (const file of ["e2e/gemini-fixture.ts", "e2e/global-setup.ts", "e2e/video-transcript.spec.ts"]) {
      const text = readFileSync(path.join(__dirname, file), "utf8")
      expect(text, `${file} must not embed a key`).not.toMatch(/AIza[0-9A-Za-z_-]{20,}/)
    }
  })

  it("reads the key from the environment variable the docs name", () => {
    const text = readFileSync(path.join(__dirname, "e2e/gemini-fixture.ts"), "utf8")
    expect(text).toContain("E2E_GEMINI_API_KEY")
  })
})

/**
 * Comments stripped before matching.
 *
 * The first version of this failed on its own documentation: global-setup
 * explains that `pkill -f apps/worker/src/index.ts` is the thing being avoided,
 * and a naive search found that sentence. What matters is the code.
 */
function codeOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
}

describe("worker teardown cannot reach production", () => {
  const raw = readFileSync(path.join(__dirname, "e2e/global-setup.ts"), "utf8")
  const setup = codeOnly(raw)

  it("never kills by command text", () => {
    /**
     * The incident this prevents: `pkill -f "apps/worker/src/index.ts"` reads
     * as precise and is not. The production PM2 worker runs that same
     * entrypoint, so a test tidying up after itself takes production down.
     */
    expect(setup).not.toMatch(/pkill|killall/)
    expect(setup).not.toMatch(/exec\w*\(\s*["'`][^"'`]*kill/)
  })

  it("signals only the process group it created", () => {
    // detached:true puts the spawn in its own group; the negative pid reaches
    // that group and nothing else, because a group holds only what was spawned
    // into it.
    expect(setup).toContain("detached: true")
    expect(setup).toMatch(/process\.kill\(-\w+\.pid/)
  })

  it("does not stop a worker it never started", () => {
    // The guard that makes a null worker a no-op rather than a stray signal.
    expect(setup).toMatch(/if \(!worker\?\.pid\) return/)
  })

  it("keeps the dev worker on the dev queue namespace", () => {
    // Production consumes "bull"; dev consumes "bull-dev". A test job must
    // never land where a production worker will pick it up.
    expect(setup).toMatch(/ARCIIN_ENV_NAMESPACE: "dev"/)
  })

  it("cleans up even when setup itself throws", () => {
    // Playwright does not run global teardown for a globalSetup that threw, so
    // a half-built setup has to undo itself.
    expect(setup).toMatch(/catch \(error\)[\s\S]{0,200}teardown\(/)
    expect(setup).toMatch(/finally/)
  })
})
