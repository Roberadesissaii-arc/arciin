const REDACTED_QUERY_PARAMS = new Set([
  "access_token",
  "media_token",
  "token",
  "setup_token",
  "setuptoken",
  "setupToken",
])

const REDACTED_HEADER_NAMES = new Set([
  "x-arciin-setup-token",
  "authorization",
  "cookie",
  "set-cookie",
])

const REDACTED = "[redacted]"

/**
 * Media and setup credentials must never appear in request-line logs.
 *
 * Setup tokens are refused from the query string by the authorization helper;
 * this still redacts them if a client sends one, so a mistake cannot persist
 * in api.log.
 */
export function redactSensitiveUrl(url: string): string {
  const [pathPart, queryPart] = url.split("?")
  if (!queryPart || pathPart === undefined) return url
  try {
    const params = new URLSearchParams(queryPart)
    let redacted = false
    for (const name of [...params.keys()]) {
      if (REDACTED_QUERY_PARAMS.has(name) || REDACTED_QUERY_PARAMS.has(name.toLowerCase())) {
        params.set(name, REDACTED)
        redacted = true
      }
    }
    return redacted ? `${pathPart}?${params.toString()}` : url
  } catch {
    return url
  }
}

export function redactSensitiveHeaders(
  headers: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (!headers) return out
  for (const [key, value] of Object.entries(headers)) {
    out[key] = REDACTED_HEADER_NAMES.has(key.toLowerCase()) ? REDACTED : value
  }
  return out
}

/**
 * Shape Fastify's req serializer should emit.
 *
 * Headers are omitted from the live log: even a redacted map still advertises
 * that a setup token was sent. Query strings are rewritten so a mistaken
 * `?token=` cannot persist in api.log.
 */
export function serializeRequestForLog(request: {
  method?: string
  url?: string
  hostname?: string
  ip?: string
  headers?: Record<string, unknown>
  socket?: { remotePort?: number }
}): Record<string, unknown> {
  return {
    method: request.method,
    url: redactSensitiveUrl(request.url ?? ""),
    hostname: request.hostname,
    remoteAddress: request.ip,
    remotePort: request.socket?.remotePort,
  }
}

export function logContainsSecret(serialized: unknown, secret: string): boolean {
  if (!secret) return false
  return JSON.stringify(serialized).includes(secret)
}
