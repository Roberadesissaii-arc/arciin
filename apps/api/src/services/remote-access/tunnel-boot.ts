import { execFile } from "node:child_process"
import { promisify } from "node:util"

import type { FastifyInstance } from "fastify"

const execFileAsync = promisify(execFile)

import {
  getCloudflareTunnelState,
  setTunnelLifecycleHooks,
} from "@/services/remote-access/cloudflare-tunnel"
import {
  PublicRemoteAccessDeniedError,
  startPublicTunnel,
} from "@/services/remote-access/public-tunnel"
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

/**
 * Always tunnel the desktop web origin — it is the unified entry point.
 *
 * This used to prefer the mobile port whenever the two differed, which is why
 * the desktop domain kept vanishing: only one cloudflared process can exist
 * (see cloudflare-tunnel.ts), so whichever app was tunnelled last took the
 * domain from the other.
 *
 * Now one tunnel points here and `apps/web/proxy.ts` routes each request to the
 * desktop app or through to the mobile PWA based on the device. One domain,
 * both apps, nothing to fight over.
 */
function resolveAutoStartTunnelTarget(): string {
  return resolveCloudflareTunnelTarget()
}

async function tryStartTunnel(fastify: FastifyInstance, reason: string): Promise<boolean> {
  if (!(await shouldAutoStart(fastify))) return false
  if (!(await cloudflaredAvailable())) {
    fastify.log.warn("cloudflared not found — skipping tunnel auto-start")
    return false
  }

  const existing = getCloudflareTunnelState()
  if (existing.running && existing.url && !existing.stale) {
    const instance = await fastify.prisma.instanceConfig.findFirst({
      select: { id: true, publicUrl: true, remoteAccessConfig: true },
    })
    const config = readRemoteAccessConfig(instance?.remoteAccessConfig)
    const stored =
      (typeof config.mobilePublicUrl === "string" ? config.mobilePublicUrl : null) ??
      instance?.publicUrl ??
      null
    if (stored?.replace(/\/+$/, "") !== existing.url.replace(/\/+$/, "")) {
      await persistTunnelPublicUrl(fastify, existing.url)
    }
    fastify.log.info({ url: existing.url }, "Cloudflare tunnel already running")
    return true
  }

  try {
    const localTarget = resolveAutoStartTunnelTarget()
    // Auto-start and restart-after-exit are public Remote Access too: they go
    // through the same owner-MFA policy as the Start buttons.
    const url = await startPublicTunnel(fastify.prisma, localTarget)
    fastify.log.info({ url, localTarget, reason }, "Cloudflare quick tunnel started")
    return true
  } catch (err) {
    if (err instanceof PublicRemoteAccessDeniedError) {
      fastify.log.warn(
        { reason },
        "Public Remote Access is paused until the owner enrolls two-factor authentication; the server stays reachable on the local network",
      )
      // Returning true stops the boot retries: nothing will change until the
      // owner enrols, and retrying would only repeat this warning.
      return true
    }
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
