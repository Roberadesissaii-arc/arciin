import { config as loadEnv } from "dotenv"
import type { NextConfig } from "next"

// Ensure install.sh / PM2 .env is visible when building and at `next start`.
loadEnv({ path: ".env" })

const apiUrl =
  process.env.ARCIIN_API_URL ||
  `http://127.0.0.1:${process.env.API_PORT || "4000"}`

function resolveAllowedDevOrigins(): string[] {
  const hosts = new Set<string>(["localhost", "127.0.0.1"])
  for (const value of [
    process.env.ARCIIN_PUBLIC_URL,
    process.env.NEXT_PUBLIC_ARCIIN_PUBLIC_URL,
  ]) {
    if (!value?.trim()) continue
    try {
      hosts.add(new URL(value.trim()).hostname)
    } catch {
      // ignore invalid URL
    }
  }
  return [...hosts]
}

const nextConfig: NextConfig = {
  allowedDevOrigins: resolveAllowedDevOrigins(),
  poweredByHeader: false,
  /** Socket.IO polling uses `/socket.io/?EIO=…` — do not 308-strip the slash before the query. */
  skipTrailingSlashRedirect: true,
  transpilePackages: ["@arciin/shared"],
  // Rewritten /api requests buffer the body in Next; default cap is small. Large bodies should use
  // NEXT_PUBLIC_ARCIIN_API_ORIGIN (see lib/api/uploads.ts) so uploads hit Fastify directly.
  experimental: {
    proxyClientMaxBodySize: "256mb",
  },
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${apiUrl}/api/:path*`,
      },
      // Socket.IO — must include bare /socket.io (polling hits ?EIO=… with no extra path segment).
      {
        source: "/socket.io",
        destination: `${apiUrl.replace(/\/$/, "")}/socket.io/`,
      },
      {
        source: "/socket.io/:path*",
        destination: `${apiUrl.replace(/\/$/, "")}/socket.io/:path*`,
      },
    ]
  },
}

export default nextConfig
