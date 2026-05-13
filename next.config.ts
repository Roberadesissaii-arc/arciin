import type { NextConfig } from "next"

const apiUrl = process.env.ARCIIN_API_URL || "http://localhost:4000"

const nextConfig: NextConfig = {
  poweredByHeader: false,
  transpilePackages: ["@arciin/shared"],
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${apiUrl}/api/:path*`,
      },
    ]
  },
}

export default nextConfig
