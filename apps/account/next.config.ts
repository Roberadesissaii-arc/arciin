import path from "node:path"
import { fileURLToPath } from "node:url"

import type { NextConfig } from "next"

const root = path.dirname(fileURLToPath(import.meta.url))

/**
 * Hosts allowed to reach the portal.
 *
 * Without these, opening the portal on the server's LAN address instead of
 * localhost meant every Server Action — create licence, revoke — was rejected
 * as a cross-origin request and silently did nothing. The main web app already
 * carried the same allowance; the portal was missing it.
 */
function allowedOrigins(): string[] {
  const hosts = new Set<string>(["localhost", "127.0.0.1"])

  for (const raw of [
    process.env.ARCIIN_ACCOUNT_ORIGINS,
    process.env.NEXT_PUBLIC_ARCIIN_ACCOUNT_URL,
    process.env.ARCIIN_PUBLIC_URL,
  ]) {
    if (!raw?.trim()) continue
    for (const part of raw.split(",")) {
      const value = part.trim()
      if (!value) continue
      try {
        const host = /^https?:\/\//i.test(value)
          ? new URL(value).host
          : value.replace(/\/.*$/, "")
        if (host) hosts.add(host)
      } catch {
        // ignore malformed entries
      }
    }
  }

  // The portal is reached by host:port, so allow the LAN address on its own port too.
  for (const host of [...hosts]) {
    if (!host.includes(":")) hosts.add(`${host}:3010`)
  }

  return [...hosts]
}

const origins = allowedOrigins()

const nextConfig: NextConfig = {
  // Account portal is independent of the self-hosted app shell.
  transpilePackages: ["@arciin/config"],
  // Monorepo file tracing
  outputFileTracingRoot: path.join(root, "../.."),
  allowedDevOrigins: origins,
  experimental: {
    // Server Actions validate Origin against this list; a mismatch is rejected
    // before the action ever runs, which is why the buttons did nothing.
    serverActions: { allowedOrigins: origins },
  },
}

export default nextConfig
