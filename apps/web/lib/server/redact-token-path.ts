/**
 * File Request and share links carry their bearer token in the URL path, so
 * a logged path is a usable link. The web proxy logs the path of a failed
 * upstream request; this strips the token first. Mirrors the API's request
 * log redaction (apps/api/src/services/security/request-log-redaction.ts) —
 * tests/token-log-redaction.test.ts checks both against every route.
 */
const SECRET_PATH_PREFIXES = ["/public/file-requests/", "/shares/access/", "/request/", "/s/"]

export function redactTokenPath(pathname: string): string {
  for (const prefix of SECRET_PATH_PREFIXES) {
    const at = pathname.indexOf(prefix)
    if (at === -1) continue
    // "/s/" and "/request/" only as whole leading segments, not inside other paths.
    if ((prefix === "/s/" || prefix === "/request/") && at !== 0) continue
    const start = at + prefix.length
    const end = pathname.indexOf("/", start)
    if (end === start) continue
    return `${pathname.slice(0, start)}[redacted]${end === -1 ? "" : pathname.slice(end)}`
  }
  return pathname
}
