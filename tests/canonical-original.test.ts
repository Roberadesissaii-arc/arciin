import { describe, expect, it } from "vitest"

import { canonicalOriginalIsUsable } from "@arciin/shared"

describe("canonicalOriginalIsUsable", () => {
  it("rejects a missing path", () => {
    expect(
      canonicalOriginalIsUsable({ exists: false, isFile: false, sizeBytes: 0 }, 100),
    ).toBe(false)
  })

  it("rejects a directory or empty placeholder", () => {
    expect(
      canonicalOriginalIsUsable({ exists: true, isFile: false, sizeBytes: 100 }, 100),
    ).toBe(false)
    expect(
      canonicalOriginalIsUsable({ exists: true, isFile: true, sizeBytes: 0 }, 100),
    ).toBe(false)
  })

  it("accepts a file whose size matches the upload", () => {
    expect(
      canonicalOriginalIsUsable({ exists: true, isFile: true, sizeBytes: 1232143 }, 1232143),
    ).toBe(true)
  })

  it("rejects a size mismatch so a truncated leftover is not reused", () => {
    expect(
      canonicalOriginalIsUsable({ exists: true, isFile: true, sizeBytes: 12 }, 1232143),
    ).toBe(false)
  })
})
