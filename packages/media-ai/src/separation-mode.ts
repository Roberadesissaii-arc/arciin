export {
  appendSample,
  estimateRemaining,
  formatRemaining,
  smoothedSecondsPerChunk,
  MIN_SAMPLES_FOR_ETA,
  MAX_SAMPLES,
  type ProgressSample,
  type EtaEstimate,
} from "@arciin/types"

/**
 * Where the heavy separation runs, and who is allowed to decide.
 *
 * Splitting dialogue from background is the expensive half of a dub — ninety
 * minutes of CPU for a twelve-minute file on this hardware — and it is also the
 * half that reads the original audio. Those two facts pull in opposite
 * directions: sending it to a cloud service makes it fast, and makes it leave
 * the building. That is a decision about someone's own media, so it is theirs.
 *
 * Deliberately *not* about the voice model. Text and performance direction go to
 * a TTS provider either way; this setting governs the separator alone, and the
 * UI states both independently so "local" can never be read as "nothing leaves".
 */

export type SeparationMode = "auto" | "local" | "cloud"

export const SEPARATION_MODES: SeparationMode[] = ["auto", "local", "cloud"]

export function isSeparationMode(value: unknown): value is SeparationMode {
  return typeof value === "string" && (SEPARATION_MODES as string[]).includes(value)
}

/** What each backend can tell the UI about itself. */
export type SeparationBackendInfo = {
  kind: "local" | "cloud"
  /** Shown to a person: "This server", or the provider's name. */
  label: string
  available: boolean
  /** Why not, when it is not. Never a stack trace. */
  unavailableReason?: string
  /** For a technical-details line: "Demucs", "CPU". */
  engine?: string
  compute?: string
}

/**
 * Chosen backend, plus why — so the panel can explain itself and a job can
 * record what actually happened rather than what was asked for.
 */
export type SeparationDecision = {
  mode: SeparationMode
  kind: "local" | "cloud"
  label: string
  /** True when Auto picked this rather than the reader naming it. */
  automatic: boolean
}

export class SeparationModeUnavailableError extends Error {
  readonly mode: SeparationMode
  constructor(mode: SeparationMode, message: string) {
    super(message)
    this.name = "SeparationModeUnavailableError"
    this.mode = mode
  }
}

/**
 * Which backend a request should use.
 *
 * The one rule that matters: an explicit choice is never quietly overridden. If
 * someone picks Cloud because their machine is slow, silently running it locally
 * for ninety minutes is not a helpful fallback — it is the opposite of what they
 * asked for, discovered an hour later. The same in reverse: picking Local is
 * often a privacy decision, and falling back to a cloud provider would send
 * audio somewhere they deliberately kept it from.
 *
 * Auto is allowed to choose, because choosing is what it means.
 */
export function resolveSeparationBackend(input: {
  mode: SeparationMode
  local: SeparationBackendInfo
  cloud: SeparationBackendInfo
}): SeparationDecision {
  const { mode, local, cloud } = input

  if (mode === "local") {
    if (!local.available) {
      throw new SeparationModeUnavailableError(
        "local",
        local.unavailableReason ??
          "This server has no local audio separator installed. See docs/DUBBING.md.",
      )
    }
    return { mode, kind: "local", label: local.label, automatic: false }
  }

  if (mode === "cloud") {
    if (!cloud.available) {
      throw new SeparationModeUnavailableError(
        "cloud",
        cloud.unavailableReason ??
          "No cloud audio-separation provider is configured. Add one in Settings, or choose Local.",
      )
    }
    return { mode, kind: "cloud", label: cloud.label, automatic: false }
  }

  /**
   * Auto, kept deliberately simple for now.
   *
   * Local first when it exists: it is the private option and the one that needs
   * no account, which is the right default for a self-hosted instance. Cloud is
   * what Auto reaches for only when there is no local separator at all — a
   * cleverer rule (long media to the cloud, short media local) needs timing data
   * this instance does not yet have, and guessing would make Auto unpredictable.
   */
  if (local.available) {
    return { mode, kind: "local", label: local.label, automatic: true }
  }
  if (cloud.available) {
    return { mode, kind: "cloud", label: cloud.label, automatic: true }
  }
  throw new SeparationModeUnavailableError(
    "auto",
    "Dubbing needs an audio separator so the original music and ambience can be kept. " +
      "Install one on this server (see docs/DUBBING.md) or configure a cloud provider.",
  )
}

/**
 * Exactly what leaves the instance, for the disclosure the panel shows.
 *
 * Written per backend rather than assembled from flags, because the honest
 * sentence differs in kind and not only in wording: with a local separator the
 * media genuinely does not leave, and with a cloud one the source audio does.
 * Blurring those into one paragraph would be the most consequential vagueness in
 * the whole feature.
 */
export function describeDataFlow(decision: {
  kind: "local" | "cloud"
  label: string
}): { separation: string; voice: string } {
  return {
    separation:
      decision.kind === "local"
        ? "Local — the source media stays on this server. Nothing is uploaded to separate it."
        : `Cloud — the source audio is sent to ${decision.label} to be separated.`,
    voice:
      "The translated text and the voice directions are sent to the voice provider. " +
      "The original recording is never uploaded to it.",
  }
}
