import { readFileSync } from "node:fs"
import path from "node:path"

import { afterEach, describe, expect, it, vi } from "vitest"

import {
  createInstallPromptController,
  INSTALL_DISMISS_KEY,
  isInstallPromptDismissed,
  persistInstallPromptDismissal,
  type DismissMemory,
  type InstallPromptState,
} from "@/lib/pwa/install-prompt"

/**
 * v1.1.1 acceptance: "Install Arciin" came back on page after page.
 *
 * The prompt lives in the app providers and stays mounted across navigation.
 * It checked the dismissal once, at mount, and Chrome fires
 * `beforeinstallprompt` again later in the same page — every later event
 * re-opened it. These tests drive the controller the component wires to those
 * events, the way the browser does.
 */

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial))
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  }
}

function installEvent() {
  const event = new Event("beforeinstallprompt", { cancelable: true }) as Event & {
    prompt: () => Promise<void>
    userChoice: Promise<{ outcome: "accepted" | "dismissed" }>
  }
  event.prompt = async () => {}
  event.userChoice = Promise.resolve({ outcome: "dismissed" })
  return event
}

/** One mounted prompt: the state it would render, and the handlers. */
function mount(options: {
  storage?: ReturnType<typeof memoryStorage> | null | { getItem: () => never; setItem: () => never }
  memory?: DismissMemory
  standalone?: boolean
} = {}) {
  let state: InstallPromptState = { visible: false, deferred: null }
  const controller = createInstallPromptController({
    onChange: (next) => {
      state = next
    },
    storage: options.storage === undefined ? memoryStorage() : options.storage,
    memory: options.memory ?? { dismissed: false },
    isStandalone: () => options.standalone ?? false,
  })
  return { controller, state: () => state }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("the install prompt", () => {
  it("shows on the first eligible install event and holds the event", () => {
    const { controller, state } = mount()
    const event = installEvent()
    controller.handleBeforeInstall(event)
    expect(state().visible).toBe(true)
    expect(state().deferred).toBe(event)
    expect(event.defaultPrevented).toBe(true)
  })

  it("dismissing hides it, drops the held event and persists the choice", () => {
    const storage = memoryStorage()
    const { controller, state } = mount({ storage })
    controller.handleBeforeInstall(installEvent())
    controller.dismiss()
    expect(state()).toEqual({ visible: false, deferred: null })
    expect(storage.data.get(INSTALL_DISMISS_KEY)).toBe("1")
  })

  it("wires both X and Not now to the same dismissal", () => {
    const source = readFileSync(
      path.resolve(__dirname, "../apps/web/components/providers/install-app-prompt.tsx"),
      "utf8",
    )
    const dismissButtons = source.match(/onClick=\{dismiss\}/g) ?? []
    expect(dismissButtons).toHaveLength(2)
    expect(source).toContain('aria-label="Dismiss"')
    expect(source).toContain("Not now")
  })

  it("does not reopen when the browser fires the event again in the same page", () => {
    const { controller, state } = mount()
    controller.handleBeforeInstall(installEvent())
    controller.dismiss()

    const again = installEvent()
    controller.handleBeforeInstall(again)
    expect(state()).toEqual({ visible: false, deferred: null })
    // Still suppressed: no mini-infobar in its place.
    expect(again.defaultPrevented).toBe(true)
  })

  it("stays dismissed after navigation or a remount, from storage alone", () => {
    const storage = memoryStorage()
    const first = mount({ storage })
    first.controller.handleBeforeInstall(installEvent())
    first.controller.dismiss()

    // A reload: fresh page memory, same origin storage.
    const second = mount({ storage, memory: { dismissed: false } })
    second.controller.handleBeforeInstall(installEvent())
    expect(second.state().visible).toBe(false)
    expect(second.state().deferred).toBeNull()
  })

  it("never shows when a dismissal is already stored", () => {
    const { controller, state } = mount({ storage: memoryStorage({ [INSTALL_DISMISS_KEY]: "1" }) })
    controller.handleBeforeInstall(installEvent())
    expect(state().visible).toBe(false)
  })

  it("hides and forgets the event once the app is installed", () => {
    const { controller, state } = mount()
    controller.handleBeforeInstall(installEvent())
    controller.handleInstalled()
    expect(state()).toEqual({ visible: false, deferred: null })
  })

  it("never shows inside the installed app", () => {
    const { controller, state } = mount({ standalone: true })
    controller.handleBeforeInstall(installEvent())
    expect(state()).toEqual({ visible: false, deferred: null })
  })
})

describe("when browser storage misbehaves", () => {
  const throwing = {
    getItem: (): never => {
      throw new DOMException("blocked", "SecurityError")
    },
    setItem: (): never => {
      throw new DOMException("quota", "QuotaExceededError")
    },
  }

  it("a failing read does not crash and still offers the install once", () => {
    const { controller, state } = mount({ storage: throwing })
    expect(() => controller.handleBeforeInstall(installEvent())).not.toThrow()
    expect(state().visible).toBe(true)
  })

  it("a failing write does not let the next event reopen it", () => {
    const memory = { dismissed: false }
    const { controller, state } = mount({ storage: throwing, memory })
    controller.handleBeforeInstall(installEvent())
    expect(() => controller.dismiss()).not.toThrow()

    controller.handleBeforeInstall(installEvent())
    expect(state().visible).toBe(false)

    // A remount in the same page load shares that memory.
    const remounted = mount({ storage: throwing, memory })
    remounted.controller.handleBeforeInstall(installEvent())
    expect(remounted.state().visible).toBe(false)
  })

  it("survives window.localStorage itself throwing when touched", () => {
    const hostile = {}
    Object.defineProperty(hostile, "localStorage", {
      get() {
        throw new DOMException("denied", "SecurityError")
      },
    })
    vi.stubGlobal("window", hostile)
    const memory = { dismissed: false }
    expect(() => isInstallPromptDismissed(undefined, memory)).not.toThrow()
    expect(isInstallPromptDismissed(undefined, memory)).toBe(false)
    expect(() => persistInstallPromptDismissal(undefined, memory)).not.toThrow()
    expect(isInstallPromptDismissed(undefined, memory)).toBe(true)
  })

  it("has no storage at all during server rendering", () => {
    expect(isInstallPromptDismissed(null, { dismissed: false })).toBe(false)
  })
})
