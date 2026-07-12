import "server-only"

import { clientIpFromIncomingRequest } from "@/lib/server/client-ip"
import { getServerApiOrigin } from "@/lib/server/api-origin"

/** Set by the Next.js API proxy so Fastify can trust the real client on loopback hops. */
export const ARCIIN_CLIENT_IP_HEADER = "x-arciin-client-ip"

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
  "content-length",
])

function methodAllowsBody(method: string) {
  return !["GET", "HEAD"].includes(method.toUpperCase())
}

/** Build upstream headers for Fastify, including the real client IP. */
export function buildUpstreamApiHeaders(
  incoming: Headers,
  clientIp: string | null,
): Headers {
  const headers = new Headers()

  for (const [key, value] of incoming.entries()) {
    if (HOP_BY_HOP.has(key.toLowerCase())) continue
    headers.append(key, value)
  }

  if (clientIp) {
    const prior = headers.get("x-forwarded-for")
    if (prior) {
      const chain = prior.split(",").map((value) => value.trim())
      if (!chain.includes(clientIp)) {
        headers.set("x-forwarded-for", `${clientIp}, ${prior}`)
      }
    } else {
      headers.set("x-forwarded-for", clientIp)
    }

    headers.set("x-real-ip", clientIp)
    headers.set(ARCIIN_CLIENT_IP_HEADER, clientIp)
  }

  return headers
}

/** Proxy a request to Fastify with client IP headers preserved. */
export async function proxyApiRequest(request: Request, targetPathWithQuery: string) {
  const apiOrigin = getServerApiOrigin()
  const clientIp = clientIpFromIncomingRequest(request)
  const headers = buildUpstreamApiHeaders(request.headers, clientIp)
  const method = request.method.toUpperCase()
  const hasBody = methodAllowsBody(method)

  const upstream = await fetch(`${apiOrigin}${targetPathWithQuery}`, {
    method,
    headers,
    body: hasBody ? request.body : undefined,
    // Required when streaming a request body to Node fetch.
    ...(hasBody && request.body ? { duplex: "half" as const } : {}),
    cache: "no-store",
  })

  const responseHeaders = new Headers()
  for (const [key, value] of upstream.headers.entries()) {
    if (HOP_BY_HOP.has(key.toLowerCase())) continue
    responseHeaders.append(key, value)
  }

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  })
}
