import type { NextRequest } from "next/server"
import { NextResponse } from "next/server"

const apiOrigin = (process.env.ARCIIN_API_URL || "http://127.0.0.1:4000").replace(/\/$/, "")

/** Build API URL for Socket.IO — engine requires `/socket.io/` (trailing slash before `?`). */
function socketIoRewriteTarget(pathname: string, search: string) {
  const suffix = pathname.replace(/^\/socket\.io\/?/, "")
  const apiPath = suffix ? `/socket.io/${suffix}` : "/socket.io/"
  return new URL(`${apiPath}${search}`, apiOrigin)
}

/** Proxy Socket.IO through the web origin so session cookies authenticate (WSL/dev). */
export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl

  if (!pathname.startsWith("/socket.io")) {
    return NextResponse.next()
  }

  return NextResponse.rewrite(socketIoRewriteTarget(pathname, search))
}

export const config = {
  matcher: ["/socket.io", "/socket.io/:path*"],
}
