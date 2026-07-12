import path from "node:path"
import { fileURLToPath } from "node:url"

import type { NextConfig } from "next"

const root = path.dirname(fileURLToPath(import.meta.url))

const nextConfig: NextConfig = {
  // Account portal is independent of the self-hosted app shell.
  transpilePackages: ["@arciin/config"],
  // Monorepo file tracing
  outputFileTracingRoot: path.join(root, "../.."),
}

export default nextConfig
