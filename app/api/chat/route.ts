import { getServerApiOrigin } from "@/lib/server/api-origin"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * Stream chat SSE through Next without buffering the full reply.
 * `next.config` rewrites buffer long /api responses; this route pipes chunks live.
 */
export async function POST(request: Request) {
  const apiOrigin = getServerApiOrigin()
  const cookie = request.headers.get("cookie") ?? ""
  const auth = request.headers.get("authorization") ?? ""
  const contentType = request.headers.get("content-type") ?? "application/json"

  const upstream = await fetch(`${apiOrigin}/api/chat`, {
    method: "POST",
    headers: {
      "Content-Type": contentType,
      ...(cookie ? { Cookie: cookie } : {}),
      ...(auth ? { Authorization: auth } : {}),
    },
    body: request.body,
    // @ts-expect-error — required for streaming request bodies in Node fetch
    duplex: "half",
  })

  if (!upstream.ok && !upstream.body) {
    const text = await upstream.text().catch(() => "")
    return new Response(text || upstream.statusText, {
      status: upstream.status,
      headers: { "Content-Type": upstream.headers.get("content-type") ?? "application/json" },
    })
  }

  const headers = new Headers()
  headers.set("Content-Type", upstream.headers.get("content-type") ?? "text/event-stream")
  headers.set("Cache-Control", "no-cache, no-transform")
  headers.set("Connection", "keep-alive")
  headers.set("X-Accel-Buffering", "no")

  return new Response(upstream.body, {
    status: upstream.status,
    headers,
  })
}
