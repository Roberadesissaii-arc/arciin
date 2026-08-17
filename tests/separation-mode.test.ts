import { describe, expect, it } from "vitest"

import {
  SeparationModeUnavailableError,
  describeDataFlow,
  resolveSeparationBackend,
  type SeparationBackendInfo,
} from "../packages/media-ai/src/separation-mode"

/**
 * Choosing where the separation runs.
 *
 * Separation is the half of a dub that reads the original audio, so the choice
 * between this server and someone else's is a decision about a person's media,
 * not a performance tuning knob. The rule that follows from that — and the only
 * one really worth protecting — is that an explicit choice is never quietly
 * substituted in either direction.
 */

const available = (over: Partial<SeparationBackendInfo> = {}): SeparationBackendInfo => ({
  kind: "local",
  label: "This server",
  available: true,
  ...over,
})

const missing = (over: Partial<SeparationBackendInfo> = {}): SeparationBackendInfo => ({
  kind: "cloud",
  label: "Cloud",
  available: false,
  unavailableReason: "No cloud audio-separation provider is configured.",
  ...over,
})

describe("resolveSeparationBackend", () => {
  it("uses the local separator when Local is chosen", () => {
    const decision = resolveSeparationBackend({
      mode: "local",
      local: available(),
      cloud: missing(),
    })
    expect(decision).toEqual({
      mode: "local",
      kind: "local",
      label: "This server",
      automatic: false,
    })
  })

  it("refuses Cloud when none is configured, instead of running locally", () => {
    /**
     * The important refusal. Someone picks Cloud because their machine is slow;
     * silently running it here means they discover ninety minutes later that
     * nothing they asked for happened.
     */
    expect(() =>
      resolveSeparationBackend({
        mode: "cloud",
        local: available(),
        cloud: missing(),
      }),
    ).toThrow(SeparationModeUnavailableError)

    try {
      resolveSeparationBackend({ mode: "cloud", local: available(), cloud: missing() })
    } catch (error) {
      expect((error as SeparationModeUnavailableError).mode).toBe("cloud")
      expect((error as Error).message).toMatch(/no cloud audio-separation provider/i)
    }
  })

  it("refuses Local when there is no separator, instead of reaching for the cloud", () => {
    /**
     * The mirror image, and the more consequential one: choosing Local is
     * usually a decision about where audio may go, so a cloud fallback would
     * send it exactly where it was being kept from.
     */
    expect(() =>
      resolveSeparationBackend({
        mode: "local",
        local: available({ available: false, unavailableReason: "Not installed." }),
        cloud: available({ kind: "cloud", label: "Provider X" }),
      }),
    ).toThrow(/not installed/i)
  })

  it("lets Auto choose, and says that it did", () => {
    const decision = resolveSeparationBackend({
      mode: "auto",
      local: available(),
      cloud: available({ kind: "cloud", label: "Provider X" }),
    })
    expect(decision.kind).toBe("local")
    expect(decision.automatic).toBe(true)
    // Auto records that it was Auto, so the panel can explain the result.
    expect(decision.mode).toBe("auto")
  })

  it("Auto prefers local, because that is the private option", () => {
    const decision = resolveSeparationBackend({
      mode: "auto",
      local: available(),
      cloud: available({ kind: "cloud", label: "Provider X" }),
    })
    expect(decision.kind).toBe("local")
  })

  it("Auto falls back to cloud only when there is no local separator", () => {
    const decision = resolveSeparationBackend({
      mode: "auto",
      local: available({ available: false }),
      cloud: available({ kind: "cloud", label: "Provider X" }),
    })
    expect(decision.kind).toBe("cloud")
    expect(decision.label).toBe("Provider X")
  })

  it("says so plainly when nothing can separate anything", () => {
    expect(() =>
      resolveSeparationBackend({
        mode: "auto",
        local: available({ available: false }),
        cloud: missing(),
      }),
    ).toThrow(/needs an audio separator/i)
  })
})

describe("describeDataFlow", () => {
  it("states that local separation uploads nothing", () => {
    const flow = describeDataFlow({ kind: "local", label: "This server" })
    expect(flow.separation).toMatch(/stays on this server/i)
    expect(flow.separation).toMatch(/nothing is uploaded/i)
  })

  it("names the provider that receives the audio in cloud mode", () => {
    const flow = describeDataFlow({ kind: "cloud", label: "Provider X" })
    expect(flow.separation).toContain("Provider X")
    expect(flow.separation).toMatch(/source audio is sent/i)
    // And it must not still claim the media stayed here.
    expect(flow.separation).not.toMatch(/stays on this server/i)
  })

  it("keeps the voice provider's line separate and true in both modes", () => {
    /**
     * The two providers have different responsibilities, and merging them is the
     * most consequential vagueness available here: "Local" must never be read as
     * "nothing leaves this server" when the voice model receives text either way.
     */
    for (const kind of ["local", "cloud"] as const) {
      const flow = describeDataFlow({ kind, label: "Provider X" })
      expect(flow.voice).toMatch(/translated text/i)
      expect(flow.voice).toMatch(/never uploaded/i)
    }
  })
})
