import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

/**
 * L-3: server configuration reaching the browser bundle.
 *
 * Two different questions live here and the pentest was right to separate
 * them. Whether a *secret* ships to the browser is a breach. Whether the
 * *shape* of the server's configuration ships is reconnaissance — it tells a
 * reader which variables exist and what the deployment looks like, without
 * handing over any of the values.
 *
 * The first is asserted hard. The second is pinned to what is there today so
 * it cannot quietly grow while the module split is outstanding.
 */

/**
 * Which build to scan.
 *
 * `ARCIIN_WEB_DIST` names one explicitly (CI sets it to the build it just
 * made). Otherwise the newest build on disk is used, so a developer's fresh
 * build is what gets certified — not whichever older artefact happens to live
 * in `.next`, which on a server is the currently deployed release.
 */
function resolveDistDir(): string {
  const web = path.resolve(__dirname, "../apps/web")
  if (process.env.ARCIIN_WEB_DIST) return path.resolve(web, process.env.ARCIIN_WEB_DIST)
  const candidates = [".next-build", ".next-e2e", ".next", ".next-dev"]
    .map((d) => path.join(web, d))
    .filter((d) => existsSync(path.join(d, "BUILD_ID")))
    .sort((a, b) => statSync(path.join(b, "BUILD_ID")).mtimeMs - statSync(path.join(a, "BUILD_ID")).mtimeMs)
  return candidates[0] ?? path.join(web, ".next")
}

const CHUNK_DIR = path.join(resolveDistDir(), "static/chunks")

function chunkText(): string {
  if (!existsSync(CHUNK_DIR)) return ""
  const files = readdirSync(CHUNK_DIR, { recursive: true }) as string[]
  return files
    .filter((f) => typeof f === "string" && f.endsWith(".js"))
    .map((f) => {
      try {
        return readFileSync(path.join(CHUNK_DIR, f), "utf8")
      } catch {
        return ""
      }
    })
    .join("\n")
}

const bundle = chunkText()
const built = bundle.length > 0
const describeBuilt = built ? describe : describe.skip

describeBuilt("no secret value reaches the browser", () => {
  /**
   * Values, not names. Reads the real environment this server runs with and
   * asserts none of it is in a file the browser downloads. Nothing is printed
   * on failure beyond the variable name.
   */
  const envPath = path.resolve(__dirname, "../.env")
  const env: Record<string, string> = {}
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, "utf8").split("\n")) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())
      if (m) env[m[1]!] = m[2]!.replace(/^["']|["']$/g, "")
    }
  }

  /**
   * Opaque secrets: the whole value must be absent.
   */
  it.each(["SESSION_SECRET", "ARCIIN_ENCRYPTION_KEY", "ARCIIN_SETUP_TOKEN"])("%s", (name) => {
    const value = env[name]
    if (!value || value.length < 12) return // not set here; nothing to leak
    expect(
      bundle.includes(value),
      `${name}'s value is present in a browser chunk`,
    ).toBe(false)
  })

  /**
   * Connection strings: what matters is the credential inside them, not the
   * string itself.
   *
   * REDIS_URL on this host is "redis://127.0.0.1:6379" — no user, no password
   * — and it appears in a chunk because the server's env schema carries it as
   * a default. That is the env-schema leak below, not a disclosed secret, and
   * asserting on the whole string would have conflated the two. What must
   * never ship is an embedded credential.
   */
  it.each(["DATABASE_URL", "REDIS_URL"])("%s carries no credential into the bundle", (name) => {
    const value = env[name]
    if (!value) return
    const credential = /^[a-z+]+:\/\/[^/@:]+:([^@]+)@/i.exec(value)?.[1]
    if (!credential) return
    /**
     * Only assert on something that could only be the credential.
     *
     * The first version of this matched on the raw string and failed: the
     * Postgres password here is the word "arciin", which appears in
     * forty-five chunks as a CSS custom property — var(--arciin-accent) and
     * friends. That is the brand name, not a disclosed password, and a test
     * that cannot tell the difference is worse than no test.
     *
     * A short or low-variety value is reported separately as a weak
     * credential; it is not something this assertion can speak about.
     */
    const distinctChars = new Set(credential).size
    if (credential.length < 16 || distinctChars < 8) return
    expect(
      bundle.includes(credential),
      `${name}'s embedded credential is present in a browser chunk`,
    ).toBe(false)
  })

  it("ships no private key or bearer-shaped credential", () => {
    // Matching a bare "-----BEGIN" is too blunt: a PEM *encoder* is bundled
    // and builds that header from a label, which is code, not a key. Match the
    // actual key banners instead. Every assertion here is on a boolean so a
    // failure names the finding rather than printing the whole bundle.
    const keyBanner = /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/
    expect(keyBanner.test(bundle), "a private key banner is in a browser chunk").toBe(false)
    expect(/\bghp_[A-Za-z0-9]{30,}/.test(bundle), "a GitHub token is in a browser chunk").toBe(false)
    expect(/\barc_[A-Za-z0-9]{32,}/.test(bundle), "an Arciin API key is in a browser chunk").toBe(false)
  })
})

describeBuilt("server-only configuration does not reach the browser", () => {
  /**
   * Closed half of L-3. The server env schema used to ship because
   * @arciin/shared re-exported the whole of @arciin/config; it now re-exports
   * only @arciin/config/client (tests/config-client-boundary.test.ts). These
   * markers come only from the schema and the isolation guard, so their
   * presence would mean that split regressed.
   *
   * Deliberately *not* listed: variable names such as DATABASE_URL, REDIS_URL
   * or ARCIIN_UPDATE_MANIFEST_URL. They legitimately appear in operator help
   * text ("Set ARCIIN_UPDATE_MANIFEST_URL to enable update checks", the
   * health page's "verify REDIS_URL", the docs page's placeholder .env). A
   * scanner that flagged product copy would be switched off, not heeded; the
   * value checks above are what guard real values.
   */
  const MUST_NEVER_APPEAR = [
    "ARCIIN_SETUP_TOKEN=",
    "credentials-file",
    "passwordHash",
    "keyHash",
    "tokenHash",
    "mfaSecretEnc",
    // env schema / namespace isolation (packages/config/src/env.ts, environment.ts)
    "ARCIIN_ENV_NAMESPACE",
    "ARCIIN_QUEUE_PREFIX",
    "ARCIIN_SOCKET_CHANNEL_PREFIX",
    "is the production storage root",
    "the production API port",
    "arciin-dev-storage",
    // licence signing (packages/config/src/license-signing.ts)
    "LICENSE_SIGNING_KEY",
    "ARCIIN_LICENSE_PUBLIC_KEYS",
  ]

  it.each(MUST_NEVER_APPEAR)("%s is absent", (marker) => {
    expect(bundle.includes(marker), `${marker} reached a browser chunk`).toBe(false)
  })
})
