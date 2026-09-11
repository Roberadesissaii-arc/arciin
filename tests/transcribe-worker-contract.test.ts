import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

/**
 * ARC-005 / ARC-010 contract: the transcribe job talks to the shared provider
 * and re-checks the trusted licence before any Gemini work.
 */

const HANDLERS = readFileSync(
  join(process.cwd(), "apps/worker/src/processors/worker-handlers.ts"),
  "utf8",
)
const PROVIDER = readFileSync(
  join(process.cwd(), "packages/media-ai/src/gemini-media-provider.ts"),
  "utf8",
)

describe("transcribe_media worker contract", () => {
  it("runs the shared transcribeMedia provider rather than a local copy", () => {
    expect(HANDLERS).toContain('JOB_TYPES.transcribeMedia')
    expect(HANDLERS).toContain("transcribeMedia(")
    expect(HANDLERS).toContain("@arciin/media-ai")
  })

  it("refuses a paid transcript before the provider is imported on a license miss", () => {
    const entitlementAt = HANDLERS.indexOf("assertPaidJobEntitlement")
    const providerImportAt = HANDLERS.indexOf('await import("@arciin/media-ai")')
    expect(entitlementAt).toBeGreaterThan(-1)
    expect(providerImportAt).toBeGreaterThan(entitlementAt)
  })

  it("records LICENSE_REQUIRED as a terminal job failure instead of throwing", () => {
    expect(HANDLERS).toContain("LICENSE_REQUIRED_CODE")
    expect(HANDLERS).toContain('status: "FAILED"')
    expect(HANDLERS).toContain("isLicenseRequiredError")
  })

  it("does not cast a ReadStream to Blob for the Files API", () => {
    expect(PROVIDER).not.toContain("createReadStream")
    expect(PROVIDER).not.toContain("as unknown as Blob")
    expect(PROVIDER).toContain("file: transport.file")
  })

  it("announces processing so the card can leave a failed state", () => {
    expect(HANDLERS).toContain('createRealtimeEvent("asset.transcript.updated"')
  })
})
