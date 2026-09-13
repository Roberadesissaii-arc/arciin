import { proxyApiRequest } from "@/lib/server/api-proxy"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** Public discovery manifest. Proxied to the API so LAN clients can hit the web origin. */
export function GET(request: Request) {
  return proxyApiRequest(request, "/.well-known/arciin")
}
