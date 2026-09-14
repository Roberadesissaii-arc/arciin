import { describe, expect, it, vi } from "vitest"

import {
  ARCIIN_NATIVE_BACKUP_SETUP_URL,
  COMPUTER_BACKUP_BROWSER_HINT,
  COMPUTER_BACKUP_DESKTOP_HINT,
  computerBackupEmptyHint,
  isArciinDesktopWebView,
  requestNativeComputerBackupSetup,
} from "@arciin/shared"

describe("Arciin Desktop native backup sentinel", () => {
  it("is exactly arciin-native://backup/setup with no extras", () => {
    expect(ARCIIN_NATIVE_BACKUP_SETUP_URL).toBe("arciin-native://backup/setup")
    expect(ARCIIN_NATIVE_BACKUP_SETUP_URL).not.toMatch(/[?#@]/)
    expect(ARCIIN_NATIVE_BACKUP_SETUP_URL).not.toMatch(/credential|cookie|token|password/i)
    expect(ARCIIN_NATIVE_BACKUP_SETUP_URL).not.toMatch(/[A-Za-z]:\\|\/home\/|\/Users\/|\\\\/)
    const parsed = new URL(ARCIIN_NATIVE_BACKUP_SETUP_URL)
    expect(parsed.protocol).toBe("arciin-native:")
    expect(parsed.hostname).toBe("backup")
    expect(parsed.pathname).toBe("/setup")
    expect(parsed.search).toBe("")
    expect(parsed.hash).toBe("")
    expect(parsed.username).toBe("")
    expect(parsed.password).toBe("")
    expect(parsed.port).toBe("")
  })

  it("does not accept arbitrary URLs or actions", () => {
    expect(requestNativeComputerBackupSetup.length).toBe(0)
    const assign = vi.fn()
    vi.stubGlobal("window", {
      chrome: { webview: {} },
      location: { assign },
    })
    const spoofed = requestNativeComputerBackupSetup as (input?: unknown) => boolean
    expect(spoofed("arciin-native://backup/other")).toBe(true)
    expect(spoofed({ action: "SHELL", url: "https://evil.example" })).toBe(true)
    expect(assign.mock.calls).toEqual([
      [ARCIIN_NATIVE_BACKUP_SETUP_URL],
      [ARCIIN_NATIVE_BACKUP_SETUP_URL],
    ])
    vi.unstubAllGlobals()
  })

  it("navigates to the sentinel inside Arciin Desktop", () => {
    const assign = vi.fn()
    vi.stubGlobal("window", {
      chrome: { webview: {} },
      location: { assign },
    })
    expect(isArciinDesktopWebView()).toBe(true)
    expect(requestNativeComputerBackupSetup()).toBe(true)
    expect(assign).toHaveBeenCalledTimes(1)
    expect(assign).toHaveBeenCalledWith("arciin-native://backup/setup")
    expect(
      (window as Window & { __arciinNativeBackupSetupIntent?: string }).__arciinNativeBackupSetupIntent,
    ).toBe(ARCIIN_NATIVE_BACKUP_SETUP_URL)
    expect(assign).not.toHaveBeenCalledWith(expect.stringMatching(/postMessage|OPEN_COMPUTER_BACKUP_SETUP/))
    vi.unstubAllGlobals()
  })

  it("returns false in a normal browser and does not navigate", () => {
    const assign = vi.fn()
    vi.stubGlobal("window", { location: { assign } })
    expect(isArciinDesktopWebView()).toBe(false)
    expect(requestNativeComputerBackupSetup()).toBe(false)
    expect(assign).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it("uses Desktop copy inside WebView and Desktop-required copy in a browser", () => {
    expect(computerBackupEmptyHint(true)).toBe(COMPUTER_BACKUP_DESKTOP_HINT)
    expect(computerBackupEmptyHint(true)).not.toMatch(/Open Arciin Desktop/)
    expect(computerBackupEmptyHint(false)).toBe(COMPUTER_BACKUP_BROWSER_HINT)
    expect(computerBackupEmptyHint(false)).toContain("Open Arciin Desktop")
  })
})
