import { spawn, type ChildProcess } from "node:child_process"

const TRY_CLOUDFLARE_URL_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i

export type CloudflareTunnelState = {
  running: boolean
  url: string | null
  localTarget: string | null
  error: string | null
  /** Set when cloudflared exited but DB may still store the old trycloudflare.com URL. */
  stale: boolean
}

let tunnelProcess: ChildProcess | null = null
let tunnelState: CloudflareTunnelState = {
  running: false,
  url: null,
  localTarget: null,
  error: null,
  stale: false,
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
  }
  tunnelProcess = null
}

export function getCloudflareTunnelState(): CloudflareTunnelState {
  if (tunnelProcess && !isProcessAlive(tunnelProcess)) {
    markTunnelStopped(
      "The Cloudflare quick tunnel stopped. Your old trycloudflare.com link will show error 530 — generate a new public URL.",
    )
  }
  return { ...tunnelState }
}

export function stopCloudflareQuickTunnel() {
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
  "Tunnel is running. The public URL can take 30–60 seconds to work. Open it in a browser; if it fails, wait a moment and refresh."

async function finalizeTunnelStart(publicUrl: string, localTarget: string): Promise<string> {
  await verifyLocalWebTarget(localTarget)

  tunnelState = {
    running: true,
    url: publicUrl,
    localTarget,
    error: null,
    stale: false,
  }

  const reachable = await probeTunnelPublicUrl(publicUrl)
  if (!reachable && isProcessAlive(tunnelProcess)) {
    tunnelState = {
      ...tunnelState,
      error: PUBLIC_PROBE_HINT,
    }
  }

  return publicUrl
}

export function startCloudflareQuickTunnel(localTarget: string): Promise<string> {
  const normalizedTarget = localTarget.replace(/\/+$/, "")
  const existing = getCloudflareTunnelState()
  if (
    existing.running &&
    existing.url &&
    existing.localTarget === normalizedTarget &&
    !existing.stale
  ) {
    return finalizeTunnelStart(existing.url, normalizedTarget)
  }

  return new Promise((resolve, reject) => {
    stopCloudflareQuickTunnel()

    let settled = false
    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      fn()
    }

    const child = spawn("cloudflared", ["tunnel", "--url", normalizedTarget], {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    })
    tunnelProcess = child
    tunnelState = {
      running: true,
      url: null,
      localTarget: normalizedTarget,
      error: null,
      stale: false,
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
    })
  })
}
