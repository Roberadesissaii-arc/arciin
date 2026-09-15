import { describe, expect, it } from "vitest"

import { parseAiSecurityConfig } from "@arciin/config"
import {
  allDesktopToolsWithheld,
  desktopToolRequiresConfirmation,
  sanitizeDesktopToolResultPayload,
  stringLooksLikeWindowsAbsolutePath,
} from "@arciin/shared"

describe("This PC result sanitization", () => {
  it("rejects Windows absolute paths", () => {
    expect(stringLooksLikeWindowsAbsolutePath("C:\\Users\\SomeUser\\Desktop\\file.pdf")).toBe(true)
    expect(stringLooksLikeWindowsAbsolutePath("D:/Interview/resume.pdf")).toBe(true)
    expect(stringLooksLikeWindowsAbsolutePath("\\\\server\\share\\file.pdf")).toBe(true)
    expect(stringLooksLikeWindowsAbsolutePath("Interview/resume.pdf")).toBe(false)
  })

  it("rejects a list result that leaks an absolute path", () => {
    const sanitized = sanitizeDesktopToolResultPayload(
      {
        entries: [
          {
            name: "resume.pdf",
            kind: "file",
            relativePath: "Interview/resume.pdf",
            scopeId: "scope-desk",
            absolutePath: "C:\\Users\\x\\Interview\\resume.pdf",
          },
        ],
      },
      "desktop.list_directory",
    )
    expect(sanitized.ok).toBe(false)
    if (!sanitized.ok) expect(sanitized.code).toBe("DESKTOP_RESULT_INVALID")
  })

  it("rejects file contents", () => {
    const sanitized = sanitizeDesktopToolResultPayload(
      { name: "notes.txt", contents: "hello", scopeId: "s", relativePath: "notes.txt" },
      "desktop.stat_file",
    )
    expect(sanitized.ok).toBe(false)
  })

  it("accepts metadata-only entries", () => {
    const sanitized = sanitizeDesktopToolResultPayload(
      {
        entries: [
          {
            name: "resume.pdf",
            kind: "file",
            relativePath: "Interview/resume.pdf",
            size: 1200,
            modifiedAt: "2026-09-14T00:00:00.000Z",
            scopeId: "scope-desk",
          },
        ],
      },
      "desktop.list_directory",
    )
    expect(sanitized.ok).toBe(true)
  })

  it("rejects oversized payloads", () => {
    const entries = Array.from({ length: 400 }, (_, i) => ({
      name: `file-${i}.txt`,
      kind: "file",
      relativePath: `file-${i}.txt`,
      scopeId: "scope-desk",
      padding: "x".repeat(200),
    }))
    const sanitized = sanitizeDesktopToolResultPayload({ entries }, "desktop.list_directory")
    expect(sanitized.ok).toBe(false)
  })
})

describe("This PC security defaults", () => {
  it("defaults desktop computer access to off", () => {
    expect(parseAiSecurityConfig({}).desktopComputerAccess).toBe("off")
  })

  it("withholds every desktop tool until This PC is enabled", () => {
    const names = [...allDesktopToolsWithheld()]
    expect(names).toContain("desktop.list_directory")
    expect(names).toContain("desktop.upload_file_to_arciin")
    expect(desktopToolRequiresConfirmation("desktop.upload_file_to_arciin")).toBe(true)
    expect(desktopToolRequiresConfirmation("desktop.list_directory")).toBe(false)
  })
})
