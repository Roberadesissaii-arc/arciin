import { proxyApiRequest } from "@/lib/server/api-proxy"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type RouteContext = {
  params: Promise<{ path: string[] }>
}

async function handle(request: Request, context: RouteContext) {
  const { path } = await context.params
  const { search } = new URL(request.url)
  const apiPath = `/api/${path.join("/")}${search}`
  return proxyApiRequest(request, apiPath)
}

export const GET = handle
export const POST = handle
export const PUT = handle
export const PATCH = handle
export const DELETE = handle
export const HEAD = handle
export const OPTIONS = handle
