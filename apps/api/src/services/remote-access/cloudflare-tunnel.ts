import { spawn, type ChildProcess } from "node:child_process"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const TRY_CLOUDFLARE_URL_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i

let isolatedConfigPath: string | null = null

/**
 * Path to a config file that exists only so cloudflared does not read
 * somebody else's.
 *
 * With no `--config`, cloudflared loads ~/.cloudflared/config.yml. On a host
 * that already runs a named tunnel, that file belongs to the named tunnel —
 * here it routes license.arciin.com and ends, as ingress rules must, with a
 * catch-all:
 *
 *     - service: http_status:404
 *
 * A quick tunnel's hostname is random and therefore never matches the named
 * hostname, so every request fell through to that catch-all. cloudflared
 * answered 404 itself, through the edge, which is why the failure looked like
 * Cloudflare refusing to route: the hostname registered, the connector came
 * up, the origin was healthy, and every request still returned 404. Running
 * cloudflared by hand reproduced it exactly, because the same default config
 * was picked up.
 *
 * Passing an empty config keeps the quick tunnel on its own `--url` origin and
 * leaves the named tunnel's file untouched.
 */
export function buildQuickTunnelArgs(configPath: string, target: string): string[] {
  // --config must precede the subcommand; cloudflared treats it as a global flag.
  return ["--config", configPath, "tunnel", "--url", target]
}

function ensureIsolatedTunnelConfig(): string {
  if (isolatedConfigPath) return isolatedConfigPath
  const dir = mkdtempSync(path.join(tmpdir(), "arciin-cloudflared-"))
  const file = path.join(dir, "config.yml")
  // Deliberately empty: every setting a quick tunnel needs is on the command
  // line, and anything inherited here would be another tunnel's.
  writeFileSync(file, "# Arciin quick tunnel: intentionally empty.\n", "utf8")
  isolatedConfigPath = file
  return file
}

export type CloudflareTunnelState = {
  running: boolean
  url: string | null
  localTarget: string | null
  error: string | null
  /** Set when cloudflared exited but DB may still store the old trycloudflare.com URL. */
  stale: boolean
  /**
   * Whether the public URL actually answered from outside, as opposed to
   * whether a cloudflared process exists.
   *
   * null means not determined yet. The two are genuinely different states: a
   * quick tunnel can hold a live process and a registered hostname while the
   * edge returns 404 for it, which is what "Live" used to be reported for.
   */
  reachable: boolean | null
  /** When reachability was last determined, ISO-8601. */
  reachabilityCheckedAt: string | null
}

let tunnelProcess: ChildProcess | null = null
let tunnelState: CloudflareTunnelState = {
  running: false,
  url: null,
  localTarget: null,
  error: null,
  stale: false,
  reachable: null,
  reachabilityCheckedAt: null,
}

let suppressAutoRestart = false

type TunnelLifecycleHooks = {
  onPublicUrl?: (publicUrl: string) => Promise<void>
  onProcessExit?: () => void
}

let lifecycleHooks: TunnelLifecycleHooks = {}

export function setTunnelLifecycleHooks(hooks: TunnelLifecycleHooks) {
  lifecycleHooks = hooks
}

function isProcessAlive(child: ChildProcess | null): boolean {
  if (!child) return false
  return child.exitCode === null && !child.killed
}

function markTunnelStopped(message: string, keepUrl = true) {
  tunnelState = {
    running: false,
    url: keepUrl ? tunnelState.url : null,
    localTarget: null,
    error: message,
    stale: keepUrl && Boolean(tunnelState.url),
    reachable: false,
    reachabilityCheckedAt: new Date().toISOString(),
  }
  tunnelProcess = null
}

/** How long a reachability result is trusted before it is checked again. */
const REACHABILITY_TTL_MS = 60_000
let reachabilityRefreshInFlight = false

