import { describe, expect, it, vi } from "vitest"

import {
  ARCIIN_NATIVE_ACTIONS,
  ARCIIN_NATIVE_MESSAGE_TYPE,
  ARCIIN_NATIVE_PROTOCOL_VERSION,
  OPEN_COMPUTER_BACKUP_SETUP,
  createComputerBackupSetupAction,
  nativeMessageHasSecrets,
  requestNativeComputerBackupSetup,
} from "@arciin/shared"

describe("Arciin Desktop native bridge", () => {
  it("emits only the allowlisted computer-backup intent", () => {
    const message = createComputerBackupSetupAction()
    expect(message).toEqual({
      type: ARCIIN_NATIVE_MESSAGE_TYPE,
      version: ARCIIN_NATIVE_PROTOCOL_VERSION,
      action: OPEN_COMPUTER_BACKUP_SETUP,
    })
    expect(ARCIIN_NATIVE_ACTIONS).toEqual([OPEN_COMPUTER_BACKUP_SETUP])
    expect(nativeMessageHasSecrets(message)).toBe(false)
    expect(JSON.stringify(message)).not.toMatch(/credential|cookie|token|path|password/i)
  })

  it("does not introduce unknown native actions", () => {
    expect(ARCIIN_NATIVE_ACTIONS).toHaveLength(1)
    expect(createComputerBackupSetupAction().action).toBe("OPEN_COMPUTER_BACKUP_SETUP")
  })

  it("posts the intent when a WebView2 bridge exists", () => {
    const postMessage = vi.fn()
    vi.stubGlobal("window", { chrome: { webview: { postMessage } } })
    expect(requestNativeComputerBackupSetup()).toBe(true)
    expect(postMessage).toHaveBeenCalledTimes(1)
    expect(postMessage).toHaveBeenCalledWith(createComputerBackupSetupAction())
    vi.unstubAllGlobals()
  })

  it("falls back without throwing when no WebView2 bridge exists", () => {
    vi.stubGlobal("window", {})
    expect(requestNativeComputerBackupSetup()).toBe(false)
    vi.unstubAllGlobals()
  })
})
