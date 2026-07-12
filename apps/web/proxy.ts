import type { NextRequest } from "next/server"
import { NextResponse } from "next/server"

import { ARCIIN_CLIENT_IP_HEADER } from "@/lib/server/api-proxy"
import { clientIpFromIncomingRequest } from "@/lib/server/client-ip"

const apiOrigin = (process.env.ARCIIN_API_URL || "http://127.0.0.1:4000").replace(/\/$/, "")

/** Query params that must never reach the login page (leak into history/logs/RSC payload). */
const CREDENTIAL_PARAMS = ["email", "password"] as const

/** Build API URL for Socket.IO — engine requires `/socket.io/` (trailing slash before `?`). */
function socketIoRewriteTarget(pathname: string, search: string) {
  const suffix = pathname.replace(/^\/socket\.io\/?/, "")
  const apiPath = suffix ? `/socket.io/${suffix}` : "/socket.io/"
  return new URL(`${apiPath}${search}`, apiOrigin)
}

/** Ensure Socket.IO rewrites carry the real client IP to Fastify. */
function ensureForwardedForHeaders(request: NextRequest): Headers {
  const requestHeaders = new Headers(request.headers)
  const clientIp = clientIpFromIncomingRequest(request)
  if (!clientIp) return requestHeaders

  const prior = requestHeaders.get("x-forwarded-for")
  if (prior) {
    const chain = prior.split(",").map((value) => value.trim())
    if (!chain.includes(clientIp)) {
      requestHeaders.set("x-forwarded-for", `${clientIp}, ${prior}`)
    }
  } else {
    requestHeaders.set("x-forwarded-for", clientIp)
  }

  if (!requestHeaders.get("x-real-ip")) {
    requestHeaders.set("x-real-ip", clientIp)
  }

  requestHeaders.set(ARCIIN_CLIENT_IP_HEADER, clientIp)

  return requestHeaders
}

/** Proxy Socket.IO through the web origin so session cookies authenticate (WSL/dev). */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl

  // Credentials in the URL (?email=…&password=…) get stripped with a redirect
  // before the page renders, so they never land in history, logs, or the
  // serialized router state. 303 also downgrades any stray POST to a clean GET.
  if (pathname === "/login" || pathname.startsWith("/login/")) {
    const hasCredentialParams = CREDENTIAL_PARAMS.some((param) =>
      request.nextUrl.searchParams.has(param),
    )
    if (hasCredentialParams) {
      const clean = request.nextUrl.clone()
      for (const param of CREDENTIAL_PARAMS) {
        clean.searchParams.delete(param)
      }
      return NextResponse.redirect(clean, 303)
    }
    return NextResponse.next()
  }

  if (!pathname.startsWith("/socket.io")) {
    return NextResponse.next()
  }

  const headers = ensureForwardedForHeaders(request)
  return NextResponse.rewrite(socketIoRewriteTarget(pathname, search), {
    request: { headers },
  })
}

export const config = {
  matcher: [
    "/socket.io",
    "/socket.io/:path*",
    "/login",
    "/login/:path*",
  ],
}