/**
 * Re-check the public URL in the background when the cached answer has aged
 * out.
 *
 * A quick tunnel does not only fail by its process dying. It can keep the
 * process and the registered hostname while the edge stops routing to it, and
 * then the hostname answers 404 from Cloudflare with the origin perfectly
 * healthy. Probing once at startup could not see that happen later, so the
 * status stayed at whatever it was when the tunnel opened.
 *
 * Deliberately not awaited: a settings page must not block on an external
 * request. Callers get the previous answer and the next read sees the new one.
 */
function refreshReachabilityIfStale() {
  if (reachabilityRefreshInFlight) return
  if (!tunnelState.running || !tunnelState.url) return
  const checkedAt = tunnelState.reachabilityCheckedAt
  if (checkedAt && Date.now() - Date.parse(checkedAt) < REACHABILITY_TTL_MS) return

  const url = tunnelState.url
  reachabilityRefreshInFlight = true
  void (async () => {
    try {
      // One pass, not the startup poll: this answers "is it working now".
      const reachable = await probeTunnelPublicUrl(url, 6_000)
      if (tunnelState.url !== url) return
      tunnelState = {
        ...tunnelState,
        reachable,
        reachabilityCheckedAt: new Date().toISOString(),
        error: reachable ? null : PUBLIC_PROBE_HINT,
      }
    } finally {
      reachabilityRefreshInFlight = false
    }
  })()
}

export function getCloudflareTunnelState(): CloudflareTunnelState {
  if (tunnelProcess && !isProcessAlive(tunnelProcess)) {
    markTunnelStopped(
      "The Cloudflare quick tunnel stopped. Your old trycloudflare.com link will show error 530 — generate a new public URL.",
    )
  }
  refreshReachabilityIfStale()
  return { ...tunnelState }
}

export function stopCloudflareQuickTunnel() {
  suppressAutoRestart = true
  if (tunnelProcess) {
    tunnelProcess.kill("SIGTERM")
    tunnelProcess = null
  }
  tunnelState = {
    running: false,
    url: null,
    localTarget: null,
    error: null,
    stale: false,
    reachable: false,
    reachabilityCheckedAt: new Date().toISOString(),
  }
}

/** Ensure Next.js (tunnel origin) is up before starting cloudflared. */
async function verifyLocalWebTarget(localTarget: string): Promise<void> {
  const healthUrl = `${localTarget.replace(/\/+$/, "")}/api/health`
  try {
    const res = await fetch(healthUrl, {
      signal: AbortSignal.timeout(8_000),
      headers: { Accept: "application/json" },
    })
    if (!res.ok) {
      throw new Error(
        `Arciin is not responding on ${localTarget} (HTTP ${res.status}). Start the web app (pnpm start / PM2) before generating a tunnel.`,
      )
    }
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(
        `Arciin did not respond on ${localTarget} in time. Confirm the web UI is running on that port, then try again.`,
      )
    }
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(`Cannot reach ${localTarget}: ${message}`)
  }
}

/**
 * Best-effort check through Cloudflare edge. Slow or flaky from the same host — never tear down the tunnel on failure.
 */
async function probeTunnelPublicUrl(publicUrl: string, timeoutMs = 45_000): Promise<boolean> {
  const base = publicUrl.replace(/\/+$/, "")
  const candidates = [`${base}/api/health`, `${base}/login`, base]
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    if (!isProcessAlive(tunnelProcess)) return false

    for (const url of candidates) {
      try {
        const res = await fetch(url, {
          signal: AbortSignal.timeout(12_000),
          redirect: "follow",
        })
        if (res.ok || res.status === 307 || res.status === 308) return true
      } catch {
        // Cloudflare edge can lag; keep retrying
      }
    }
    await new Promise((r) => setTimeout(r, 1_500))
  }
  return false
}

const PUBLIC_PROBE_HINT =
  "Tunnel is running. The public URL can take 30–60 seconds to work. Open it in a new tab; use that hostname to sign in if needed."

function schedulePublicTunnelProbe(publicUrl: string) {
  void (async () => {
    const reachable = await probeTunnelPublicUrl(publicUrl, 25_000)
    if (tunnelState.url !== publicUrl || !isProcessAlive(tunnelProcess)) return
    tunnelState = {
      ...tunnelState,
      error: reachable ? null : PUBLIC_PROBE_HINT,
      reachable,
      reachabilityCheckedAt: new Date().toISOString(),
    }
  })()
}

