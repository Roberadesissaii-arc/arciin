import path from "node:path"
import { fileURLToPath } from "node:url"

import type { NextConfig } from "next"

import { loadArciinEnv } from "@arciin/config"

const webRoot = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(webRoot, "../..")

// Ensure install.sh / PM2 .env at the repo root is visible when building and at
// `next start`, then layer .env.development so a dev server picks up the
// isolated ports, API URL and NEXT_DIST_DIR instead of production's.
loadArciinEnv(repoRoot)

const apiUrl =
  process.env.ARCIIN_API_URL ||
  `http://127.0.0.1:${process.env.API_PORT || "4000"}`

const maxUploadMb = Number(process.env.MAX_UPLOAD_SIZE_MB || String(20 * 1024))
const proxyMaxBodyBytes =
  Number.isFinite(maxUploadMb) && maxUploadMb > 0
    ? maxUploadMb * 1024 * 1024
    : 10240 * 1024 * 1024

function resolveAllowedDevOrigins(): string[] {
  const hosts = new Set<string>(["localhost", "127.0.0.1", "*.trycloudflare.com"])
  const candidates = [
    process.env.ARCIIN_PUBLIC_URL,
    process.env.NEXT_PUBLIC_ARCIIN_PUBLIC_URL,
    process.env.ARCIIN_LAN_ORIGINS,
    process.env.ARCIIN_MOBILE_DEV_ORIGINS,
  ]
  for (const raw of candidates) {
    if (!raw?.trim()) continue
    for (const part of raw.split(",")) {
      const value = part.trim()
      if (!value) continue
      try {
        const hostname = /^https?:\/\//i.test(value)
          ? new URL(value).hostname
          : value.replace(/:\d+$/, "")
        if (hostname) hosts.add(hostname)
      } catch {
        // ignore invalid URL
      }
    }
  }
  return [...hosts]
}

const publicUrl = process.env.ARCIIN_PUBLIC_URL || ""
const servesHttps = publicUrl.startsWith("https://")

/**
 * Origins the browser may open XHR / EventSource / WebSocket connections to.
 *
 * Normally everything is same-origin: `/api/*` is a route handler and
 * `/socket.io` is a rewrite, so 'self' covers it. Two escapes need naming —
 * large uploads can be pointed straight at Fastify via
 * NEXT_PUBLIC_ARCIIN_API_ORIGIN to avoid buffering in Next, and the socket can
 * be given an explicit URL.
 */
function connectSources(): string[] {
  const sources = new Set(["'self'"])

  for (const raw of [
    process.env.NEXT_PUBLIC_ARCIIN_API_ORIGIN,
    process.env.NEXT_PUBLIC_SOCKET_URL,
    process.env.NEXT_PUBLIC_API_BASE_URL,
  ]) {
    const value = raw?.trim()
    if (!value || value.startsWith("/")) continue
    try {
      const { origin, protocol, host } = new URL(value)
      sources.add(origin)
      // Socket.IO upgrades to a WebSocket on the same host.
      sources.add(`${protocol === "https:" ? "wss" : "ws"}://${host}`)
    } catch {
      // ignore unparseable values
    }
  }

  // Same-origin WebSocket for Socket.IO when no explicit URL is configured.
  sources.add("ws:")
  sources.add("wss:")

  return [...sources]
}

/**
 * Security headers for the app users actually load.
 *
 * The API sets its own (see apps/api/src/plugins/helmet.ts); the Next tier had
 * none at all, which left the authenticated UI framable and without any CSP
 * backstop.
 *
 * Two directives are deliberately looser than the API's:
 *
 * - `script-src` keeps 'unsafe-inline'. The App Router emits inline bootstrap
 *   and streaming-payload scripts, and layout.tsx runs an inline theme guard to
 *   stop a flash of the wrong accent. Locking this down needs per-request
 *   nonces from middleware, which is a real change rather than a header, and is
 *   worth doing separately. React's escaping remains the primary XSS defence.
 * - `'wasm-unsafe-eval'` and `worker-src blob:` are required by pdfjs-dist,
 *   which compiles WASM and renders pages in a worker. Without them PDF preview
 *   silently shows a grey placeholder.
 */
function securityHeaders() {
  /**
   * React's development build uses `eval()` — for component stacks and other
   * debugging, and it says so in the console when a CSP blocks it. Production
   * never does, so this is granted only where it is actually needed rather
   * than shipped to users to keep `next dev` working.
   */
  const devEval = process.env.NODE_ENV === "production" ? "" : " 'unsafe-eval'"

  const csp = [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'${devEval}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "media-src 'self' blob: data:",
    "worker-src 'self' blob:",
    `connect-src ${connectSources().join(" ")}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    // Only when the instance is actually served over TLS — forcing this on a
    // plain-HTTP LAN install rewrites every asset request to https and breaks it.
    ...(servesHttps ? ["upgrade-insecure-requests"] : []),
  ].join("; ")

  const headers = [
    { key: "Content-Security-Policy", value: csp },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    // frame-ancestors above covers modern browsers; this covers the rest.
    { key: "X-Frame-Options", value: "DENY" },
    {
      key: "Permissions-Policy",
      value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
    },
  ]

  if (servesHttps) {
    headers.push({
      key: "Strict-Transport-Security",
      value: "max-age=31536000; includeSubDomains",
    })
  }

  return headers
}

const nextConfig: NextConfig = {
  /**
   * Development writes to .next-dev so `next dev` can never overwrite the
   * production build in .next — which is how the production BUILD_ID once
   * ended up being a dev artifact.
   */
  distDir: process.env.NEXT_DIST_DIR || ".next",
  allowedDevOrigins: resolveAllowedDevOrigins(),
  poweredByHeader: false,
  /** Socket.IO polling uses `/socket.io/?EIO=…` — do not 308-strip the slash before the query. */
  skipTrailingSlashRedirect: true,
  transpilePackages: ["@arciin/shared", "@arciin/config", "@arciin/types", "@arciin/ui"],
  // Rewritten /api requests buffer the body in Next; default cap is small. Large bodies should use
  // NEXT_PUBLIC_ARCIIN_API_ORIGIN (see lib/api/uploads.ts) so uploads hit Fastify directly.
  experimental: {
    // Must match API MAX_UPLOAD_SIZE_MB — uploads via /api rewrite buffer in Next.
    proxyClientMaxBodySize: proxyMaxBodyBytes,
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders() }]
  },
  async redirects() {
    return [
      {
        source: "/applications",
        destination: "/inbox",
        permanent: true,
      },
      {
        source: "/applications/:path*",
        destination: "/inbox",
        permanent: true,
      },
    ]
  },
  async rewrites() {
    return [
      // /api/* is handled by app/api/[...path]/route.ts so the real client IP
      // is forwarded to Fastify (next.config rewrites drop X-Forwarded-For).
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
