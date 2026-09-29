import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"

import { afterEach, describe, expect, it } from "vitest"

/**
 * The guard that would have caught the account portal's 500.
 *
 * Its build was made by next@16.2.6 and then served by next@16.3.3's runtime:
 * every dynamic page failed with "renderToPipeableStream is not implemented"
 * while the process looked healthy. A stamped build now refuses to start
 * under a different Next or React, with an explanation, instead.
 */

const SCRIPT = path.resolve(__dirname, "../scripts/next-build-stamp.mjs")
let dir: string

function app(versions: { next: string; react: string; reactDom: string }, built = true) {
  dir = mkdtempSync(path.join(os.tmpdir(), "stamp-"))
  writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "fixture" }))
  for (const [name, version] of [["next", versions.next], ["react", versions.react], ["react-dom", versions.reactDom]]) {
    mkdirSync(path.join(dir, "node_modules", name!), { recursive: true })
    writeFileSync(path.join(dir, "node_modules", name!, "package.json"), JSON.stringify({ name, version }))
  }
  if (built) {
    mkdirSync(path.join(dir, ".next"), { recursive: true })
    writeFileSync(path.join(dir, ".next", "BUILD_ID"), "abc")
  }
}

function run(mode: string, env: Record<string, string> = {}) {
  try {
    const out = execFileSync(process.execPath, [SCRIPT, mode], { cwd: dir, env: { PATH: process.env.PATH!, ...env }, encoding: "utf8", stdio: "pipe" })
    return { code: 0, out }
  } catch (error) {
    const e = error as { status: number; stderr: string; stdout: string }
    return { code: e.status, out: `${e.stdout}${e.stderr}` }
  }
}

function setVersion(name: string, version: string) {
  writeFileSync(path.join(dir, "node_modules", name, "package.json"), JSON.stringify({ name, version }))
}

afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe("next-build-stamp", () => {
  const v = { next: "16.3.3", react: "19.2.4", reactDom: "19.2.4" }

  it("a build stamped with the installed versions starts", () => {
    app(v)
    expect(run("stamp").code).toBe(0)
    expect(run("check").code).toBe(0)
  })

  it("the August case: built with 16.2.6, served by 16.3.3 — refused, with the reason", () => {
    app({ ...v, next: "16.2.6" })
    expect(run("stamp").code).toBe(0)
    setVersion("next", "16.3.3")
    const res = run("check")
    expect(res.code).toBe(1)
    expect(res.out).toContain("built with next 16.2.6")
    expect(res.out).toContain("installed next 16.3.3")
    expect(res.out).toContain("pnpm deploy:account")
  })

  it("a React upgrade under the build is refused too", () => {
    app(v)
    run("stamp")
    setVersion("react-dom", "19.3.0")
    expect(run("check").code).toBe(1)
  })

  it("a build with no stamp (made by an older release) is refused", () => {
    app(v)
    const res = run("check")
    expect(res.code).toBe(1)
    expect(res.out).toContain("no build stamp")
  })

  it("will not stamp an unfinished build, and honours NEXT_DIST_DIR", () => {
    app(v, false)
    expect(run("stamp").code).toBe(1)
    mkdirSync(path.join(dir, ".next-build"), { recursive: true })
    writeFileSync(path.join(dir, ".next-build", "BUILD_ID"), "x")
    expect(run("stamp", { NEXT_DIST_DIR: ".next-build" }).code).toBe(0)
    expect(run("check", { NEXT_DIST_DIR: ".next-build" }).code).toBe(0)
  })
})
