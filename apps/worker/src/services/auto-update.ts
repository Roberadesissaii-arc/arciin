import { existsSync } from "node:fs"

import { execa } from "execa"
import type Redis from "ioredis"
import type { Prisma } from "@prisma/client"

import { APP_VERSION } from "@arciin/config"
import { prisma } from "@arciin/database"
import { JOB_TYPES, parseAutoUpdateConfig, type AutoUpdateConfig } from "@arciin/shared"

import { workerConfig } from "@/config"
import { assertPaidJobEntitlement, isLicenseRequiredError } from "@/services/entitlement"
import { createRealtimeEvent, publishRealtimeEvent } from "@/services/realtime"

async function updateAutoUpdateConfig(patch: Partial<AutoUpdateConfig>): Promise<AutoUpdateConfig> {
  const instance = await prisma.instanceConfig.findFirst()
  if (!instance) throw new Error("Instance not initialized")
  const current = parseAutoUpdateConfig(instance.autoUpdateConfig)
  const next: AutoUpdateConfig = { ...current, ...patch }
  await prisma.instanceConfig.update({
    where: { id: instance.id },
    data: { autoUpdateConfig: next as unknown as Prisma.InputJsonValue },
  })
  return next
}

/** Same convention as `/.dockerenv` checks elsewhere in the API — no cross-app import needed for one check. */
function isDockerRuntime(): boolean {
  return existsSync("/.dockerenv")
}

type UpdateManifest = { latest: string; channel?: string }

function isNewerVersion(latest: string, current: string): boolean {
  const a = latest.split(".").map((p) => parseInt(p, 10))
  const b = current.split(".").map((p) => parseInt(p, 10))
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const av = a[i] ?? 0
    const bv = b[i] ?? 0
    if (Number.isNaN(av) || Number.isNaN(bv)) continue
    if (av !== bv) return av > bv
  }
  return false
}

/** Lightweight one-off check — the hourly scheduler doesn't need the API's polling cache. */
async function fetchLatestVersionIfNewer(): Promise<string | null> {
  const manifestUrl = workerConfig.ARCIIN_UPDATE_MANIFEST_URL
  if (!manifestUrl) return null

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)
    const res = await fetch(manifestUrl, { signal: controller.signal })
    clearTimeout(timeout)
    if (!res.ok) return null
    const manifest = (await res.json()) as UpdateManifest
    if (!manifest.latest || typeof manifest.latest !== "string") return null
    return isNewerVersion(manifest.latest, APP_VERSION) ? manifest.latest : null
  } catch {
    return null
  }
}

/**
 * Called roughly hourly by the worker's scheduler. Stages the latest version
 * once per local hour window if auto-update is enabled, an update exists,
 * and nothing is already staged for that version.
 */
export async function maybeRunScheduledStage(redis: Redis): Promise<void> {
  const instance = await prisma.instanceConfig.findFirst()
  if (!instance) return

  try {
    await assertPaidJobEntitlement(prisma, JOB_TYPES.stageUpdate)
  } catch (error) {
    if (isLicenseRequiredError(error)) return
    throw error
  }

  const config = parseAutoUpdateConfig(instance.autoUpdateConfig)
  if (!config.enabled || config.hour === null) return

  const currentHour = new Date().getHours()
  if (currentHour !== config.hour) return

  const latest = await fetchLatestVersionIfNewer()
  if (!latest) {
    await updateAutoUpdateConfig({ lastCheckedAt: new Date().toISOString() })
    return
  }

  if (config.stagedVersion === latest) return // already staged this exact version

  await runStageUpdate(latest, redis)
}

async function notify(redis: Redis, input: { type: string; title: string; message: string }) {
  await prisma.activityEvent.create({
    data: { type: input.type, title: input.title, message: input.message },
  })
  await publishRealtimeEvent(
    redis,
    createRealtimeEvent("activity.created", {
      message: input.message,
      data: { type: input.type, title: input.title },
    }),
  )
}

function truncateLog(lines: string[]): string {
  return lines.join("\n").slice(-4000)
}

