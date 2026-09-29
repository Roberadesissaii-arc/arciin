import { readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

import { redactSensitiveUrl } from "../apps/api/src/services/security/request-log-redaction"
import { redactTokenPath } from "../apps/web/lib/server/redact-token-path"

/**
 * Bearer tokens in URL paths must not reach any log.
 *
 * v1.1.0 wrote File Request and share tokens in full into api.log (Fastify's
 * request line) and into the web error log (the proxy's "upstream request
 * failed" line). Every route whose path has a `:token` segment is collected
 * from the API source here, so a new one cannot be added without its
 * redaction being tested.
 */

const TOKEN = "frq_AbCdEfGhIjKlMnOpQrStUvWxYz012345"
const SHARE = "shr_AbCdEfGhIjKlMnOpQrStUvWxYz012345"

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name)
    return statSync(full).isDirectory() ? sourceFiles(full) : full.endsWith(".ts") ? [full] : []
  })
}

const tokenRoutes = [
  ...new Set(
    sourceFiles("apps/api/src").flatMap((file) =>
      [...readFileSync(file, "utf8").matchAll(/"(\/[a-z0-9/:-]*:token[a-zA-Z0-9/:?=_-]*)"/g)].map((m) => m[1]!),
    ),
  ),
]

function concrete(route: string, token: string) {
  return `/api${route.replace(":token", token).replace(/:[a-zA-Z]+/g, "cmabc1234567890abcdefghij")}`
}

describe("token-bearing routes are redacted in every log", () => {
  it("finds the File Request and share routes", () => {
    expect(tokenRoutes.some((r) => r.startsWith("/public/file-requests/:token"))).toBe(true)
    expect(tokenRoutes.some((r) => r.startsWith("/shares/access/:token"))).toBe(true)
  })

  it.each(tokenRoutes)("API request log: %s", (route) => {
    for (const token of [TOKEN, SHARE]) {
      const url = `${concrete(route, token)}?offset=16777216`
      const out = redactSensitiveUrl(url)
      expect(out).not.toContain(token)
      expect(out).toContain("[redacted]")
    }
  })

  it.each(tokenRoutes)("web proxy error log: %s", (route) => {
    for (const token of [TOKEN, SHARE]) {
      const out = redactTokenPath(concrete(route, token))
      expect(out).not.toContain(token)
      expect(out).toContain("[redacted]")
    }
  })

  it("the proxy logs its path through the redactor", () => {
    const src = readFileSync("apps/web/lib/server/api-proxy.ts", "utf8")
    const at = src.indexOf("[api-proxy] upstream request failed")
    expect(at).toBeGreaterThan(-1)
    expect(src.slice(at, at + 400)).toContain("redactTokenPath(")
  })

  it("the public page paths are redacted too, and nothing else is touched", () => {
    expect(redactTokenPath(`/request/${TOKEN}`)).toBe("/request/[redacted]")
    expect(redactTokenPath(`/s/${SHARE}`)).toBe("/s/[redacted]")
    expect(redactTokenPath("/api/libraries/abc/folders")).toBe("/api/libraries/abc/folders")
    expect(redactTokenPath("/api/assets/s/x")).toBe("/api/assets/s/x")
    expect(redactTokenPath("/api/file-requests/incoming")).toBe("/api/file-requests/incoming")
  })
})
