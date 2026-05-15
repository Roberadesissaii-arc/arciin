import type { NextConfig } from "next"

const apiUrl = process.env.ARCIIN_API_URL || "http://localhost:4000"

const nextConfig: NextConfig = {
  poweredByHeader: false,
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
      // Socket.IO on the API — browser hits same origin /socket.io… and Next proxies (avoids 404 on :3000).
      {
        source: "/socket.io/:path*",
        destination: `${apiUrl.replace(/\/$/, "")}/socket.io/:path*`,
      },
    ]
  },
}

export default nextConfig
