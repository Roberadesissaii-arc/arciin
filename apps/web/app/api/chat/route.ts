import { buildUpstreamApiHeaders } from "@/lib/server/api-proxy"
import { clientIpFromIncomingRequest } from "@/lib/server/client-ip"
import { getServerApiOrigin } from "@/lib/server/api-origin"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * Stream chat SSE through Next without buffering the full reply.
 * `next.config` rewrites buffer long /api responses; this route pipes chunks live.
 */
export async function POST(request: Request) {
  const apiOrigin = getServerApiOrigin()
  const clientIp = clientIpFromIncomingRequest(request)
  const headers = buildUpstreamApiHeaders(request.headers, clientIp)

  const bodyBuffer = await request.arrayBuffer().catch(() => new ArrayBuffer(0))

  const upstream = await fetch(`${apiOrigin}/api/chat`, {
    method: "POST",
    headers,
    body: bodyBuffer.byteLength > 0 ? bodyBuffer : undefined,
  })

  if (!upstream.ok) {
    const text = await upstream.text().catch(() => "")
    return new Response(text || upstream.statusText, {
      status: upstream.status,
      headers: { "Content-Type": upstream.headers.get("content-type") ?? "application/json" },
    })
  }

  const responseHeaders = new Headers()
  responseHeaders.set("Content-Type", upstream.headers.get("content-type") ?? "text/event-stream")
  responseHeaders.set("Cache-Control", "no-cache, no-transform")
  responseHeaders.set("Connection", "keep-alive")
  responseHeaders.set("X-Accel-Buffering", "no")

  return new Response(upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  })
}
