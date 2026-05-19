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

async function verifyTunnelPublicUrl(publicUrl: string, timeoutMs = 20_000): Promise<void> {
  const healthUrl = `${publicUrl.replace(/\/+$/, "")}/api/health`
  const deadline = Date.now() + timeoutMs
  let lastError: Error | null = null

  while (Date.now() < deadline) {
    try {
      const res = await fetch(healthUrl, { signal: AbortSignal.timeout(4_000) })
      if (res.ok) return
      lastError = new Error(`Health check returned ${res.status}`)
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
    }
    await new Promise((r) => setTimeout(r, 750))
  }

  throw new Error(
    lastError
      ? `Tunnel URL was published but is not reachable yet (${lastError.message}). Wait a few seconds and try again.`
      : "Tunnel URL was published but is not reachable yet. Wait a few seconds and try again.",
  )
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
    return verifyTunnelPublicUrl(existing.url).then(() => existing.url!)
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
        tunnelState = {
          running: true,
          url: publicUrl,
          localTarget: normalizedTarget,
          error: null,
          stale: false,
        }
        void verifyTunnelPublicUrl(publicUrl)
          .then(() => resolve(publicUrl))
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
