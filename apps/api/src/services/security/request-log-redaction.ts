const REDACTED_QUERY_PARAMS = new Set([
  "access_token",
  "media_token",
  "token",
  "setup_token",
  "setuptoken",
  "setupToken",
  "code",
  "pairing_code",
  "pairingCode",
  "credential",
  "device_token",
  "deviceToken",
  "device_credential",
  "deviceCredential",
  "sync_credential",
  "syncCredential",
])

const REDACTED_BODY_KEYS = new Set([
  "code",
  "pairingcode",
  "pairing_code",
  "credential",
  "devicecredential",
  "device_credential",
  "devicetoken",
  "device_token",
  "password",
  "setuptoken",
  "setup_token",
])

const REDACTED_HEADER_NAMES = new Set([
  "x-arciin-setup-token",
  "authorization",
  "cookie",
  "set-cookie",
])

const REDACTED = "[redacted]"

/**
 * Media and setup credentials must never appear in request-line logs, and
 * neither may a File Request or share link's token, which travels in the path.
 *
 * Setup tokens are refused from the query string by the authorization helper;
 * this still redacts them if a client sends one, so a mistake cannot persist
 * in api.log.
 */
/**
 * Routes whose path carries a bearer secret: anyone holding the URL can use it.
 * The segment after each prefix is replaced, whatever follows it.
 */
const SECRET_PATH_PREFIXES = ["/public/file-requests/", "/shares/access/"]

function redactSecretPath(pathPart: string): string {
  for (const prefix of SECRET_PATH_PREFIXES) {
    const at = pathPart.indexOf(prefix)
    if (at === -1) continue
    const start = at + prefix.length
    const end = pathPart.indexOf("/", start)
    if (end === start) continue
    return `${pathPart.slice(0, start)}${REDACTED}${end === -1 ? "" : pathPart.slice(end)}`
  }
  return pathPart
}

export function redactSensitiveUrl(url: string): string {
  const queryAt = url.indexOf("?")
  const rawPath = queryAt === -1 ? url : url.slice(0, queryAt)
  const safePath = redactSecretPath(rawPath)
  if (safePath !== rawPath) url = safePath + (queryAt === -1 ? "" : url.slice(queryAt))
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

export function redactSensitiveValue(key: string, value: unknown): unknown {
  if (REDACTED_BODY_KEYS.has(key.toLowerCase())) return REDACTED
  return value
}

export function redactSensitiveObject(
  input: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (!input) return out
  for (const [key, value] of Object.entries(input)) {
    out[key] = redactSensitiveValue(key, value)
  }
  return out
}

export function logContainsSecret(serialized: unknown, secret: string): boolean {
  if (!secret) return false
  return JSON.stringify(serialized).includes(secret)
}
