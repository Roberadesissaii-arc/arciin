import type { PrismaClient } from "@prisma/client"

import {
  isSeparationMode,
  type SeparationBackendInfo,
  type SeparationMode,
} from "@arciin/media-ai"

/**
 * What this instance knows about where separation can run.
 *
 * Read here rather than in the route so the panel, the dub request and the
 * worker all answer the same question the same way — "is Cloud actually
 * available" is exactly the sort of thing that goes wrong when three places
 * decide it independently.
 *
 * The preference lives on `InstanceConfig` rather than on a user, because the
 * separator is a property of the machine: whether a local one is installed, and
 * which external service this server may send audio to, are decisions about the
 * server and not about whoever happens to be logged in.
 */

export type CloudSeparationConfig = {
  /** Identifier for the implementation. */
  provider: string
  /** Shown to a person. */
  label: string
  /** Present only when someone has actually set it up. */
  configured: boolean
}

export type DubbingSettings = {
  /** The remembered default. Auto until someone changes it. */
  separationMode: SeparationMode
  cloud: CloudSeparationConfig | null
}

const DEFAULTS: DubbingSettings = { separationMode: "auto", cloud: null }

export function readDubbingSettings(raw: unknown): DubbingSettings {
  if (!raw || typeof raw !== "object") return DEFAULTS
  const config = raw as Record<string, unknown>

  const mode = isSeparationMode(config.separationMode) ? config.separationMode : "auto"

  const cloudRaw = config.cloudSeparation
  let cloud: CloudSeparationConfig | null = null
  if (cloudRaw && typeof cloudRaw === "object") {
    const entry = cloudRaw as Record<string, unknown>
    const provider = typeof entry.provider === "string" ? entry.provider : ""
    if (provider) {
      cloud = {
        provider,
        label: typeof entry.label === "string" && entry.label ? entry.label : provider,
        /**
         * Configured means usable, not merely named.
         *
         * A half-filled provider entry must not make Cloud selectable — the one
         * thing worse than having no cloud option is offering one that fails
         * after the reader has waited for it.
         */
        configured: entry.configured === true && typeof entry.credentialRef === "string",
      }
    }
  }

  return { separationMode: mode, cloud }
}

export async function loadDubbingSettings(prisma: PrismaClient): Promise<DubbingSettings> {
  const instance = await prisma.instanceConfig.findFirst({ select: { dubbingConfig: true } })
  return readDubbingSettings(instance?.dubbingConfig)
}

export async function saveSeparationMode(
  prisma: PrismaClient,
  mode: SeparationMode,
): Promise<DubbingSettings> {
  const instance = await prisma.instanceConfig.findFirst({
    select: { id: true, dubbingConfig: true },
  })
  if (!instance) return DEFAULTS

  const current =
    instance.dubbingConfig && typeof instance.dubbingConfig === "object"
      ? (instance.dubbingConfig as Record<string, unknown>)
      : {}

  const updated = await prisma.instanceConfig.update({
    where: { id: instance.id },
    // Merged rather than replaced: the cloud provider entry lives in the same
    // object and must survive someone changing the mode.
    data: { dubbingConfig: { ...current, separationMode: mode } },
    select: { dubbingConfig: true },
  })
  return readDubbingSettings(updated.dubbingConfig)
}

/**
 * The two backends, as the UI needs to describe them.
 *
 * `localAvailable` is passed in rather than probed here because probing means
 * touching the filesystem, and the caller usually already knows.
 */
export function describeBackends(input: {
  settings: DubbingSettings
  localAvailable: boolean
}): { local: SeparationBackendInfo; cloud: SeparationBackendInfo } {
  const { settings, localAvailable } = input

  return {
    local: {
      kind: "local",
      label: "This server",
      available: localAvailable,
      ...(localAvailable
        ? {}
        : {
            unavailableReason:
              "No local audio separator is installed on this server. See docs/DUBBING.md.",
          }),
      // Named in technical details only — a reader choosing where their audio
      // goes does not need to know about instruction sets.
      engine: "Demucs",
      compute: "CPU",
    },
    cloud: settings.cloud?.configured
      ? { kind: "cloud", label: settings.cloud.label, available: true }
      : {
          kind: "cloud",
          label: settings.cloud?.label ?? "Cloud",
          available: false,
          unavailableReason: "No cloud audio-separation provider is configured.",
        },
  }
}
