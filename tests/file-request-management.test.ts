import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import path from "node:path"

/**
 * A file request is a public URL that writes into a private folder: anyone
 * holding it can upload without an account.
 *
 * The server had list, revoke and extend routes the whole time, and the API
 * client had correct wrappers for all three — but nothing in the app called
 * any of them. A link could be created and then never seen again, never
 * revoked, and one made without an expiry accepted uploads forever. Same shape
 * as the share-link gap, closed the same way.
 *
 * These hold the wiring in place. A wrapper with no caller is how this
 * regressed the first time, so the test is that every one of them is called.
 */

const root = path.resolve(__dirname, "..")
const read = (p: string) => readFileSync(path.join(root, p), "utf8")

function callersOf(name: string): string[] {
  try {
    const out = execFileSync(
      "grep",
      ["-rl", "--include=*.ts", "--include=*.tsx", `\\b${name}\\b`, "apps", "packages"],
      { cwd: root, encoding: "utf8" },
    )
    return out
      .split("\n")
      .filter(Boolean)
      .filter((f) => !f.endsWith("lib/api/file-requests.ts"))
  } catch {
    return []
  }
}

describe("every file-request API wrapper has a caller", () => {
  const client = read("apps/web/lib/api/file-requests.ts")
  const exported = [...client.matchAll(/^export function (\w+)/gm)].map((m) => m[1]!)

  it("found the wrappers to check", () => {
    expect(exported.length).toBeGreaterThanOrEqual(6)
  })

  it.each([
    "listFileRequests",
    "createFileRequest",
    "revokeFileRequest",
    "extendFileRequest",
    "getPublicFileRequest",
    "submitFileToRequest",
    "completeFileRequestSubmission",
  ])("%s is used somewhere in the app", (name) => {
    expect(exported).toContain(name)
    expect(callersOf(name).length, `${name} has no caller`).toBeGreaterThan(0)
  })

  it("no longer ships the submissions wrapper nothing consumed", () => {
    // The route stays; the client function had zero callers and the UI it would
    // have served does not exist. Inventing that UI was not the fix.
    expect(exported).not.toContain("listFileRequestSubmissions")
    expect(client).not.toMatch(/export type FileRequestSubmission\b/)
  })
})

describe("the management surface exists", () => {
  const list = read("apps/web/components/file-requests/existing-file-requests.tsx")

  it("can revoke and extend", () => {
    expect(list).toMatch(/revokeFileRequest/)
    expect(list).toMatch(/extendFileRequest/)
    expect(list).toMatch(/listFileRequests/)
  })

  it("asks before revoking, because holders lose access immediately", () => {
    expect(list).toMatch(/confirming/)
    expect(list).toMatch(/file-request-revoke-confirm/)
  })

  it("shows only the token prefix, never the credential", () => {
    expect(list).toMatch(/tokenPrefix/)
    // The raw token exists only on the creation response.
    expect(list).not.toMatch(/\brequest\.token\b/)
  })

  it("is reachable from the dialog that creates the links", () => {
    const dialog = read("apps/web/components/file-requests/file-request-dialog.tsx")
    expect(dialog).toMatch(/ExistingFileRequests/)
  })

  it("surfaces a link with no expiry rather than letting it look normal", () => {
    expect(list).toMatch(/No expiry/)
  })
})
