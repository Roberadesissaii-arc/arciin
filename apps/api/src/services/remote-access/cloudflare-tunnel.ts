import { spawn, type ChildProcess } from "node:child_process"

const TRY_CLOUDFLARE_URL_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i

export type CloudflareTunnelState = {
  running: boolean
  url: string | null
  localTarget: string | null
  error: string | null
}

let tunnelProcess: ChildProcess | null = null
let tunnelState: CloudflareTunnelState = {
  running: false,
  url: null,
  localTarget: null,
  error: null,
}

export function getCloudflareTunnelState(): CloudflareTunnelState {
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
  }
}

export function startCloudflareQuickTunnel(localTarget: string): Promise<string> {
  return new Promise((resolve, reject) => {
    stopCloudflareQuickTunnel()

    let settled = false
    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      fn()
    }

    const child = spawn("cloudflared", ["tunnel", "--url", localTarget], {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    })
    tunnelProcess = child
    tunnelState = {
      running: true,
      url: null,
      localTarget,
      error: null,
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
      finish(() => {
        tunnelState = {
          running: true,
          url: match[0],
          localTarget,
          error: null,
        }
        resolve(match[0])
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
      if (code !== 0 && !settled) {
        finish(() => {
          stopCloudflareQuickTunnel()
          reject(new Error("cloudflared exited before a public URL was published."))
        })
        return
      }
      if (!settled) {
        tunnelState.running = false
        tunnelProcess = null
      }
    })
  })
}
