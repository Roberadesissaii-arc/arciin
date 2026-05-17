import "server-only"

/** Fastify API origin for server components (reads .env at runtime under PM2). */
export function getServerApiOrigin(): string {
  const fromEnv = process.env.ARCIIN_API_URL?.trim()
  if (fromEnv) return fromEnv.replace(/\/+$/, "")

  const port = process.env.API_PORT?.trim() || "4000"
  return `http://127.0.0.1:${port}`
}

export function getServerApiPort(): string {
  const origin = getServerApiOrigin()
  const match = origin.match(/:(\d+)\/?$/)
  return match?.[1] ?? process.env.API_PORT?.trim() ?? "4000"
}
