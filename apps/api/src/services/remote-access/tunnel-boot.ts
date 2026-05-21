import { execFile } from "node:child_process"
import { promisify } from "node:util"

import type { FastifyInstance } from "fastify"

const execFileAsync = promisify(execFile)

import {
  getCloudflareTunnelState,
  setTunnelLifecycleHooks,
  startCloudflareQuickTunnel,
} from "@/services/remote-access/cloudflare-tunnel"
import {
  isCloudflareTunnelAutoStartEnabled,
  persistTunnelPublicUrl,
  readRemoteAccessConfig,
} from "@/services/remote-access/tunnel-persistence"
import { resolveCloudflareTunnelTarget } from "@/services/remote-access/tunnel-target"

const BOOT_RETRY_DELAYS_MS = [12_000, 25_000, 45_000]
const RESTART_AFTER_EXIT_MS = 12_000

let bootScheduled = false
let restartTimer: ReturnType<typeof setTimeout> | null = null

async function cloudflaredAvailable(): Promise<boolean> {
  try {
    await execFileAsync("which", ["cloudflared"])
    return true
  } catch {
    return false
  }
}

function clearRestartTimer() {
  if (restartTimer) {
    clearTimeout(restartTimer)
    restartTimer = null
  }
}

async function shouldAutoStart(fastify: FastifyInstance): Promise<boolean> {
  const instance = await fastify.prisma.instanceConfig.findFirst({
    select: { remoteAccessMode: true, remoteAccessConfig: true },
  })
  if (!instance) return false
  const config = readRemoteAccessConfig(instance.remoteAccessConfig)
  return isCloudflareTunnelAutoStartEnabled(config, instance.remoteAccessMode)
}

async function tryStartTunnel(fastify: FastifyInstance, reason: string): Promise<boolean> {
  if (!(await shouldAutoStart(fastify))) return false
  if (!(await cloudflaredAvailable())) {
    fastify.log.warn("cloudflared not found — skipping tunnel auto-start")
    return false
  }

  const existing = getCloudflareTunnelState()
  if (existing.running && existing.url && !existing.stale) {
    fastify.log.info({ url: existing.url }, "Cloudflare tunnel already running")
    return true
  }

  try {
    const localTarget = resolveCloudflareTunnelTarget()
    const url = await startCloudflareQuickTunnel(localTarget)
    fastify.log.info({ url, reason }, "Cloudflare quick tunnel started")
    return true
  } catch (err) {
    fastify.log.warn(
      { err: err instanceof Error ? err.message : String(err), reason },
      "Cloudflare tunnel auto-start failed",
    )
    return false
  }
}

function scheduleRestartAfterExit(fastify: FastifyInstance) {
  clearRestartTimer()
  restartTimer = setTimeout(() => {
    restartTimer = null
    void tryStartTunnel(fastify, "process-exit-restart")
  }, RESTART_AFTER_EXIT_MS)
}

export function registerCloudflareTunnelPersistence(fastify: FastifyInstance) {
  setTunnelLifecycleHooks({
    onPublicUrl: async (publicUrl) => {
      await persistTunnelPublicUrl(fastify, publicUrl)
    },
    onProcessExit: () => {
      void (async () => {
        if (!(await shouldAutoStart(fastify))) return
        scheduleRestartAfterExit(fastify)
      })()
    },
  })
}

async function runBootRetries(fastify: FastifyInstance) {
  if (!(await shouldAutoStart(fastify))) return

  for (let i = 0; i < BOOT_RETRY_DELAYS_MS.length; i++) {
    const delay = BOOT_RETRY_DELAYS_MS[i]!
    await new Promise((r) => setTimeout(r, delay))
    if (await tryStartTunnel(fastify, `boot-attempt-${i + 1}`)) return
  }
}

/** Call once after API listen — starts tunnel when enabled in instance settings. */
export function scheduleCloudflareTunnelBoot(fastify: FastifyInstance) {
  if (bootScheduled) return
  bootScheduled = true
  void runBootRetries(fastify)
}

/** Start tunnel soon after settings enable Cloudflare mode (same process). */
export function requestCloudflareTunnelStart(fastify: FastifyInstance) {
  void (async () => {
    await new Promise((r) => setTimeout(r, 3_000))
    await tryStartTunnel(fastify, "settings-enabled")
  })()
}