async function stageNative(log: string[]): Promise<void> {
  const cwd = process.cwd()
  const steps: [string, string[]][] = [
    ["git", ["pull", "--ff-only", "origin", "main"]],
    ["pnpm", ["install", "--frozen-lockfile"]],
    ["pnpm", ["db:generate"]],
    ["pnpm", ["build:web"]],
    ["pnpm", ["build:api"]],
    ["pnpm", ["build:worker"]],
  ]

  for (const [cmd, args] of steps) {
    log.push(`$ ${cmd} ${args.join(" ")}`)
    try {
      const result = await execa(cmd, args, { cwd, timeout: 15 * 60_000 })
      if (result.stdout) log.push(result.stdout)
    } catch (err) {
      const stderr = err && typeof err === "object" && "stderr" in err ? String(err.stderr) : ""
      log.push(stderr)
      throw new Error(`${cmd} ${args.join(" ")} failed`)
    }
  }
}

async function stageDocker(log: string[]): Promise<void> {
  const cwd = process.cwd()
  log.push("$ docker compose pull")
  try {
    const result = await execa(
      "docker",
      ["compose", "-f", "docker-compose.production.yml", "--env-file", ".env", "pull"],
      { cwd, timeout: 15 * 60_000 },
    )
    if (result.stdout) log.push(result.stdout)
  } catch (err) {
    const stderr = err && typeof err === "object" && "stderr" in err ? String(err.stderr) : ""
    log.push(stderr)
    throw new Error("docker compose pull failed")
  }
}

async function applyNative(): Promise<void> {
  await execa("pm2", ["restart", "arciin-web", "arciin-api", "arciin-worker"], { timeout: 60_000 })
}

async function applyDocker(): Promise<void> {
  const cwd = process.cwd()
  await execa(
    "docker",
    ["compose", "-f", "docker-compose.production.yml", "--env-file", ".env", "up", "-d"],
    { cwd, timeout: 5 * 60_000 },
  )
}

/**
 * Downloads/builds the target version without touching the running services.
 * Never restarts anything — the user always applies staged updates by hand
 * (Settings -> Updates -> Apply now) or via the separate applyUpdate job.
 */
export async function runStageUpdate(targetVersion: string, redis: Redis): Promise<{ success: boolean }> {
  const log: string[] = []
  const now = new Date().toISOString()

  try {
    if (isDockerRuntime()) {
      await stageDocker(log)
    } else {
      await stageNative(log)
    }

    await updateAutoUpdateConfig({
      stagedVersion: targetVersion,
      stagedAt: now,
      lastCheckedAt: now,
      lastError: null,
    })

    await notify(redis, {
      type: "instance.update.staged",
      title: "Update staged",
      message: `v${targetVersion} is downloaded and ready. Apply it from Settings -> Updates when you're ready — nothing has changed yet.`,
    })
    return { success: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Stage failed"
    const tail = truncateLog(log)
    await updateAutoUpdateConfig({
      lastCheckedAt: now,
      lastError: tail ? `${message}\n\n${tail}`.slice(-4000) : message,
    })
    await notify(redis, {
      type: "instance.update.stage_failed",
      title: "Automatic update failed to stage",
      message: `Could not prepare v${targetVersion}: ${message}`,
    })
    return { success: false }
  }
}

/** Restarts services to switch to the already-staged version. User-triggered only. */
export async function runApplyUpdate(redis: Redis): Promise<{ success: boolean }> {
  const instance = await prisma.instanceConfig.findFirst()
  const current = parseAutoUpdateConfig(instance?.autoUpdateConfig)
  if (!current.stagedVersion) {
    return { success: false }
  }

  await notify(redis, {
    type: "instance.update.applying",
    title: "Applying update",
    message: `Restarting services to apply v${current.stagedVersion}...`,
  })

  // Clear staged state before restarting: if the restart fails partway, the
  // instance shouldn't keep reporting a "ready to apply" version that a
  // previous attempt already tried (and may have partially applied).
  await updateAutoUpdateConfig({ stagedVersion: null, stagedAt: null, lastError: null })

  try {
    if (isDockerRuntime()) {
      await applyDocker()
    } else {
      await applyNative()
    }
    return { success: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Apply failed"
    await updateAutoUpdateConfig({ lastError: message })
    return { success: false }
  }
}
