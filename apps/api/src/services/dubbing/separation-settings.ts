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

/**
 * Always the same row.
 *
 * There should be exactly one InstanceConfig, but nothing enforces that, and an
 * unordered `findFirst` may return a *different* row after an update — Postgres
 * is free to move a row on write. That turned a read-modify-write into reading
 * one row and writing another, which showed up as a connection that saved
 * successfully and then read back as unconfigured.
 */
const INSTANCE_ROW = { orderBy: { createdAt: "asc" } } as const

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
  const instance = await prisma.instanceConfig.findFirst({ ...INSTANCE_ROW, select: { dubbingConfig: true } })
  return readDubbingSettings(instance?.dubbingConfig)
}

export async function saveSeparationMode(
  prisma: PrismaClient,
  mode: SeparationMode,
): Promise<DubbingSettings> {
  const instance = await prisma.instanceConfig.findFirst({
    ...INSTANCE_ROW,
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

function describeCloud(
  runpod: { configured: boolean; healthy?: boolean | null } | null | undefined,
  settings: DubbingSettings,
): SeparationBackendInfo {
  if (runpod?.configured) {
    /**
     * A connection that has never passed its test is offered anyway.
     *
     * Refusing it would leave someone who has just entered their details unable
     * to use them until they remember to press Test — and the dub request runs
     * the same checks regardless, so a broken connection still fails safely
     * rather than silently running locally.
     */
    return {
      kind: "cloud",
      label: "RunPod GPU",
      available: true,
      ...(runpod.healthy === false
        ? { unavailableReason: "The last connection test failed. Test it again in Settings." }
        : {}),
    }
  }

  // A generic provider entry, kept for whatever comes after RunPod.
  if (settings.cloud?.configured) {
    return { kind: "cloud", label: settings.cloud.label, available: true }
  }

  return {
    kind: "cloud",
    label: settings.cloud?.label ?? "Cloud",
    available: false,
    unavailableReason: "No cloud audio-separation provider is configured.",
  }
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
  /**
   * The real provider connection, when one is configured.
   *
   * Availability is decided here so the panel, the dub request and the worker
   * cannot disagree about whether Cloud is usable — three places deciding that
   * independently is exactly how a reader ends up offered an option that fails
   * an hour later.
   */
  runpod?: { configured: boolean; healthy?: boolean | null } | null
}): { local: SeparationBackendInfo; cloud: SeparationBackendInfo } {
  const { settings, localAvailable, runpod } = input

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
    cloud: describeCloud(runpod, settings),
  }
}
