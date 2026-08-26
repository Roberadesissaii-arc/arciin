import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import { apiEnvSchema } from "@arciin/config"

/**
 * A fresh install must be able to activate a licence it paid for.
 *
 * ARCIIN_LICENSE_SERVER_URL had no default, and nothing that creates an
 * instance set it — not the one-line installer, not the Docker example. With no
 * authority to ask, activation fell through to the local mock path, which has
 * never heard of a real key, and answered "Unrecognized license key". The key
 * was fine. The instance simply had nowhere to check it.
 *
 * This failed silently and only for paying customers, which is the worst
 * combination available, so it is pinned in three places.
 */

const ROOT = process.cwd()
const INSTALLER = join(ROOT, "../arciin-web/public/install.sh")

describe("an instance knows where to verify a licence", () => {
  it("defaults to the vendor authority when nothing is configured", () => {
    const field = apiEnvSchema.shape.ARCIIN_LICENSE_SERVER_URL
    expect(field.parse(undefined)).toBe("https://license.arciin.com")
  })

  it("treats an empty value as unset rather than as 'no authority'", () => {
    // Compose and shell exports both produce "" for a variable someone left blank.
    const field = apiEnvSchema.shape.ARCIIN_LICENSE_SERVER_URL
    expect(field.parse("")).toBe("https://license.arciin.com")
  })

  it("still lets a self-hoster point somewhere else", () => {
    const field = apiEnvSchema.shape.ARCIIN_LICENSE_SERVER_URL
    expect(field.parse("http://127.0.0.1:4100")).toBe("http://127.0.0.1:4100")
  })

  it("the env examples ship it set, not commented out", () => {
    for (const file of [".env.example", ".env.docker.example"]) {
      const text = readFileSync(join(ROOT, file), "utf8")
      expect(text, `${file} must set it`).toMatch(
        /^ARCIIN_LICENSE_SERVER_URL=https:\/\/license\.arciin\.com$/m,
      )
    }
  })

  it("the one-line installer writes it into the .env it generates", () => {
    // Skipped rather than failed when the sibling repo is not checked out.
    let installer: string
    try {
      installer = readFileSync(INSTALLER, "utf8")
    } catch {
      return
    }
    expect(installer).toContain("ARCIIN_LICENSE_SERVER_URL=https://license.arciin.com")
  })
})
