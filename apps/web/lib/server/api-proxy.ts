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
  /**
   * `Expect: 100-continue` is a conversation between the client and *this*
   * hop. Undici's fetch refuses to send it at all (UND_ERR_NOT_SUPPORTED), so
   * forwarding it turned every upload from curl (>1 MB), .NET HttpClient, and
   * many Java clients into a bodyless 500 before Fastify saw the request.
   */
  "expect",
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

  let upstream: Response
  try {
    upstream = await fetch(`${apiOrigin}${targetPathWithQuery}`, {
      method,
      headers,
      body: hasBody ? request.body : undefined,
      // Required when streaming a request body to Node fetch.
      ...(hasBody && request.body ? { duplex: "half" as const } : {}),
      cache: "no-store",
    })
  } catch (error) {
    // A thrown fetch used to surface as Next's bare 500 with no body, which an
    // API client cannot tell apart from a crash. Always answer in the API's
    // own envelope. The cause stays in the server log, not in the response.
    console.error("[api-proxy] upstream request failed", {
      method,
      path: targetPathWithQuery.split("?")[0],
      code: (error as { cause?: { code?: string } })?.cause?.code,
    })
    return proxyFailure()
  }

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

/** The API's JSON error envelope, for when the API itself could not be reached. */
export function proxyFailure(): Response {
  return new Response(
    JSON.stringify({
      error: {
        code: "UPSTREAM_UNAVAILABLE",
        message: "The Arciin API could not complete this request. Try again in a moment.",
      },
    }),
    { status: 502, headers: { "content-type": "application/json; charset=utf-8" } },
  )
}
