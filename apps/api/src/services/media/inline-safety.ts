/**
 * Which uploaded files may be rendered by the browser on the app's origin.
 *
 * Everything else — HTML, SVG, XML, JavaScript, unknown — is active content:
 * rendered inline on this origin it runs with the viewer's session. Those are
 * served as attachments with a sandbox CSP, so even a browser that ignores the
 * disposition renders them in an opaque origin with no script.
 *
 * SVG is excluded on purpose despite being image/*.
 */
export const INLINE_SAFE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
  "image/bmp",
  "image/x-icon",
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "audio/mpeg",
  "audio/mp4",
  "audio/aac",
  "audio/ogg",
  "audio/wav",
  "audio/x-wav",
  "audio/flac",
  "application/pdf",
  "text/plain",
])

export const SANDBOX_CSP = "sandbox; default-src 'none'"

export function isInlineSafe(contentType: string): boolean {
  return INLINE_SAFE_MIME_TYPES.has(contentType.split(";")[0]!.trim().toLowerCase())
}

/** Content-Disposition for a download, safe against header injection. */
export function attachmentDisposition(filename: string): string {
  const safeAscii = filename.replace(/[^\w.\- ]/g, "_")
  return `attachment; filename="${safeAscii}"; filename*=UTF-8''${encodeURIComponent(filename)}`
}