/** Fast path for the HTTP handler — never block on Cloudflare edge probes. */
async function finalizeTunnelStart(publicUrl: string, localTarget: string): Promise<string> {
  await verifyLocalWebTarget(localTarget)

  tunnelState = {
    running: true,
    url: publicUrl,
    localTarget,
    error: PUBLIC_PROBE_HINT,
    stale: false,
    reachable: null,
    reachabilityCheckedAt: null,
  }

  if (lifecycleHooks.onPublicUrl) {
    try {
      await lifecycleHooks.onPublicUrl(publicUrl)
    } catch {
      /* logged by persistence layer */
    }
  }

  schedulePublicTunnelProbe(publicUrl)
  return publicUrl
}

export function startCloudflareQuickTunnel(
  localTarget: string,
  options: { force?: boolean } = {},
): Promise<string> {
  const normalizedTarget = localTarget.replace(/\/+$/, "")
  const existing = getCloudflareTunnelState()

  // Reusing a healthy tunnel is right for auto-start (a restart should not
  // churn the address for no reason) but wrong when someone clicks "Generate
  // new URL": that returned the *existing* address, so the button looked like
  // it worked, nothing changed, and no address-change notification was sent
  // because there was no change to announce. An explicit request forces a new
  // tunnel.
  if (
    !options.force &&
    existing.running &&
    existing.url &&
    existing.localTarget === normalizedTarget &&
    !existing.stale
  ) {
    return finalizeTunnelStart(existing.url, normalizedTarget)
  }

  return new Promise((resolve, reject) => {
    stopCloudflareQuickTunnel()
    suppressAutoRestart = false

    let settled = false
    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      fn()
    }

    const child = spawn(
      "cloudflared",
      buildQuickTunnelArgs(ensureIsolatedTunnelConfig(), normalizedTarget),
      {
        stdio: ["ignore", "pipe", "pipe"],
        env: process.env,
      },
    )
    tunnelProcess = child
    tunnelState = {
      running: true,
      url: null,
      localTarget: normalizedTarget,
      error: null,
      stale: false,
      reachable: null,
      reachabilityCheckedAt: null,
    }

    const timeout = setTimeout(() => {
      finish(() => {
        stopCloudflareQuickTunnel()
        reject(
          new Error(
            "Timed out waiting for a trycloudflare.com URL. Install cloudflared on this server and try again.",
          ),
        )
      })
    }, 90_000)

    const handleOutput = (chunk: Buffer) => {
      const match = chunk.toString().match(TRY_CLOUDFLARE_URL_RE)
      if (!match) return
      const publicUrl = match[0]
      finish(() => {
        void finalizeTunnelStart(publicUrl, normalizedTarget)
          .then(resolve)
          .catch((err) => {
            stopCloudflareQuickTunnel()
            reject(err instanceof Error ? err : new Error(String(err)))
          })
      })
    }

    child.stdout?.on("data", handleOutput)
    child.stderr?.on("data", handleOutput)

    child.on("error", (err) => {
      finish(() => {
        stopCloudflareQuickTunnel()
        reject(
          new Error(
            `Could not run cloudflared (${err.message}). Install it from https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/`,
          ),
        )
      })
    })

    child.on("exit", (code) => {
      if (!settled) {
        finish(() => {
          stopCloudflareQuickTunnel()
          reject(new Error("cloudflared exited before a public URL was published."))
        })
        return
      }
      markTunnelStopped(
        code && code !== 0
          ? `cloudflared exited (code ${code}). Cloudflare unregistered this tunnel (530). Generate a new public URL.`
          : "cloudflared stopped. The previous trycloudflare.com URL no longer works — generate a new one.",
      )
      if (!suppressAutoRestart) {
        lifecycleHooks.onProcessExit?.()
      }
    })
  })
}
