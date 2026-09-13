import { describe, expect, it } from "vitest"

import {
  BackupPathError,
  isBackupPathInside,
  normalizeBackupRelativePath,
} from "@arciin/shared"
import { libraryAcceptsMediaType } from "@arciin/shared"
import { ARCIIN_COMPUTER_BACKUP_PROTOCOL_VERSION, ARCIIN_DEVICE_PROTOCOL_VERSION } from "@arciin/config"

describe("computer backup path rules", () => {
  it("normalizes Windows separators without treating them as host paths", () => {
    expect(normalizeBackupRelativePath("WebProject\\public\\logo.png")).toBe(
      "WebProject/public/logo.png",
    )
  })

  it("rejects traversal and absolute paths", () => {
    expect(() => normalizeBackupRelativePath("..\\secret")).toThrow(/Parent-directory/)
    expect(() => normalizeBackupRelativePath("C:\\\\Users\\\\Robera\\\\Desktop")).toThrow(/Absolute/)
    expect(() => normalizeBackupRelativePath("/etc/passwd")).toThrow(/Absolute/)
    expect(() => normalizeBackupRelativePath("\\\\server\\share")).toThrow(/Absolute/)
  })

  it("rejects reserved names and overlong input", () => {
    expect(() => normalizeBackupRelativePath("CON")).toThrow(BackupPathError)
    expect(() => normalizeBackupRelativePath("a".repeat(2000))).toThrow(BackupPathError)
  })

  it("keeps project children inside the root", () => {
    expect(isBackupPathInside("WebProject/public/logo.png", "WebProject")).toBe(true)
    expect(isBackupPathInside("other/logo.png", "WebProject")).toBe(false)
  })
})

describe("computer backup does not change pairing", () => {
  it("keeps pairing protocol at 1", () => {
    expect(ARCIIN_DEVICE_PROTOCOL_VERSION).toBe(1)
    expect(ARCIIN_COMPUTER_BACKUP_PROTOCOL_VERSION).toBe(1)
  })

  it("lets the Computers library accept any media type so trees are not rerouted", () => {
    expect(libraryAcceptsMediaType("COMPUTER", "IMAGE")).toBe(true)
    expect(libraryAcceptsMediaType("COMPUTER", "VIDEO")).toBe(true)
    expect(libraryAcceptsMediaType("COMPUTER", "DOCUMENT")).toBe(true)
    expect(libraryAcceptsMediaType("COMPUTER", "CODE")).toBe(true)
  })
})
